/**
 * Webhook event processor — shared between the sync in-request path (legacy)
 * and the async cron-based queue processor.
 *
 * All financial logic lives here. The webhook route is ingestion-only.
 * Server-only: firebase-admin, crypto.
 */

import { FieldValue, type DocumentData } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { collections } from "@/lib/firebase/collections";
import { verifyTransaction } from "@/lib/services/paystack-service";
import { sendText } from "@/lib/whatsapp/client";
import { fmtSubscriptionActivated } from "@/lib/whatsapp/formatter";
import type {
  SubscriptionPlan,
  PaystackPayment,
  WithdrawalLedgerEntry,
  WithdrawalRequest,
  PaymentLedgerEntry,
} from "@/types/domain";

// ─── Constants ────────────────────────────────────────────────────────────────

const VALID_PLANS = new Set<SubscriptionPlan>(["growth", "pro", "enterprise"]);

function planDurationDays(annual: boolean) {
  return annual ? 365 : 30;
}

// ─── Subscription activation (idempotent) ────────────────────────────────────

export async function activateSubscription(
  userId: string,
  plan: SubscriptionPlan,
  annual: boolean,
  amountGHS: number,
  reference: string,
  source: "webhook" | "verify_api" | "queue",
  paystackTransactionId?: string,
  channel?: string,
): Promise<void> {
  if (!VALID_PLANS.has(plan)) {
    console.error(`[processor] Unknown plan "${plan}" for uid=${userId} — aborting`);
    return;
  }

  const db     = getAdminDb();
  const now    = new Date();
  const nowIso = now.toISOString();
  const days   = planDurationDays(annual);
  const expiresAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();

  const resetKey =
    plan === "growth"
      ? nowIso.slice(0, 7)
      : nowIso.slice(0, 10);

  const userRef    = db.collection(collections.users).doc(userId);
  const paymentRef = db.collection(collections.payments).doc(reference);

  const successLedgerId    = `${reference}_PAYMENT_SUCCESS`;
  const activationLedgerId = `${reference}_SUBSCRIPTION_ACTIVATED`;
  const successLedgerRef    = db.collection(collections.paymentEvents).doc(successLedgerId);
  const activationLedgerRef = db.collection(collections.paymentEvents).doc(activationLedgerId);

  let userData: DocumentData | undefined;

  await db.runTransaction(async (txn) => {
    const [userSnap, freshPaySnap, successLedgerSnap] = await Promise.all([
      txn.get(userRef),
      txn.get(paymentRef),
      txn.get(successLedgerRef),
    ]);

    if (!userSnap.exists) throw new Error(`[processor] user ${userId} not found`);
    userData = userSnap.data()!;

    // Dual idempotency guard — exit if a previous call already committed.
    const freshPayStatus = (freshPaySnap.data() as { status?: string } | undefined)?.status;
    if (freshPayStatus === "success" || successLedgerSnap.exists) return;

    txn.update(userRef, {
      subscriptionPlan:        plan,
      subscriptionExpiresAt:   expiresAt,
      whatsappMessageCount:    0,
      whatsappMessageResetKey: resetKey,
      updatedAt:               nowIso,
    });

    txn.update(paymentRef, { status: "success", paidAt: nowIso });

    txn.set(successLedgerRef, {
      id: successLedgerId, paystackReference: reference, paystackTransactionId,
      userId, plan, annual, amountGHS, currency: "GHS",
      eventType: "PAYMENT_SUCCESS", status: "success", source, channel,
      subscriptionExpiresAt: expiresAt,
      idempotencyKey: successLedgerId, createdAt: nowIso, _immutable: true,
    } as PaymentLedgerEntry);

    txn.set(activationLedgerRef, {
      id: activationLedgerId, paystackReference: reference, paystackTransactionId,
      userId, plan, annual, amountGHS, currency: "GHS",
      eventType: "SUBSCRIPTION_ACTIVATED", status: "success", source, channel,
      subscriptionExpiresAt: expiresAt,
      idempotencyKey: activationLedgerId, createdAt: nowIso, _immutable: true,
    } as PaymentLedgerEntry);
  });

  if (!userData) return;

  // WhatsApp confirmation — best-effort, outside transaction.
  const userPhone  = userData.phoneNumber as string | undefined;
  const businessId = userData.businessId  as string | undefined;
  let businessName = "Your Business";
  if (businessId) {
    const bizSnap = await getAdminDb().collection(collections.businesses).doc(businessId).get();
    if (bizSnap.exists) businessName = (bizSnap.data()?.name as string) ?? businessName;
  }
  if (userPhone) {
    sendText(`whatsapp:${userPhone}`, fmtSubscriptionActivated(plan, expiresAt, businessName))
      .catch(() => {});
  }
}

