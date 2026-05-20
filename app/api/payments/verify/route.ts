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
import { captureZuriaError } from "@/lib/observability/sentry";
import type { PaystackPayment, SubscriptionPlan, PaymentLedgerEntry } from "@/types/domain";

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
      // Mark as failed in Firestore and write an immutable PAYMENT_FAILED ledger entry.
      if (result.status === "failed" || result.status === "abandoned") {
        const nowIso        = new Date().toISOString();
        const failedLedgerId = `${reference}_PAYMENT_FAILED`;
        const failBatch      = db.batch();
        failBatch.update(paymentSnap.ref, { status: result.status, paystackStatus: result.status });
        failBatch.set(db.collection(collections.paymentEvents).doc(failedLedgerId), {
          id:               failedLedgerId,
          paystackReference: reference,
          userId:           payment.userId,
          plan:             payment.plan,
          annual:           payment.annual,
          amountGHS:        payment.amountGHS,
          currency:         "GHS",
          eventType:        "PAYMENT_FAILED",
          status:           "failed",
          source:           "verify_api",
          failureReason:    result.status,
          idempotencyKey:   failedLedgerId,
          createdAt:        nowIso,
          _immutable:       true,
        } as PaymentLedgerEntry);
        await failBatch.commit();
      }
      return NextResponse.json({
        ok: false,
        status: result.status,
        error: result.error,
      });
    }

    // ── Activate subscription ─────────────────────────────────────────────────
    if (result.currency !== "GHS" || Math.round(result.amountGHS * 100) !== Math.round(payment.amountGHS * 100)) {
      // Amount or currency mismatch — reject and write an immutable PAYMENT_FAILED ledger entry.
      const nowIso         = new Date().toISOString();
      const failedLedgerId = `${reference}_PAYMENT_FAILED`;
      const failureReason  = `amount_mismatch: expected ${payment.amountGHS} GHS, received ${result.amountGHS} ${result.currency}`;
      const failBatch      = db.batch();
      failBatch.update(paymentSnap.ref, { status: "failed", paystackStatus: "amount_mismatch" });
      failBatch.set(db.collection(collections.paymentEvents).doc(failedLedgerId), {
        id:               failedLedgerId,
        paystackReference: reference,
        userId:           payment.userId,
        plan:             payment.plan,
        annual:           payment.annual,
        amountGHS:        payment.amountGHS,
        currency:         "GHS",
        eventType:        "PAYMENT_FAILED",
        status:           "failed",
        source:           "verify_api",
        failureReason,
        idempotencyKey:   failedLedgerId,
        createdAt:        nowIso,
        _immutable:       true,
      } as PaymentLedgerEntry);
      await failBatch.commit();
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

    // Deterministic ledger doc IDs — one per (reference, eventType).
    // Written atomically inside the transaction so ledger entries exist if and
    // only if the subscription was activated. Idempotent: a second concurrent
    // /verify or webhook call will find the ledger entry already present and exit.
    const successLedgerId    = `${reference}_PAYMENT_SUCCESS`;
    const activationLedgerId = `${reference}_SUBSCRIPTION_ACTIVATED`;
    const successLedgerRef    = db.collection(collections.paymentEvents).doc(successLedgerId);
    const activationLedgerRef = db.collection(collections.paymentEvents).doc(activationLedgerId);

    // Serialise concurrent /verify calls (e.g. user double-clicking the callback)
    // and concurrent webhook deliveries. All three reads are inside the transaction
    // so they form a consistent snapshot.
    let userData: DocumentData | undefined;
    await db.runTransaction(async (txn) => {
      const [freshPaySnap, freshUserSnap, successLedgerSnap] = await Promise.all([
        txn.get(paymentSnap.ref),
        txn.get(userRef),
        txn.get(successLedgerRef),
      ]);

      if (!freshUserSnap.exists) {
        throw Object.assign(new Error("User not found"), { statusCode: 404 });
      }
      userData = freshUserSnap.data()!;

      // ── DUAL idempotency guard ────────────────────────────────────────────
      // The second concurrent call (webhook retry, double-click) will find at
      // least one of these conditions true and exit without double-crediting.
      const freshPayment = freshPaySnap.data() as { status?: string } | undefined;
      if (freshPayment?.status === "success" || successLedgerSnap.exists) {
        return;
      }

      // ── 1. Activate user subscription ────────────────────────────────────
      txn.update(userRef, {
        subscriptionPlan:        plan,
        subscriptionExpiresAt:   expiresAt,
        whatsappMessageCount:    0,
        whatsappMessageResetKey: resetKey,
        updatedAt:               now.toISOString(),
      });

      // ── 2. Mark payment record as success ────────────────────────────────
      txn.update(paymentSnap.ref, {
        status:         "success",
        paidAt:         result.paidAt ?? now.toISOString(),
        channel:        result.channel,
        paystackStatus: result.status,
      });

      // ── 3. Write immutable PAYMENT_SUCCESS ledger entry ───────────────────
      txn.set(successLedgerRef, {
        id:                   successLedgerId,
        paystackReference:    reference,
        userId:               payment.userId,
        plan,
        annual,
        amountGHS:            payment.amountGHS,
        currency:             "GHS",
        eventType:            "PAYMENT_SUCCESS",
        status:               "success",
        source:               "verify_api",
        channel:              result.channel,
        subscriptionExpiresAt: expiresAt,
        idempotencyKey:       successLedgerId,
        createdAt:            now.toISOString(),
        _immutable:           true,
      } as PaymentLedgerEntry);

      // ── 4. Write immutable SUBSCRIPTION_ACTIVATED ledger entry ────────────
      txn.set(activationLedgerRef, {
        id:                   activationLedgerId,
        paystackReference:    reference,
        userId:               payment.userId,
        plan,
        annual,
        amountGHS:            payment.amountGHS,
        currency:             "GHS",
        eventType:            "SUBSCRIPTION_ACTIVATED",
        status:               "success",
        source:               "verify_api",
        channel:              result.channel,
        subscriptionExpiresAt: expiresAt,
        idempotencyKey:       activationLedgerId,
        createdAt:            now.toISOString(),
        _immutable:           true,
      } as PaymentLedgerEntry);
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
    captureZuriaError(err instanceof Error ? err : new Error(String(err)), { extra: { route: "payments/verify" } });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
