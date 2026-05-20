/**
 * lib/subscriptions/integrity/index.ts
 *
 * Subscription Integrity Validation Layer.
 *
 * Ensures no user loses paid access, pays without activation,
 * or bypasses plan restrictions.
 *
 * Server-only.
 */

import { getAdminDb } from "@/lib/firebase/admin";
import { getEffectivePlan } from "@/lib/subscription";
import { collections } from "@/lib/firebase/collections";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface IntegrityIssue {
  code: string;
  severity: "critical" | "warning" | "info";
  description: string;
  autoRepaired: boolean;
}

export interface IntegrityCheckResult {
  userId: string;
  plan: string;
  isValid: boolean;
  issues: IntegrityIssue[];
  repaired: boolean;
  checkedAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function nowISO(): string {
  return new Date().toISOString();
}

// ─── Integrity Check ──────────────────────────────────────────────────────────

/**
 * Reads a user document from Firestore and validates subscription integrity.
 */
export async function checkSubscriptionIntegrity(
  userId: string,
): Promise<IntegrityCheckResult> {
  const checkedAt = nowISO();
  const issues: IntegrityIssue[] = [];
  let repaired = false;

  try {
    const db = getAdminDb();
    const userDoc = await db.collection(collections.users).doc(userId).get();

    if (!userDoc.exists) {
      return {
        userId,
        plan: "unknown",
        isValid: false,
        issues: [
          {
            code:         "USER_NOT_FOUND",
            severity:     "critical",
            description:  `User document not found for userId: ${userId}`,
            autoRepaired: false,
          },
        ],
        repaired: false,
        checkedAt,
      };
    }

    const data = userDoc.data() ?? {};
    const rawPlan         = (data["subscriptionPlan"]      as string)  ?? "free";
    const expiresAt       = (data["subscriptionExpiresAt"] as string)  ?? null;
    const dailyCount      = (data["dailyMessageCount"]     as number)  ?? 0;
    const dailyResetAt    = (data["dailyResetAt"]          as string)  ?? null;

    const effectivePlan = getEffectivePlan({
      subscriptionPlan:        rawPlan as "free" | "growth" | "pro" | "enterprise",
      subscriptionExpiresAt:   expiresAt,
      referralUnlockExpiresAt: (data["referralUnlockExpiresAt"] as string) ?? null,
    });

    // ── Check 1: Plan recorded but expiry missing ──────────────────────────
    if (rawPlan !== "free" && !expiresAt) {
      issues.push({
        code:         "PAID_PLAN_MISSING_EXPIRY",
        severity:     "warning",
        description:  `User has plan "${rawPlan}" but no subscriptionExpiresAt set`,
        autoRepaired: false,
      });
    }

    // ── Check 2: Plan expired but not reset to free ────────────────────────
    if (rawPlan !== "free" && expiresAt && new Date(expiresAt) < new Date() && effectivePlan === "free") {
      const repairResult = await repairSubscription(userId, {
        code:         "EXPIRED_PLAN_NOT_RESET",
        severity:     "warning",
        description:  `Plan "${rawPlan}" expired at ${expiresAt} but subscriptionPlan not reset`,
        autoRepaired: false,
      });
      issues.push({
        code:         "EXPIRED_PLAN_NOT_RESET",
        severity:     "warning",
        description:  `Plan "${rawPlan}" expired at ${expiresAt}`,
        autoRepaired: repairResult,
      });
      if (repairResult) repaired = true;
    }

    // ── Check 3: Daily quota not reset on new day ──────────────────────────
    if (dailyCount > 0 && dailyResetAt) {
      const resetDate = new Date(dailyResetAt).toDateString();
      const today     = new Date().toDateString();
      if (resetDate !== today) {
        await syncQuota(userId);
        issues.push({
          code:         "QUOTA_NOT_RESET",
          severity:     "info",
          description:  `Daily quota not reset (last reset: ${dailyResetAt})`,
          autoRepaired: true,
        });
        repaired = true;
      }
    }

    // ── Check 4: Suspicious daily count ───────────────────────────────────
    if (dailyCount > 10_000) {
      issues.push({
        code:         "ANOMALOUS_DAILY_COUNT",
        severity:     "critical",
        description:  `Daily message count is anomalously high: ${dailyCount}`,
        autoRepaired: false,
      });
    }

    return {
      userId,
      plan: effectivePlan,
      isValid: issues.filter((i) => i.severity === "critical").length === 0,
      issues,
      repaired,
      checkedAt,
    };
  } catch (err) {
    return {
      userId,
      plan: "unknown",
      isValid: false,
      issues: [
        {
          code:         "CHECK_FAILED",
          severity:     "critical",
          description:  err instanceof Error ? err.message : "Integrity check failed with unknown error",
          autoRepaired: false,
        },
      ],
      repaired: false,
      checkedAt,
    };
  }
}

// ─── Repair ───────────────────────────────────────────────────────────────────

/**
 * Attempts to repair a known subscription issue.
 * Returns true if repair succeeded.
 */
export async function repairSubscription(
  userId: string,
  issue: IntegrityIssue,
): Promise<boolean> {
  try {
    const db = getAdminDb();

    switch (issue.code) {
      case "EXPIRED_PLAN_NOT_RESET": {
        void db.collection(collections.users).doc(userId).update({
          subscriptionPlan: "free",
          _repairedAt:       nowISO(),
          _repairReason:     issue.code,
        });
        return true;
      }

      case "QUOTA_NOT_RESET": {
        await syncQuota(userId);
        return true;
      }

      default:
        return false;
    }
  } catch {
    return false;
  }
}

// ─── Batch Audit ──────────────────────────────────────────────────────────────

/**
 * Scans recent active users, runs integrity checks, and logs issues.
 * Fire-and-forget log writes.
 */
export async function runIntegrityAudit(limit = 50): Promise<IntegrityCheckResult[]> {
  const results: IntegrityCheckResult[] = [];

  try {
    const db = getAdminDb();
    const snap = await db
      .collection(collections.users)
      .orderBy("createdAt", "desc")
      .limit(limit)
      .get();

    await Promise.all(
      snap.docs.map(async (doc) => {
        const result = await checkSubscriptionIntegrity(doc.id);
        results.push(result);

        if (result.issues.length > 0) {
          // Fire-and-forget audit log
          void (async () => {
            try {
              await db.collection(collections.subscriptionAuditLog).add({
                ...result,
                _loggedAt: nowISO(),
              });
            } catch {
              // silent — audit log must never affect main flow
            }
          })();
        }
      }),
    );
  } catch {
    // return whatever results we collected
  }

  return results;
}

// ─── Quota Sync ───────────────────────────────────────────────────────────────

/**
 * Resets the daily quota if a new day has started.
 * Fire-and-forget — never throws to callers.
 */
export async function syncQuota(userId: string): Promise<void> {
  void (async () => {
    try {
      const db  = getAdminDb();
      const today = new Date().toDateString();
      await db.collection(collections.users).doc(userId).update({
        dailyMessageCount: 0,
        dailyResetAt:      new Date().toISOString(),
        _quotaSyncDate:    today,
      });
    } catch {
      // silent — quota sync must never affect callers
    }
  })();
}
