/**
 * POST /api/payments/webhook
 *
 * Handles Paystack webhook events:
 *   charge.success  → activate subscription
 *   transfer.success / transfer.failed → update withdrawal status
 *
 * Paystack signs every request with HMAC-SHA512 using the secret key.
 * We verify the signature before processing anything.
 */

import { NextResponse } from "next/server";
import { FieldValue, type DocumentData } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { collections } from "@/lib/firebase/collections";
import { verifyPaystackSignature } from "@/lib/services/paystack-service";
import { sendText } from "@/lib/whatsapp/client";
import { fmtSubscriptionActivated } from "@/lib/whatsapp/formatter";
import type { SubscriptionPlan, PaystackPayment, WithdrawalRequest } from "@/types/domain";

// BUG-1 FIX: Maximum age (seconds) a webhook event is allowed to have.
// Paystack embeds a `createdAt` ISO timestamp in every event; we reject events
// older than this window to prevent replay attacks.
const WEBHOOK_MAX_AGE_SECONDS = 300; // 5 minutes

/** Returns true when the event timestamp is within the allowed window. */
function isEventFresh(data: Record<string, unknown>): boolean {
  // Paystack puts the event creation time in data.createdAt (ISO string)
  const raw = (data as { createdAt?: unknown }).createdAt;
  if (!raw || typeof raw !== "string") return true; // no timestamp → allow (older Paystack versions)
  const eventMs = Date.parse(raw);
  if (Number.isNaN(eventMs)) return true;
  return (Date.now() - eventMs) / 1000 <= WEBHOOK_MAX_AGE_SECONDS;
}

/** Known valid subscription plans — guards against corrupted Firestore records. */
const VALID_PLANS = new Set<SubscriptionPlan>(["growth", "pro", "enterprise"]);

export const dynamic = "force-dynamic";

// ─── helpers ─────────────────────────────────────────────────────────────────

function planDurationDays(annual: boolean) {
  return annual ? 365 : 30;
}

async function activateSubscription(
  userId: string,
  plan: SubscriptionPlan,
  annual: boolean,
  reference: string
) {
  // BUG-4 FIX: Validate the plan before activating — a corrupted Firestore
  // payment record with an unknown plan value must not silently update the user.
  if (!VALID_PLANS.has(plan)) {
    console.error(`[webhook] activateSubscription — unknown plan "${plan}" for user ${userId}, aborting`);
    return;
  }

  const db  = getAdminDb();
  const now = new Date();
  const days = planDurationDays(annual);
  const expiresAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();

  const resetKey =
    plan === "growth"
      ? now.toISOString().slice(0, 7)   // YYYY-MM monthly
      : now.toISOString().slice(0, 10); // YYYY-MM-DD daily (pro/enterprise unlimited anyway)

  const userRef    = db.collection(collections.users).doc(userId);
  const paymentRef = db.collection(collections.payments).doc(reference);

  // BUG-2 FIX: Run the user-update and payment-update inside a single Firestore
  // transaction so they are atomic — a crash between the two writes can no
  // longer leave the user activated but the payment still "pending" (or vice-versa).
  let userData: DocumentData | undefined;
  await db.runTransaction(async (txn) => {
    const userSnap = await txn.get(userRef);
    if (!userSnap.exists) {
      throw new Error(`user ${userId} not found`);
    }
    userData = userSnap.data()!;

    txn.update(userRef, {
      subscriptionPlan:        plan,
      subscriptionExpiresAt:   expiresAt,
      whatsappMessageCount:    0,
      whatsappMessageResetKey: resetKey,
      updatedAt:               now.toISOString(),
    });

    // Mark payment record as success inside the same transaction
    txn.update(paymentRef, { status: "success", paidAt: now.toISOString() });
  }).catch((err) => {
    console.error(`[webhook] activateSubscription transaction failed for user ${userId}:`, err);
    throw err; // re-throw so the outer handler can log it
  });

  if (!userData) return;

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
}

// ─── Main webhook handler ─────────────────────────────────────────────────────

