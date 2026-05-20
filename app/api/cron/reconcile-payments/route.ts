/**
 * GET /api/cron/reconcile-payments
 *
 * Vercel Cron: runs every 6 hours (`0 *\/6 * * *` in vercel.json).
 *
 * Reconciles pending Paystack payments against the Paystack API and repairs
 * any orphaned successes (webhook missed), stale pending payments, and
 * referral balance drift.
 *
 * Results are logged to Firestore (reconciliation_runs collection) for
 * historical tracking and anomaly detection.
 */

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { collections } from "@/lib/firebase/collections";
import {
  reconcileRecentPayments,
  reconcileReferralBalances,
} from "@/lib/reconciliation/payment-reconciler";
import { createLogger } from "@/lib/observability/logger";
const logger = createLogger("cron:reconcile-payments");

export const dynamic  = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  if (req.headers.get("Authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date().toISOString();

  const [paymentReport, balanceReport] = await Promise.allSettled([
    reconcileRecentPayments(6, 10),
    reconcileReferralBalances(),
  ]);

  const report = {
    ranAt:   now,
    payments: paymentReport.status === "fulfilled" ? paymentReport.value : { error: String(paymentReport.reason) },
    balances: balanceReport.status === "fulfilled" ? balanceReport.value : { error: String(balanceReport.reason) },
  };

  // Persist run result for audit trail
  await getAdminDb()
    .collection(collections.reconciliationRuns)
    .add({ ...report, type: "scheduled" })
    .catch(() => {});

  // Alert if any balance drift was detected
  if (
    balanceReport.status === "fulfilled" &&
    balanceReport.value.drifted.length > 0
  ) {
    logger.error("BALANCE DRIFT DETECTED", {
      count: balanceReport.value.drifted.length,
      drifted: JSON.stringify(balanceReport.value.drifted),
    });
  }

  return NextResponse.json(report);
}
