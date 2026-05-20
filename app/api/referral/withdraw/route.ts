import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { FieldValue } from "firebase-admin/firestore";
import { verifyIdToken, getAdminDb } from "@/lib/firebase/admin";
import { sendText } from "@/lib/whatsapp/client";
import { collections } from "@/lib/firebase/collections";
import { createId } from "@/lib/utils";
import { captureZuriaError } from "@/lib/observability/sentry";
import { createLogger } from "@/lib/observability/logger";
import type { WithdrawalLedgerEntry } from "@/types/domain";
import {
  createTransferRecipient,
  initiateTransfer,
  paystackConfigured,
} from "@/lib/services/paystack-service";

const logger = createLogger("withdraw");

export const dynamic = "force-dynamic";

// The admin's WhatsApp number — receives a message every time a withdrawal is requested
const ADMIN_PHONE = process.env.ADMIN_PHONE ?? process.env.NEXT_PUBLIC_ADMIN_PHONE ?? "";
const WITHDRAWAL_THRESHOLD = 5.0; // GHS minimum

const MOMO_NETWORKS = ["MTN", "Vodafone", "AirtelTigo", "Telecel"] as const;

const WithdrawSchema = z.object({
  momoNumber: z.string().min(8).max(15).regex(/^\+?\d+$/, "Invalid MoMo number"),
  momoName:   z.string().min(1).max(80).trim(),
  network:    z.enum(MOMO_NETWORKS, { errorMap: () => ({ message: "Network must be MTN, Vodafone, AirtelTigo, or Telecel" }) }),
});

// POST /api/referral/withdraw
// User submits a MoMo withdrawal request.
// Saves to Firestore + notifies admin on WhatsApp + confirms to user on WhatsApp.

