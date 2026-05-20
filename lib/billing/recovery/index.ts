/**
 * lib/billing/recovery/index.ts
 *
 * Failed payment recovery flows — detect payments that need intervention,
 * attempt automated recovery via Paystack verification, and notify users
 * of failures with actionable next steps.
 *
 * Server-only: firebase-admin + Paystack API.
 */

import { getAdminDb } from "@/lib/firebase/admin";
import { collections } from "@/lib/firebase/collections";
import { verifyAndActivateMissedPayment } from "@/lib/payments/webhook-processor";
import type { PaystackPayment } from "@/types/domain";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RecoveryCandidate {
  reference: string;
  userId: string;
  plan: string;
  amountGHS: number;
  createdAt: string;
  status: string;
  /** Age in minutes */
  ageMinutes: number;
}

export interface RecoveryResult {
  reference: string;
  success: boolean;
  action: "activated" | "already_active" | "paystack_pending" | "paystack_failed" | "error";
  message: string;
}

export interface RecoveryRunReport {
  ranAt: string;
  candidatesFound: number;
  recovered: number;
  alreadyActive: number;
  genuinelyFailed: number;
  errors: number;
  results: RecoveryResult[];
}

// ─── Recovery Detection ───────────────────────────────────────────────────────

/**
 * Find payments that may need recovery:
 * - Still "pending" after `ageMinutes` (default 15m)
 * - Within the last `lookbackHours` (default 24h)
 *
 * These are candidates for automatic Paystack verification.
 */
export async function findRecoveryCandidates(
  ageMinutes = 15,
  lookbackHours = 24,
): Promise<RecoveryCandidate[]> {
  try {
    const db    = getAdminDb();
    const now   = new Date();
    const since = new Date(now.getTime() - lookbackHours * 3_600_000).toISOString();
    const stale = new Date(now.getTime() - ageMinutes * 60_000).toISOString();

    const snap = await db
      .collection(collections.payments)
      .where("status", "==", "pending")
      .where("createdAt", ">=", since)
      .where("createdAt", "<=", stale)
      .orderBy("createdAt", "desc")
      .limit(100)
      .get();

    return snap.docs.map((doc) => {
      const p   = doc.data() as PaystackPayment;
      const age = Math.round((now.getTime() - new Date(p.createdAt).getTime()) / 60_000);
      return {
        reference:  p.reference,
        userId:     p.userId,
        plan:       p.plan,
        amountGHS:  p.amountGHS,
        createdAt:  p.createdAt,
        status:     p.status,
        ageMinutes: age,
      };
    });
  } catch {
    return [];
  }
}

/**
 * Attempt recovery for a single payment reference.
 * Uses verifyAndActivateMissedPayment from the webhook-processor.
 */
export async function recoverPayment(reference: string): Promise<RecoveryResult> {
  try {
    const result = await verifyAndActivateMissedPayment(reference);

    if (result.ok) {
      if (result.message === "Already activated") {
        return { reference, success: true, action: "already_active", message: result.message };
      }
      return { reference, success: true, action: "activated", message: result.message };
    }

    return { reference, success: false, action: "paystack_pending", message: result.message };
  } catch (err) {
    return {
      reference,
      success: false,
      action:  "error",
      message: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

/**
 * Run the full recovery flow — scan candidates and attempt activation.
 * Safe to call from a cron job.
 */
export async function runPaymentRecovery(
  ageMinutes = 15,
  lookbackHours = 24,
): Promise<RecoveryRunReport> {
  const ranAt      = new Date().toISOString();
  const candidates = await findRecoveryCandidates(ageMinutes, lookbackHours);
  const results:   RecoveryResult[] = [];

  let recovered = 0, alreadyActive = 0, genuinelyFailed = 0, errors = 0;

  for (const candidate of candidates) {
    const result = await recoverPayment(candidate.reference);
    results.push(result);

    if      (result.action === "activated")     recovered++;
    else if (result.action === "already_active") alreadyActive++;
    else if (result.action === "paystack_failed") genuinelyFailed++;
    else if (result.action === "error")          errors++;
  }

  // Persist recovery run to reconciliation_runs collection
  try {
    const db = getAdminDb();
    await db.collection(collections.reconciliationRuns).add({
      type:            "payment_recovery",
      ranAt,
      candidatesFound: candidates.length,
      recovered,
      alreadyActive,
      genuinelyFailed,
      errors,
    });
  } catch {
    // Non-fatal audit log failure
  }

  return {
    ranAt,
    candidatesFound: candidates.length,
    recovered,
    alreadyActive,
    genuinelyFailed,
    errors,
    results,
  };
}

// ─── Failed Payment History ───────────────────────────────────────────────────

export interface FailedPaymentRecord {
  reference: string;
  userId: string;
  plan: string;
  amountGHS: number;
  failedAt: string;
  failureReason: string;
}

/**
 * Retrieve recent failed payment events for the admin dashboard.
 */
export async function getRecentFailedPayments(limit = 50): Promise<FailedPaymentRecord[]> {
  try {
    const db   = getAdminDb();
    const snap = await db
      .collection(collections.paymentEvents)
      .where("eventType", "==", "PAYMENT_FAILED")
      .orderBy("createdAt", "desc")
      .limit(limit)
      .get();

    return snap.docs.map((doc) => {
      const d = doc.data() as Record<string, unknown>;
      return {
        reference:     String(d.paystackReference  ?? ""),
        userId:        String(d.userId              ?? ""),
        plan:          String(d.plan                ?? ""),
        amountGHS:     Number(d.amountGHS           ?? 0),
        failedAt:      String(d.createdAt           ?? ""),
        failureReason: String(d.failureReason       ?? "unknown"),
      };
    });
  } catch {
    return [];
  }
}