export async function POST(req: Request) {
  // 1. Read the raw body for signature verification
  const rawBody = await req.text();
  const signature = req.headers.get("x-paystack-signature") ?? "";

  if (!verifyPaystackSignature(rawBody, signature)) {
    console.warn("[webhook] Invalid Paystack signature");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let event: { event: string; data: Record<string, unknown> };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { event: eventType, data } = event;

  // BUG-1 FIX: Replay-attack protection — reject events whose embedded
  // timestamp is older than WEBHOOK_MAX_AGE_SECONDS (5 minutes).
  if (!isEventFresh(data)) {
    console.warn(`[webhook] Stale event rejected: ${eventType}`);
    return NextResponse.json({ error: "Event too old" }, { status: 400 });
  }

  console.log(`[webhook] Received event: ${eventType}`);

  try {
    // ── charge.success ────────────────────────────────────────────────────────
    if (eventType === "charge.success") {
      const reference = data.reference as string;
      const status    = data.status    as string;

      if (status !== "success") {
        return NextResponse.json({ ok: true, message: "Not a success status, skipping" });
      }

      const db          = getAdminDb();
      const paymentSnap = await db.collection(collections.payments).doc(reference).get();

      if (!paymentSnap.exists) {
        // Payment may have been initialized outside our system — log and ignore
        console.warn(`[webhook] Payment record not found for reference: ${reference}`);
        return NextResponse.json({ ok: true, message: "No payment record found" });
      }

      const payment = paymentSnap.data() as PaystackPayment;

      if (payment.status === "success") {
        // Already processed (idempotency)
        return NextResponse.json({ ok: true, message: "Already processed" });
      }

      await activateSubscription(payment.userId, payment.plan, payment.annual, reference);
      return NextResponse.json({ ok: true, message: "Subscription activated" });
    }

    // ── transfer.success ──────────────────────────────────────────────────────
    if (eventType === "transfer.success") {
      const transferCode = data.transfer_code as string | undefined;
      const reference    = data.reference     as string | undefined;

      const db = getAdminDb();
      let wdSnap = reference
        ? await db
            .collection(collections.withdrawals)
            .where("paystackReference", "==", reference)
            .limit(1)
            .get()
        : null;

      if (!wdSnap || wdSnap.empty) {
        wdSnap = transferCode
          ? await db
              .collection(collections.withdrawals)
              .where("paystackTransferCode", "==", transferCode)
              .limit(1)
              .get()
          : null;
      }

      if (!wdSnap || wdSnap.empty) {
        console.warn("[webhook] transfer.success — no matching withdrawal found");
        return NextResponse.json({ ok: true, message: "No matching withdrawal" });
      }

      const wdDoc = wdSnap.docs[0];
      const wd    = wdDoc.data() as WithdrawalRequest;

      if (wd.status === "approved") {
        return NextResponse.json({ ok: true, message: "Already approved" });
      }

      const now = new Date().toISOString();
      await wdDoc.ref.update({ status: "approved", processedAt: now });

      // Notify user
      if (wd.phoneNumber) {
        const firstName = wd.ownerName.split(" ")[0];
        sendText(`whatsapp:${wd.phoneNumber}`, [
          `✅ *Payment sent, ${firstName}!* 🎉`,
          ``,
          `*GHS ${wd.amount.toFixed(2)}* has been sent to your ${wd.method === "momo" ? "MoMo" : "bank account"}:`,
          `${wd.network ?? ""} · ${wd.accountNumber}`,
          ``,
          `Please check your account. If you have any issues, reply here.`,
          ``,
          `Thank you for sharing ZURIA with others — keep going! 💪`,
          `_— ZURIA_`,
        ].join("\n")).catch(() => {});
      }

      return NextResponse.json({ ok: true, message: "Withdrawal marked approved" });
    }

    // ── transfer.failed / transfer.reversed ───────────────────────────────────
    if (eventType === "transfer.failed" || eventType === "transfer.reversed") {
      const transferCode = data.transfer_code as string | undefined;
      const reference    = data.reference     as string | undefined;

      const db = getAdminDb();
      let wdSnap = reference
        ? await db
            .collection(collections.withdrawals)
            .where("paystackReference", "==", reference)
            .limit(1)
            .get()
        : null;

      if (!wdSnap || wdSnap.empty) {
        wdSnap = transferCode
          ? await db
              .collection(collections.withdrawals)
              .where("paystackTransferCode", "==", transferCode)
              .limit(1)
              .get()
          : null;
      }

      if (!wdSnap || wdSnap.empty) {
        console.warn(`[webhook] ${eventType} — no matching withdrawal found`);
        return NextResponse.json({ ok: true, message: "No matching withdrawal" });
      }

      const wdDoc = wdSnap.docs[0];
      const wd    = wdDoc.data() as WithdrawalRequest;

      // Idempotency guard — don't double-restore balance
      if (wd.status === "failed") {
        return NextResponse.json({ ok: true, message: "Already marked failed" });
      }

      const now = new Date().toISOString();

      // ── CRITICAL: restore referral balance on failed transfer ─────────────
      // Without this, money is permanently deducted even though the transfer failed.
      // BUG-3 FIX: Run both writes (withdrawal status + balance restore) inside a
      // single Firestore transaction so they succeed or fail together.  The old
      // Promise.allSettled approach could partially succeed, leaving the withdrawal
      // marked "failed" without the balance restored (or vice-versa).
      await db.runTransaction(async (txn) => {
        // Re-read the withdrawal inside the transaction to guard against concurrent updates
        const freshWdSnap = await txn.get(wdDoc.ref);
        const freshWd = freshWdSnap.data() as WithdrawalRequest | undefined;
        if (!freshWdSnap.exists || freshWd?.status === "failed") {
          // Already handled by a concurrent webhook delivery — nothing to do
          return;
        }

        txn.update(wdDoc.ref, {
          status:      "failed",
          processedAt: now,
          note:        `${eventType} — balance restored automatically`,
        });
        txn.update(db.collection(collections.users).doc(wd.userId), {
          referralBalance: FieldValue.increment(wd.amount), // restore the deducted amount
          updatedAt:       now,
        });
      }).catch((err) => {
        console.error(`[webhook] ${eventType} transaction failed:`, err);
        throw err; // re-throw so the outer catch returns a 200 with ok:false (Paystack retries)
      });

      if (wd.phoneNumber) {
        const firstName = wd.ownerName.split(" ")[0];
        sendText(`whatsapp:${wd.phoneNumber}`, [
          `😔 *Transfer failed, ${firstName}*`,
          ``,
          `We could not send *GHS ${wd.amount.toFixed(2)}* to your account.`,
          `Your balance of *GHS ${wd.amount.toFixed(2)}* has been fully restored.`,
          ``,
          `Please contact us for help. We will resolve it right away. 🙏`,
          `_— ZURIA_`,
        ].join("\n")).catch(() => {});
      }

      return NextResponse.json({ ok: true, message: "Withdrawal marked failed, balance restored" });
    }

    // Unknown event — acknowledge and ignore
    return NextResponse.json({ ok: true, message: `Event ${eventType} not handled` });
  } catch (err) {
    console.error("[webhook] Error processing event:", err);
    // Return 200 so Paystack doesn't retry indefinitely for server errors
    return NextResponse.json({ ok: false, message: "Processing error" });
  }
}
