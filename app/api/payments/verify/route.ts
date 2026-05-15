/**
 * GET /api/payments/verify?ref=ZURIA-XXXX-YYYY
 *
 * Called after Paystack redirects the user back to /subscription/callback.
 * Verifies the transaction with Paystack and activates the subscription if successful.
 * Uses idempotency — safe to call multiple times for the same reference.
 */

import { NextResponse } from "next/server";
import { type DocumentData } from "firebase-admin/firestore";
import { getAdminDb, verifyIdToken } from "@/lib/firebase/admin";
import { collections } from "@/lib/firebase/collections";
import { verifyTransaction } from "@/lib/services/paystack-service";
import { sendText } from "@/lib/whatsapp/client";
import { fmtSubscriptionActivated } from "@/lib/whatsapp/formatter";
import type { PaystackPayment, SubscriptionPlan } from "@/types/domain";

export const dynamic = "force-dynamic";

function planDurationDays(annual: boolean) {
  return annual ? 365 : 30;
}

export async function GET(req: Request) {
  try {
    // Auth
    const decoded = await verifyIdToken(req.headers.get("authorization"));
    if (!decoded) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(req.url);
    const reference = url.searchParams.get("ref");

    if (!reference) {
      return NextResponse.json({ error: "Missing ref parameter" }, { status: 400 });
    }

    const db = getAdminDb();

    // Load the payment record
    const paymentSnap = await db.collection(collections.payments).doc(reference).get();
    if (!paymentSnap.exists) {
      return NextResponse.json({ error: "Payment not found" }, { status: 404 });
    }

    const payment = paymentSnap.data() as PaystackPayment;

    // Ensure the payment belongs to the authenticated user
    if (payment.userId !== decoded.uid) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    // Already processed — return cached result
    if (payment.status === "success") {
      return NextResponse.json({
        ok: true,
        status: "success",
        plan: payment.plan,
        annual: payment.annual,
        alreadyActivated: true,
      });
    }

    if (payment.status === "failed") {
      return NextResponse.json({ ok: false, status: "failed" });
    }

    // Verify with Paystack
    const result = await verifyTransaction(reference);

    if (!result.ok || result.status !== "success") {
      // Mark as failed in Firestore if Paystack says it's definitively failed/abandoned
      if (result.status === "failed" || result.status === "abandoned") {
        await paymentSnap.ref.update({ status: result.status, paystackStatus: result.status });
      }
      return NextResponse.json({
        ok: false,
        status: result.status,
        error: result.error,
      });
    }

    // ── Activate subscription ─────────────────────────────────────────────────
    if (result.currency !== "GHS" || Math.round(result.amountGHS * 100) !== Math.round(payment.amountGHS * 100)) {
      await paymentSnap.ref.update({ status: "failed", paystackStatus: "amount_mismatch" });
      return NextResponse.json({ error: "Payment amount could not be verified" }, { status: 400 });
    }

    const plan: SubscriptionPlan = payment.plan;
    const annual                 = payment.annual;
    const now                    = new Date();
    const days                   = planDurationDays(annual);
    const expiresAt              = new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();

    const resetKey =
      plan === "growth"
        ? now.toISOString().slice(0, 7)
        : now.toISOString().slice(0, 10);

    const userRef = db.collection(collections.users).doc(payment.userId);

    // BUG-6 FIX: Run the user update and payment update inside a single Firestore
    // transaction.  Concurrent calls to /verify for the same reference (e.g. user
    // double-clicking the callback) previously used Promise.all — both could read
    // payment.status === "pending" and both activate the subscription, potentially
    // resetting the message counter twice or updating conflicting plan states.
    // The transaction serialises concurrent attempts; the second will still see
    // status === "success" from the first (idempotency path above won't catch it
    // mid-flight, so we guard inside the transaction too).
    let userData: DocumentData | undefined;
    await db.runTransaction(async (txn) => {
      const [freshPaySnap, freshUserSnap] = await Promise.all([
        txn.get(paymentSnap.ref),
        txn.get(userRef),
      ]);

      if (!freshUserSnap.exists) {
        throw Object.assign(new Error("User not found"), { statusCode: 404 });
      }
      userData = freshUserSnap.data()!;

      // Guard inside the transaction: another concurrent request may have
      // already committed the activation between our read above and now.
      const freshPayment = freshPaySnap.data() as { status?: string } | undefined;
      if (freshPayment?.status === "success") {
        // Already activated — mark userData so we can still send the WhatsApp confirmation.
        return;
      }

      txn.update(userRef, {
        subscriptionPlan:        plan,
        subscriptionExpiresAt:   expiresAt,
        whatsappMessageCount:    0,
        whatsappMessageResetKey: resetKey,
        updatedAt:               now.toISOString(),
      });

      // Mark payment record as success
      txn.update(paymentSnap.ref, {
        status:         "success",
        paidAt:         result.paidAt ?? now.toISOString(),
        channel:        result.channel,
        paystackStatus: result.status,
      });
    });

    if (!userData) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // WhatsApp confirmation
    const userPhone  = userData.phoneNumber as string | undefined;
    const businessId = userData.businessId  as string | undefined;
    let businessName = "Your Business";
    if (businessId) {
      const bizSnap = await db.collection(collections.businesses).doc(businessId).get();
      if (bizSnap.exists) businessName = (bizSnap.data()?.name as string) ?? businessName;
    }
    if (userPhone) {
      sendText(
        `whatsapp:${userPhone}`,
        fmtSubscriptionActivated(plan, expiresAt, businessName)
      ).catch(() => {});
    }

    return NextResponse.json({
      ok: true,
      status: "success",
      plan,
      annual,
      expiresAt,
    });
  } catch (err) {
    console.error("[payments/verify]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