export async function POST(req: NextRequest) {
  const decoded = await verifyIdToken(req.headers.get("Authorization"));
  if (!decoded) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = WithdrawSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 422 }
    );
  }

  const { momoNumber, momoName, network } = parsed.data;

  const db = getAdminDb();
  const uid = decoded.uid;

  // BUG-8/9/10 FIX: All three critical steps — balance read, threshold check,
  // pending-withdrawal guard, document creation, and balance deduction — must
  // happen atomically inside a single Firestore transaction.
  //
  // Previous code read the balance and pending status in separate await calls,
  // then wrote the withdrawal document, then deducted the balance in yet another
  // await.  Two concurrent requests could both pass the threshold check and the
  // pending check before either deduction committed, resulting in:
  //   • Double-withdrawal (user paid twice their balance)
  //   • Withdrawal document existing without a balance deduction (free money)
  //
  // The Firestore transaction serialises all writers; only the first commit wins.

  // Pending-withdrawal pre-check — Firestore transactions cannot run collection
  // queries, so we check before entering the transaction as a fast early exit.
  // This is best-effort; the atomic balance deduction inside the transaction is
  // the authoritative race guard — balance cannot go negative.
  const pendingSnap = await db
    .collection(collections.withdrawals)
    .where("userId", "==", uid)
    .where("status", "==", "pending")
    .limit(1)
    .get();
  if (!pendingSnap.empty) {
    return NextResponse.json({ error: "You already have a pending withdrawal. Please wait for it to be processed." }, { status: 409 });
  }

  const userRef = db.collection(collections.users).doc(uid);
  const id  = createId("wd");
  const now = new Date().toISOString();

  // Variables are populated inside the Firestore transaction below.
  // The non-null assertions on use are safe: the transaction throws on any
  // path that does not assign them, so the catch block returns before we reach
  // any subsequent code that references these.
  let balance   = 0;
  let ownerName = "";
  let userPhone = "";

  try {
    await db.runTransaction(async (txn) => {
      // 1. Read user document (inside transaction for serialised, up-to-date read)
      const userSnap = await txn.get(userRef);
      if (!userSnap.exists) {
        throw Object.assign(new Error("User not found"), { statusCode: 404 });
      }
      const userData = userSnap.data()!;
      balance   = (userData.referralBalance as number) ?? 0;
      ownerName = (userData.ownerName   as string) ?? "User";
      userPhone = (userData.phoneNumber as string) ?? "";

      // 2. Enforce minimum withdrawal balance (inside transaction — authoritative)
      if (balance < WITHDRAWAL_THRESHOLD) {
        throw Object.assign(
          new Error(`You need at least GHS ${WITHDRAWAL_THRESHOLD.toFixed(2)} to withdraw. Your balance is GHS ${balance.toFixed(2)}.`),
          { statusCode: 400 }
        );
      }

      // 3. Write the withdrawal document, immutable ledger entry, and balance
      //    deduction atomically in one transaction.
      //    • The ledger entry ensures every withdrawal request is permanently
      //      traceable even if the withdrawal doc is later modified.
      //    • The balance deduction prevents concurrent withdrawals from both
      //      passing the threshold check.
      const withdrawalRef = db.collection(collections.withdrawals).doc(id);
      txn.set(withdrawalRef, {
        id,
        userId:        uid,
        ownerName,
        phoneNumber:   userPhone,
        amount:        balance,
        method:        "momo" as const,
        network,
        accountNumber: momoNumber.trim(),
        accountName:   momoName.trim(),
        status:        "pending" as const,
        createdAt:     now,
      });

      // Immutable WITHDRAWAL_REQUESTED ledger entry — written once, never modified.
      const requestedLedgerId = `${id}_WITHDRAWAL_REQUESTED`;
      const requestedEntry: WithdrawalLedgerEntry = {
        id:            requestedLedgerId,
        withdrawalId:  id,
        userId:        uid,
        ownerName,
        amountGHS:     balance,
        network,
        accountNumber: momoNumber.trim(),
        accountName:   momoName.trim(),
        eventType:     "WITHDRAWAL_REQUESTED",
        status:        "pending",
        actorId:       "system",
        idempotencyKey: requestedLedgerId,
        createdAt:     now,
        _immutable:    true,
      };
      txn.set(
        db.collection(collections.withdrawalEvents).doc(requestedLedgerId),
        requestedEntry
      );

      // ── CRITICAL: Deduct referral balance atomically with the document write ─
      // This prevents users from submitting multiple withdrawals before the first
      // one completes. The webhook (transfer.failed) restores the balance on failure.
      // Admin rejection also restores the balance (see admin/withdrawals/[id] PATCH).
      txn.update(userRef, {
        referralBalance: FieldValue.increment(-balance),
        updatedAt:       now,
      });
    });
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    const statusCode = e?.statusCode ?? 500;
    const message    = e?.message    ?? "Internal server error";
    if (statusCode < 500) {
      return NextResponse.json({ error: message }, { status: statusCode });
    }
    captureZuriaError(err instanceof Error ? err : new Error(String(err)), { extra: { route: "referral/withdraw", userId: uid } });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const withdrawalData = {
    id,
    userId:        uid,
    ownerName,
    phoneNumber:   userPhone,
    amount:        balance,
    method:        "momo" as const,
    network,
    accountNumber: momoNumber.trim(),
    accountName:   momoName.trim(),
    status:        "pending" as const,
    createdAt:     now,
  };

  // ── Auto-initiate Paystack transfer if configured ─────────────────────────
  if (paystackConfigured()) {
    (async () => {
      try {
        const { recipientCode, error: recError } = await createTransferRecipient({
          ...withdrawalData,
          id,
          paystackRecipientCode: undefined,
          paystackTransferCode:  undefined,
          paystackReference:     undefined,
        });

        if (recError || !recipientCode) {
          logger.error("createTransferRecipient failed", { withdrawalId: id, error: String(recError) });
          // Fall through to admin notification
          notifyAdminManual(id, ownerName, userPhone, balance, network, momoNumber, momoName);
          return;
        }

        const transferRef = `WD-${id}`;
        const { transferCode, status: tStatus, error: txError } = await initiateTransfer({
          amountGHS:     balance,
          recipientCode,
          reference:     transferRef,
          reason:        `ZURIA referral earnings — ${ownerName} (${userPhone})`,
        });

        if (txError) {
          logger.error("initiateTransfer failed", { withdrawalId: id, error: String(txError) });
          notifyAdminManual(id, ownerName, userPhone, balance, network, momoNumber, momoName);
          return;
        }

        // Update withdrawal record with Paystack details
        await db.collection(collections.withdrawals).doc(id).update({
          paystackRecipientCode: recipientCode,
          paystackTransferCode:  transferCode,
          paystackReference:     transferRef,
          status:                tStatus === "success" ? "approved" : "processing",
          processedAt:           tStatus === "success" ? new Date().toISOString() : null,
        });

        // Notify user
        if (userPhone) {
          const firstName = ownerName.split(" ")[0];
          const msg =
            tStatus === "success"
              ? [
                  `✅ *Payment sent, ${firstName}!* 🎉`,
                  ``,
                  `*GHS ${balance.toFixed(2)}* has been sent to:`,
                  `${network} · ${momoNumber.trim()}`,
                  ``,
                  `Please check your MoMo. Thank you for sharing ZURIA! 💪`,
                  `_— ZURIA_`,
                ].join("\n")
              : [
                  `✅ *Withdrawal submitted, ${firstName}!*`,
                  ``,
                  `*GHS ${balance.toFixed(2)}* is being processed to:`,
                  `${network} · ${momoNumber.trim()}`,
                  ``,
                  `You'll get a confirmation when it lands. Usually within minutes. 😊`,
                  `_— ZURIA_`,
                ].join("\n");
          sendText(`whatsapp:${userPhone}`, msg).catch(() => {});
        }
      } catch (err) {
        logger.error("Paystack auto-transfer error", { withdrawalId: id, error: String(err) });
        notifyAdminManual(id, ownerName, userPhone, balance, network, momoNumber, momoName);
      }
    })();
  } else {
    // Paystack not configured — fall back to manual admin notification
    notifyAdminManual(id, ownerName, userPhone, balance, network, momoNumber, momoName);

    // Confirm to user
    if (userPhone) {
      const firstName = ownerName.split(" ")[0];
      sendText(`whatsapp:${userPhone}`, [
        `✅ *Withdrawal request received, ${firstName}!*`,
        ``,
        `Amount: *GHS ${balance.toFixed(2)}*`,
        `MoMo: ${network} · ${momoNumber.trim()}`,
        ``,
        `We will process it and send the money within 24 hours. 😊`,
        ``,
        `_Thank you for sharing ZURIA! 🙏_`,
        `_— ZURIA_`,
      ].join("\n")).catch(() => {});
    }
  }

  return NextResponse.json({ ok: true, id });
}

function notifyAdminManual(
  id: string,
  ownerName: string,
  userPhone: string,
  balance: number,
  network: string,
  momoNumber: string,
  momoName: string
) {
  if (!ADMIN_PHONE) return;
  sendText(`whatsapp:${ADMIN_PHONE}`, [
    `💰 *New ZURIA Withdrawal Request*`,
    ``,
    `From: *${ownerName}*`,
    `WhatsApp: ${userPhone}`,
    `Amount: *GHS ${balance.toFixed(2)}*`,
    ``,
    `MoMo Network: ${network}`,
    `MoMo Number: ${momoNumber.trim()}`,
    `Name on Account: ${momoName.trim()}`,
    ``,
    `Reference ID: \`${id}\``,
    ``,
    `_Paystack auto-transfer unavailable — please process manually._`,
  ].join("\n")).catch((err) =>
    logger.warn("Admin notification failed", { withdrawalId: id, error: String(err) })
  );
}
