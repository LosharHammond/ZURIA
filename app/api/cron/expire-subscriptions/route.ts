/**
 * GET /api/cron/expire-subscriptions
 *
 * Vercel Cron: runs daily at 01:00 UTC (`0 1 * * *` in vercel.json).
 *
 * Scans for users whose subscriptionExpiresAt has passed but whose
 * subscriptionPlan field is still set to a paid plan.
 *
 * For each expired user this job:
 *   1. Resets subscriptionPlan → "free" in the user document
 *   2. Emits an immutable SUBSCRIPTION_EXPIRED ledger entry for audit
 *
 * Without step 1, a user's Firestore document permanently shows e.g.
 * "pro" even after expiry, which confuses admin tooling, data exports, and
 * any code that reads subscriptionPlan directly instead of calling
 * getEffectivePlan(). getEffectivePlan() still enforces expiry at request
 * time, but writing "free" here keeps Firestore as the ground truth.
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

        // ── 1. Reset subscriptionPlan to "free" ──────────────────────────────
        // Keeps Firestore as ground truth — without this, expired users retain
        // e.g. subscriptionPlan="pro" in the DB even though getEffectivePlan()
        // would return "free". Admin tooling and data exports would be wrong.
        await userDoc.ref.update({
          subscriptionPlan: "free",
          _expiredAt:       nowIso,
          updatedAt:        nowIso,
        });

        // ── 2. Write immutable SUBSCRIPTION_EXPIRED ledger entry ─────────────
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
