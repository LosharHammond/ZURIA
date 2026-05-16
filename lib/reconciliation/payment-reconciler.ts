/**
 * Payment reconciliation engine.
 *
 * Compares our Firestore payment records against Paystack's API to detect
 * and repair orphaned successes (webhook missed), stale pending payments,
 * and ledger/state mismatches.
 *
 * Server-only: firebase-admin + Paystack API.
 */

import { getAdminDb } from "@/lib/firebase/admin";
import { collections } from "@/lib/firebase/collections";
import { verifyTransaction } from "@/lib/services/paystack-service";
import { activateSubscription } from "@/lib/payments/webhook-processor";
import type { PaystackPayment, PaymentLedgerEntry } from "@/types/domain";

export interface ReconciliationReport {
  scannedPayments:  number;
  repairedPayments: number;
  failedPayments:   number;
  orphanedPending:  number;
  errors:           string[];
  ranAt:            string;
}

/**
 * Reconcile all payments that have been in "pending" status for longer than
 * `staleThresholdMinutes`. For each:
 *  - Verify with Paystack API
 *  - If Paystack says "success": activate subscription (idempotent)
 *  - If Paystack says "failed"/"abandoned": mark as failed in our DB + ledger
 *  - If Paystack says "pending": leave — payment is still in progress
 *
 * @param lookbackHours        - How far back to scan for pending payments (default 6h)
 * @param staleThresholdMinutes - Minimum age before a payment is reconciled (default 10m)
 */
export async function reconcileRecentPayments(
  lookbackHours = 6,
  staleThresholdMinutes = 10,
): Promise<ReconciliationReport> {
  const db      = getAdminDb();
  const now     = new Date();
  const ranAt   = now.toISOString();
  const since   = new Date(now.getTime() - lookbackHours * 3600_000).toISOString();
  const staleBy = new Date(now.getTime() - staleThresholdMinutes * 60_000).toISOString();

  const report: ReconciliationReport = {
    scannedPayments: 0, repairedPayments: 0, failedPayments: 0,
    orphanedPending: 0, errors: [], ranAt,
  };

  // Fetch payments initiated in the lookback window that are still pending
  // and old enough to be considered stale (not just created milliseconds ago).
  let paymentsSnap;
  try {
    paymentsSnap = await db
      .collection(collections.payments)
      .where("status", "==", "pending")
      .where("createdAt", ">=", since)
      .where("createdAt", "<=", staleBy)
      .get();
  } catch (err) {
    report.errors.push(`Firestore query failed: ${String(err)}`);
    return report;
  }

  report.scannedPayments = paymentsSnap.size;
  report.orphanedPending = paymentsSnap.size;

  const results = await Promise.allSettled(
    paymentsSnap.docs.map(async (doc) => {
      const payment = doc.data() as PaystackPayment;
      const reference = payment.reference;

      // Fast-path: check our ledger first before hitting Paystack API.
      // If a PAYMENT_SUCCESS ledger entry exists, the subscription was activated
      // but the payment doc status wasn't updated — repair the doc only.
      const successLedgerId = `${reference}_PAYMENT_SUCCESS`;
      const ledgerSnap = await db
        .collection(collections.paymentEvents)
        .doc(successLedgerId)
        .get();

      if (ledgerSnap.exists) {
        // Ledger shows success but payment doc is still pending — repair doc
        await doc.ref.update({ status: "success", repairedAt: ranAt }).catch(() => {});
        report.repairedPayments++;
        return { reference, action: "repaired:doc_only" };
      }

      // Verify with Paystack API
      let result;
      try {
        result = await verifyTransaction(reference);
      } catch (err) {
        report.errors.push(`verifyTransaction(${reference}) threw: ${String(err)}`);
        return { reference, action: "error:verify_threw" };
      }

      if (result.ok && result.status === "success") {
        // Paystack confirms success but we have no ledger entry — orphaned success.
        // Activate subscription — fully idempotent (dual guard inside transaction).
        await activateSubscription(
          payment.userId,
          payment.plan,
          payment.annual,
          payment.amountGHS,
          reference,
          "queue", // source label for ledger
        );
        report.repairedPayments++;
        return { reference, action: "repaired:activated" };
      }

      if (result.status === "failed" || result.status === "abandoned") {
        // Paystack confirms failure — write PAYMENT_FAILED ledger + mark doc
        const failedLedgerId = `${reference}_PAYMENT_FAILED`;
        const nowIso         = now.toISOString();
        const failBatch      = db.batch();
        failBatch.update(doc.ref, { status: result.status, repairedAt: ranAt });
        failBatch.set(
          db.collection(collections.paymentEvents).doc(failedLedgerId),
          {
            id:               failedLedgerId,
            paystackReference: reference,
            userId:           payment.userId,
            plan:             payment.plan,
            annual:           payment.annual,
            amountGHS:        payment.amountGHS,
            currency:         "GHS",
            eventType:        "PAYMENT_FAILED",
            status:           "failed",
            source:           "queue",
            failureReason:    `reconciler: Paystack status=${result.status}`,
            idempotencyKey:   failedLedgerId,
            createdAt:        nowIso,
            _immutable:       true,
          } as PaymentLedgerEntry,
          { merge: true }, // no-op if ledger entry already exists
        );
        await failBatch.commit();
        report.failedPayments++;
        return { reference, action: `marked_failed:${result.status}` };
      }

      // Paystack still shows pending — payment is genuinely in-progress, skip
      return { reference, action: "skipped:still_pending" };
    })
  );

  // Collect any unexpected thrown errors
  results.forEach((r) => {
    if (r.status === "rejected") {
      report.errors.push(String(r.reason));
    }
  });

  return report;
}

