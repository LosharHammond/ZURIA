/**
 * Rule-based fraud detection engine.
 *
 * Evaluates a set of deterministic signals against user behavior and produces
 * a fraud score (0–100) and risk classification.
 *
 * Server-only: firebase-admin.
 *
 * Design principles:
 * - No ML/probabilistic models — rules are auditable and explainable
 * - Signals are append-only (written to fraud_signals collection)
 * - Score computation is idempotent — safe to re-run
 * - Actions (block, flag) are advisory — humans approve enforcement
 */

import { getAdminDb } from "@/lib/firebase/admin";
import { collections } from "@/lib/firebase/collections";

// ─── Types ────────────────────────────────────────────────────────────────────

export type FraudSignalType =
  | "SELF_REFERRAL"           // User attempted to use their own referral code
  | "RAPID_REFERRAL_FARMING"  // More than N referrals in a short window
  | "DUPLICATE_REFERRAL_CLAIM"// Same referee used by multiple referrers
  | "RAPID_WITHDRAWAL"        // Withdrawal within T hours of earning reward
  | "REPEATED_PAYMENT_FAIL"   // Multiple PAYMENT_FAILED events on same user
  | "ABNORMAL_SIGNUP_VELOCITY";// Many signups from same phone prefix

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "BLOCKED";

export interface FraudSignal {
  type:       FraudSignalType;
  severity:   "LOW" | "MEDIUM" | "HIGH";
  userId:     string;
  detectedAt: string;
  source:     string;
  metadata:   Record<string, unknown>;
}

export interface FraudScore {
  userId:    string;
  score:     number;       // 0–100
  riskLevel: RiskLevel;
  signals:   FraudSignal[];
  computedAt: string;
}

// Score thresholds
const RISK_THRESHOLDS = { LOW: 0, MEDIUM: 30, HIGH: 60, BLOCKED: 85 };

// Signal weights
const SIGNAL_WEIGHTS: Record<FraudSignalType, number> = {
  SELF_REFERRAL:             35,
  RAPID_REFERRAL_FARMING:    25,
  DUPLICATE_REFERRAL_CLAIM:  20,
  RAPID_WITHDRAWAL:          15,
  REPEATED_PAYMENT_FAIL:     20,
  ABNORMAL_SIGNUP_VELOCITY:  10,
};

function classifyRisk(score: number): RiskLevel {
  if (score >= RISK_THRESHOLDS.BLOCKED)  return "BLOCKED";
  if (score >= RISK_THRESHOLDS.HIGH)     return "HIGH";
  if (score >= RISK_THRESHOLDS.MEDIUM)   return "MEDIUM";
  return "LOW";
}

// ─── Individual signal detectors ─────────────────────────────────────────────

/**
 * Signal: Rapid referral farming — more than 5 referrals in 1 hour.
 * Legitimate referrers do not typically send 5+ people in under an hour.
 */
async function detectRapidFarming(
  userId: string,
  db: ReturnType<typeof getAdminDb>,
  now: Date,
): Promise<FraudSignal | null> {
  const oneHourAgo = new Date(now.getTime() - 3600_000).toISOString();
  const snap = await db
    .collection(collections.referrals)
    .where("referrerId", "==", userId)
    .where("createdAt", ">=", oneHourAgo)
    .get();

  if (snap.size >= 5) {
    return {
      type: "RAPID_REFERRAL_FARMING",
      severity: snap.size >= 10 ? "HIGH" : "MEDIUM",
      userId,
      detectedAt: now.toISOString(),
      source: "fraud_scorer",
      metadata: { referralsInLastHour: snap.size, threshold: 5 },
    };
  }
  return null;
}

/**
 * Signal: Rapid withdrawal — user requests withdrawal within 2h of earning reward.
 * Suggests automated or scripted farming behavior.
 */
