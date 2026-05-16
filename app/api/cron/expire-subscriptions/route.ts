/**
 * GET /api/cron/expire-subscriptions
 *
 * Vercel Cron: runs daily at 01:00 UTC (`0 1 * * *` in vercel.json).
 *
 * Scans for users whose subscriptionExpiresAt has passed but whose
 * subscriptionPlan field is still set to a paid plan. Emits a
 * SUBSCRIPTION_EXPIRED event for each expired user so the audit ledger is
 * complete, and logs a reconciliation summary.
 *
 * NOTE: Plan enforcement happens at request time via getEffectivePlan() —
 * this job does NOT downgrade users. It only ensures every expiry is
 * recorded in the payment_events ledger for auditability.
 */

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { collections } from "@/lib/firebase/collections";
import type { PaymentLedgerEntry, SubscriptionPlan } from "@/types/domain";

export const dynamic     = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  if (req.headers.get("Authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db  = getAdminDb();
  const now = new Date();
  const nowIso = now.toISOString();

  // Find users with a paid plan whose expiry date is in the past
  const expiredSnap = await db
    .collection(collections.users)
    .where("subscriptionPlan", "in", ["growth", "pro", "enterprise"])
    .where("subscriptionExpiresAt", "<=", nowIso)
    .get();

  if (expiredSnap.empty) {
    return NextResponse.json({ ok: true, expired: 0, message: "No expired subscriptions found" });
  }

  let emitted  = 0;
  let skipped  = 0;
  const errors: string[] = [];

  await Promise.allSettled(
    expiredSnap.docs.map(async (userDoc) => {
      const userId    = userDoc.id;
      const data      = userDoc.data();
      const plan      = data.subscriptionPlan as SubscriptionPlan;
      const expiresAt = data.subscriptionExpiresAt as string;

      // Deterministic doc ID — one event per (userId, expiresAt) pair.
      // set() with merge:true is a no-op if the event was already emitted
      // by the lazy-emission path in getEffectivePlanWithExpiry().
      const expiredLedgerId = `${userId}_SUBSCRIPTION_EXPIRED_${expiresAt}`;

      try {
        const ledgerRef = db.collection(collections.paymentEvents).doc(expiredLedgerId);
        const existing  = await ledgerRef.get();

        if (existing.exists) {
          skipped++;
          return;
        }

        await ledgerRef.set({
          id:                    expiredLedgerId,
          userId,
          plan,
          eventType:             "SUBSCRIPTION_EXPIRED",
          status:                "failed",
          source:                "system",
          subscriptionExpiresAt: expiresAt,
          idempotencyKey:        expiredLedgerId,
          createdAt:             nowIso,
          _immutable:            true,
          // Placeholder fields required by PaymentLedgerEntry type
          paystackReference:     `expired_${userId}`,
          annual:                false,
          amountGHS:             0,
          currency:              "GHS",
        } as PaymentLedgerEntry);

        emitted++;
      } catch (err) {
        errors.push(`${userId}: ${String(err)}`);
      }
    })
  );

  return NextResponse.json({
    ok:      true,
    scanned: expiredSnap.size,
    emitted,
    skipped,
    errors:  errors.length > 0 ? errors : undefined,
    ranAt:   nowIso,
  });
}