// ─── Main event dispatcher ────────────────────────────────────────────────────

export interface ProcessResult {
  ok: boolean;
  message: string;
}

export async function processWebhookEvent(
  eventType: string,
  data: Record<string, unknown>,
): Promise<ProcessResult> {
  const db = getAdminDb();

  // ── charge.success ──────────────────────────────────────────────────────────
  if (eventType === "charge.success") {
    const reference             = data.reference as string;
    const status                = data.status    as string;
    const paystackTransactionId = data.id ? String(data.id) : undefined;
    const channel               = data.channel as string | undefined;

    if (status !== "success") return { ok: true, message: "Not a success status — skipped" };

    // Fast-path idempotency key check
    const idemKey  = `psevt_${reference}_charge.success`;
    const idemRef  = db.collection(collections.idempotencyKeys).doc(idemKey);
    const idemSnap = await idemRef.get();
    if (idemSnap.exists) return { ok: true, message: "Already processed (idempotency key)" };

    const paymentSnap = await db.collection(collections.payments).doc(reference).get();
    if (!paymentSnap.exists) {
      // Payment not in our DB — could be a race. Return ok:false so the queue
      // retries after a back-off (payment record may not be written yet).
      return { ok: false, message: "Payment record not found — will retry" };
    }

    const payment = paymentSnap.data() as PaystackPayment;
    if (payment.status === "success") return { ok: true, message: "Already processed" };

    const amountGHS = typeof data.amount === "number" ? data.amount / 100 : 0;
    const currency  = data.currency as string | undefined;

    if (currency !== "GHS" || Math.round(amountGHS * 100) !== Math.round(payment.amountGHS * 100)) {
      const nowIso        = new Date().toISOString();
      const failedLedgerId = `${reference}_PAYMENT_FAILED`;
      const failureReason = `amount_mismatch: expected ${payment.amountGHS} GHS, got ${amountGHS} ${currency ?? "?"}`;
      const failBatch     = db.batch();
      failBatch.update(paymentSnap.ref, { status: "failed", paystackStatus: "amount_mismatch" });
      failBatch.set(db.collection(collections.paymentEvents).doc(failedLedgerId), {
        id: failedLedgerId, paystackReference: reference, paystackTransactionId,
        userId: payment.userId, plan: payment.plan, annual: payment.annual,
        amountGHS: payment.amountGHS, currency: "GHS",
        eventType: "PAYMENT_FAILED", status: "failed", source: "webhook",
        failureReason, idempotencyKey: failedLedgerId,
        createdAt: nowIso, _immutable: true,
      } as PaymentLedgerEntry);
      await failBatch.commit();
      return { ok: true, message: `Amount mismatch rejected — ${failureReason}` };
    }

    await activateSubscription(
      payment.userId, payment.plan, payment.annual, payment.amountGHS,
      reference, "queue", paystackTransactionId, channel,
    );

    // Persist idempotency key (90-day TTL)
    await idemRef.set({
      reference, eventType: "charge.success",
      processedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
    }).catch(() => {});

    return { ok: true, message: "Subscription activated" };
  }

  // ── transfer.success ────────────────────────────────────────────────────────
  if (eventType === "transfer.success") {
    const transferCode = data.transfer_code as string | undefined;
    const reference    = data.reference     as string | undefined;

    let wdSnap = reference
      ? await db.collection(collections.withdrawals)
          .where("paystackReference", "==", reference).limit(1).get()
      : null;
    if (!wdSnap || wdSnap.empty) {
      wdSnap = transferCode
        ? await db.collection(collections.withdrawals)
            .where("paystackTransferCode", "==", transferCode).limit(1).get()
        : null;
    }
    if (!wdSnap || wdSnap.empty) return { ok: true, message: "No matching withdrawal" };

    const wdDoc = wdSnap.docs[0];
    const wd    = wdDoc.data() as WithdrawalRequest;
    if (wd.status === "approved") return { ok: true, message: "Already approved" };

    const now = new Date().toISOString();
    await wdDoc.ref.update({ status: "approved", processedAt: now });

    if (wd.phoneNumber) {
      const firstName = wd.ownerName.split(" ")[0];
      sendText(`whatsapp:${wd.phoneNumber}`, [
        `✅ *Payment sent, ${firstName}!* 🎉`,
        ``, `*GHS ${wd.amount.toFixed(2)}* has been sent to your ${wd.method === "momo" ? "MoMo" : "bank"}:`,
        `${wd.network ?? ""} · ${wd.accountNumber}`,
        ``, `Please check your account. Thank you for sharing ZURIA! 💪`, `_— ZURIA_`,
      ].join("\n")).catch(() => {});
    }
    return { ok: true, message: "Withdrawal marked approved" };
  }

  // ── transfer.failed / transfer.reversed ────────────────────────────────────
  if (eventType === "transfer.failed" || eventType === "transfer.reversed") {
    const transferCode = data.transfer_code as string | undefined;
    const reference    = data.reference     as string | undefined;

    let wdSnap = reference
      ? await db.collection(collections.withdrawals)
          .where("paystackReference", "==", reference).limit(1).get()
      : null;
    if (!wdSnap || wdSnap.empty) {
      wdSnap = transferCode
        ? await db.collection(collections.withdrawals)
            .where("paystackTransferCode", "==", transferCode).limit(1).get()
        : null;
    }
    if (!wdSnap || wdSnap.empty) return { ok: true, message: "No matching withdrawal" };

    const wdDoc = wdSnap.docs[0];
    const wd    = wdDoc.data() as WithdrawalRequest;
    if (wd.status === "failed") return { ok: true, message: "Already marked failed" };

    const now = new Date().toISOString();

    await db.runTransaction(async (txn) => {
      const freshWdSnap = await txn.get(wdDoc.ref);
      const freshWd = freshWdSnap.data() as WithdrawalRequest | undefined;
      if (!freshWdSnap.exists || freshWd?.status === "failed") return;

      txn.update(wdDoc.ref, {
        status: "failed", processedAt: now,
        note: `${eventType} — balance restored automatically`,
      });
      txn.update(db.collection(collections.users).doc(wd.userId), {
        referralBalance: FieldValue.increment(wd.amount),
        updatedAt: now,
      });
    });

    // Immutable WITHDRAWAL_FAILED ledger entry
    const failedWdLedgerId = `${wdDoc.id}_WITHDRAWAL_FAILED`;
    db.collection(collections.withdrawalEvents).doc(failedWdLedgerId)
      .set({
        id: failedWdLedgerId, withdrawalId: wdDoc.id, userId: wd.userId,
        ownerName: wd.ownerName, amountGHS: wd.amount,
        network: wd.network ?? "", accountNumber: wd.accountNumber ?? "",
        accountName: wd.accountName ?? "",
        eventType: "WITHDRAWAL_FAILED", status: "failed", actorId: "system",
        note: `${eventType} — Paystack transfer failed; balance restored`,
        idempotencyKey: failedWdLedgerId, createdAt: now, _immutable: true,
      } as WithdrawalLedgerEntry)
      .catch(() => {});

    if (wd.phoneNumber) {
      const firstName = wd.ownerName.split(" ")[0];
      sendText(`whatsapp:${wd.phoneNumber}`, [
        `😔 *Transfer failed, ${firstName}*`, ``,
        `We could not send *GHS ${wd.amount.toFixed(2)}* to your account.`,
        `Your balance of *GHS ${wd.amount.toFixed(2)}* has been fully restored.`,
        ``, `Please contact us for help. We will resolve it right away. 🙏`, `_— ZURIA_`,
      ].join("\n")).catch(() => {});
    }
    return { ok: true, message: "Withdrawal marked failed, balance restored" };
  }

  return { ok: true, message: `Event ${eventType} not handled` };
}