async function detectRapidWithdrawal(
  userId: string,
  db: ReturnType<typeof getAdminDb>,
  now: Date,
): Promise<FraudSignal | null> {
  const twoHoursAgo = new Date(now.getTime() - 7_200_000).toISOString();

  // Check if there's a recent reward AND a recent withdrawal request
  const [recentReward, recentWithdrawal] = await Promise.all([
    db.collection(collections.referralEvents)
      .where("referrerId", "==", userId)
      .where("createdAt", ">=", twoHoursAgo)
      .limit(1)
      .get(),
    db.collection(collections.withdrawalEvents)
      .where("userId", "==", userId)
      .where("eventType", "==", "WITHDRAWAL_REQUESTED")
      .where("createdAt", ">=", twoHoursAgo)
      .limit(1)
      .get(),
  ]);

  if (!recentReward.empty && !recentWithdrawal.empty) {
    return {
      type: "RAPID_WITHDRAWAL",
      severity: "MEDIUM",
      userId,
      detectedAt: now.toISOString(),
      source: "fraud_scorer",
      metadata: {
        rewardAt: recentReward.docs[0].data().createdAt,
        withdrawalAt: recentWithdrawal.docs[0].data().createdAt,
      },
    };
  }
  return null;
}

/**
 * Signal: Repeated payment failures — more than 3 PAYMENT_FAILED events.
 * May indicate card testing or unauthorized payment attempts.
 */
async function detectRepeatedPaymentFailures(
  userId: string,
  db: ReturnType<typeof getAdminDb>,
  now: Date,
): Promise<FraudSignal | null> {
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const snap = await db
    .collection(collections.paymentEvents)
    .where("userId", "==", userId)
    .where("eventType", "==", "PAYMENT_FAILED")
    .where("createdAt", ">=", sevenDaysAgo)
    .get();

  if (snap.size >= 3) {
    return {
      type: "REPEATED_PAYMENT_FAIL",
      severity: snap.size >= 6 ? "HIGH" : "MEDIUM",
      userId,
      detectedAt: now.toISOString(),
      source: "fraud_scorer",
      metadata: { failedPaymentsIn7Days: snap.size, threshold: 3 },
    };
  }
  return null;
}

// ─── Main scorer ──────────────────────────────────────────────────────────────

/**
 * Compute a fraud score for a user by running all signal detectors.
 * Writes detected signals to the `fraud_signals` collection and updates
 * the user document with the latest score and risk level.
 *
 * Safe to call repeatedly — all writes are best-effort and non-blocking
 * on the caller.
 */
export async function computeAndStoreFraudScore(userId: string): Promise<FraudScore> {
  const db  = getAdminDb();
  const now = new Date();

  // Run all detectors in parallel
  const detectorResults = await Promise.allSettled([
    detectRapidFarming(userId, db, now),
    detectRapidWithdrawal(userId, db, now),
    detectRepeatedPaymentFailures(userId, db, now),
  ]);

  const signals: FraudSignal[] = detectorResults
    .filter((r): r is PromiseFulfilledResult<FraudSignal> =>
      r.status === "fulfilled" && r.value !== null
    )
    .map((r) => r.value);

  // Score = sum of signal weights, capped at 100
  const score = Math.min(
    100,
    signals.reduce((total, s) => total + SIGNAL_WEIGHTS[s.type], 0)
  );
  const riskLevel  = classifyRisk(score);
  const computedAt = now.toISOString();

  const fraudScore: FraudScore = { userId, score, riskLevel, signals, computedAt };

  // Persist signals to fraud_signals collection (append-only, best-effort)
  const batch = db.batch();
  signals.forEach((signal) => {
    const sigId = `${userId}_${signal.type}_${computedAt}`;
    batch.set(db.collection(collections.fraudSignals).doc(sigId), signal);
  });

  // Update user document with latest fraud score (non-blocking)
  batch.update(db.collection(collections.users).doc(userId), {
    fraudScore:  score,
    riskLevel,
    fraudScoredAt: computedAt,
  });

  batch.commit().catch((err) => {
    console.error(`[fraud/scorer] Failed to persist fraud score for ${userId}:`, err);
  });

  if (riskLevel === "HIGH" || riskLevel === "BLOCKED") {
    console.warn(`[fraud/scorer] ${riskLevel} risk user detected: uid=${userId} score=${score}`);
  }

  return fraudScore;
}

/**
 * Quick synchronous risk check using cached score on user document.
 * Use this at request time (e.g., before crediting a referral reward).
 * Fall back to "LOW" if no cached score exists.
 */
export function getCachedRiskLevel(userData: Record<string, unknown>): RiskLevel {
  return (userData.riskLevel as RiskLevel | undefined) ?? "LOW";
}

/**
 * Returns true if the user should be blocked from financial actions.
 */
export function isUserBlocked(userData: Record<string, unknown>): boolean {
  return getCachedRiskLevel(userData) === "BLOCKED";
}