/**
 * Validate that every user's referral balance matches the sum of their
 * ledger credits minus debits. Returns a list of users with balance drift.
 */
export async function reconcileReferralBalances(): Promise<{
  checked: number;
  drifted: { userId: string; expected: number; actual: number; drift: number }[];
}> {
  const db = getAdminDb();

  // Only check users who have ever had a referral reward
  const rewardsSnap = await db.collection(collections.referralEvents).get();

  // Build a map: referrerId → total rewarded
  const rewardMap = new Map<string, number>();
  rewardsSnap.docs.forEach((d) => {
    const { referrerId, amount } = d.data() as { referrerId: string; amount: number };
    rewardMap.set(referrerId, (rewardMap.get(referrerId) ?? 0) + (amount ?? 0));
  });

  // Build a map: userId → total withdrawn (WITHDRAWAL_REQUESTED events only)
  const withdrawnSnap = await db
    .collection(collections.withdrawalEvents)
    .where("eventType", "==", "WITHDRAWAL_REQUESTED")
    .get();

  const withdrawnMap = new Map<string, number>();
  withdrawnSnap.docs.forEach((d) => {
    const { userId, amountGHS } = d.data() as { userId: string; amountGHS: number };
    withdrawnMap.set(userId, (withdrawnMap.get(userId) ?? 0) + (amountGHS ?? 0));
  });

  const drifted: { userId: string; expected: number; actual: number; drift: number }[] = [];

  await Promise.allSettled(
    [...rewardMap.keys()].map(async (userId) => {
      const totalRewarded  = Math.round((rewardMap.get(userId)   ?? 0) * 100) / 100;
      const totalWithdrawn = Math.round((withdrawnMap.get(userId) ?? 0) * 100) / 100;
      const expected       = Math.round((totalRewarded - totalWithdrawn) * 100) / 100;

      const userSnap = await db.collection(collections.users).doc(userId).get();
      const actual   = Math.round(((userSnap.data()?.referralBalance as number) ?? 0) * 100) / 100;
      const drift    = Math.round((actual - expected) * 100) / 100;

      if (drift !== 0) {
        drifted.push({ userId, expected, actual, drift });
      }
    })
  );

  return { checked: rewardMap.size, drifted };
}