// ─── Replay-attack guard ──────────────────────────────────────────────────────

const WEBHOOK_MAX_AGE_SECONDS = 300; // 5 minutes

export function isEventFresh(data: Record<string, unknown>): boolean {
  const raw = (data as { createdAt?: unknown }).createdAt;
  if (!raw || typeof raw !== "string") return true;
  const eventMs = Date.parse(raw);
  if (Number.isNaN(eventMs)) return true;
  return (Date.now() - eventMs) / 1000 <= WEBHOOK_MAX_AGE_SECONDS;
}

// ─── Queue-based reconciliation fallback ─────────────────────────────────────

/**
 * For a "payment record not found" retry, verify with Paystack directly.
 * If Paystack confirms success and we now have the payment doc, activate.
 */
export async function verifyAndActivateMissedPayment(
  reference: string,
): Promise<ProcessResult> {
  const db          = getAdminDb();
  const paymentSnap = await db.collection(collections.payments).doc(reference).get();
  if (!paymentSnap.exists) {
    return { ok: false, message: "Payment record still missing after retry" };
  }

  const payment = paymentSnap.data() as PaystackPayment;
  if (payment.status === "success") return { ok: true, message: "Already activated" };

  const result = await verifyTransaction(reference);
  if (!result.ok || result.status !== "success") {
    return { ok: false, message: `Paystack verification: ${result.status}` };
  }

  await activateSubscription(
    payment.userId, payment.plan, payment.annual, payment.amountGHS,
    reference, "queue",
  );
  return { ok: true, message: "Activated via Paystack verification fallback" };
}
