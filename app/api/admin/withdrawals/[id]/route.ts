import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb, verifyAdminToken } from "@/lib/firebase/admin";
import { sendText } from "@/lib/whatsapp/client";
import { collections } from "@/lib/firebase/collections";
import type { Transaction, WithdrawalLedgerEntry, WithdrawalRequest } from "@/types/domain";

import {
  createTransferRecipient,
  initiateTransfer,
  paystackConfigured,
} from "@/lib/services/paystack-service";

export const dynamic = "force-dynamic";

const WithdrawalActionSchema = z.object({
  action: z.enum(["approve", "reject"]),
  note:   z.string().max(500).trim().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const decoded = await verifyAdminToken(req.headers.get("Authorization"));
  if (!decoded) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = WithdrawalActionSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 422 }
    );
  }

  const { action, note } = parsed.data;

  const { id } = await params;
  const db = getAdminDb();
  const wdRef = db.collection(collections.withdrawals).doc(id);
  const now = new Date().toISOString();

  // ── TOCTOU-safe status gate ───────────────────────────────────────────────
  // Both approve and reject run inside a Firestore transaction so that two
  // concurrent admin requests cannot both pass the "status === pending" check
  // and then both write — which would double-restore the balance on reject, or
  // trigger two Paystack transfers on approve.
  let wd!: WithdrawalRequest;
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(wdRef);
      if (!snap.exists) throw Object.assign(new Error("not_found"), { code: 404 });
      const data = snap.data() as WithdrawalRequest;
      if (data.status !== "pending") throw Object.assign(new Error("already_processed"), { code: 409 });
      wd = data;

      if (action === "reject") {
        // Flip status + restore balance atomically
        tx.update(wdRef, { status: "rejected", processedAt: now, note: note ?? "" });
        tx.update(db.collection(collections.users).doc(data.userId), {
          referralBalance: FieldValue.increment(data.amount),
          updatedAt: now,
        });
        // Immutable WITHDRAWAL_REJECTED ledger entry — written once inside the
        // transaction so it exists if and only if the rejection committed.
        const rejectedLedgerId = `${id}_WITHDRAWAL_REJECTED`;
        const rejectedEntry: WithdrawalLedgerEntry = {
          id:            rejectedLedgerId,
          withdrawalId:  id,
          userId:        data.userId,
          ownerName:     data.ownerName,
          amountGHS:     data.amount,
          network:       data.network ?? "",
          accountNumber: data.accountNumber ?? "",
          accountName:   data.accountName  ?? "",
          eventType:     "WITHDRAWAL_REJECTED",
          status:        "rejected",
          actorId:       decoded.uid,
          note:          note,
          idempotencyKey: rejectedLedgerId,
          createdAt:     now,
          _immutable:    true,
        };
        tx.set(
          db.collection(collections.withdrawalEvents).doc(rejectedLedgerId),
          rejectedEntry
        );
      } else {
        // Flip status to "processing" immediately to prevent double-approval
        tx.update(wdRef, { status: "processing", processedAt: now, note: note ?? "Pending transfer" });
        // Immutable WITHDRAWAL_APPROVED ledger entry — locks in the admin decision.
        const approvedLedgerId = `${id}_WITHDRAWAL_APPROVED`;
        const approvedEntry: WithdrawalLedgerEntry = {
          id:            approvedLedgerId,
          withdrawalId:  id,
          userId:        data.userId,
          ownerName:     data.ownerName,
          amountGHS:     data.amount,
          network:       data.network ?? "",
          accountNumber: data.accountNumber ?? "",
          accountName:   data.accountName  ?? "",
          eventType:     "WITHDRAWAL_APPROVED",
          status:        "approved",
          actorId:       decoded.uid,
          note:          note,
          idempotencyKey: approvedLedgerId,
          createdAt:     now,
          _immutable:    true,
        };
        tx.set(
          db.collection(collections.withdrawalEvents).doc(approvedLedgerId),
          approvedEntry
        );
      }
    });
  } catch (err: unknown) {
    const e = err as { code?: number };
    if (e.code === 404) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (e.code === 409) return NextResponse.json({ error: "Already processed" }, { status: 409 });
    console.error("[admin/withdrawals] status transaction failed:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const firstName = wd.ownerName.split(" ")[0];

  // ── Reject ────────────────────────────────────────────────────────────────
  if (action === "reject") {
    if (wd.phoneNumber) {
      sendText(`whatsapp:${wd.phoneNumber}`, [
        `😔 *Withdrawal update, ${firstName}*`,
        ``,
        `Your withdrawal request of *GHS ${wd.amount.toFixed(2)}* could not be processed at this time.`,
        note ? `Reason: ${note}` : `Please contact us for more information.`,
        ``,
        `Your balance of *GHS ${wd.amount.toFixed(2)}* has been fully restored — you can try again later.`,
        `_— ZURIA_`,
      ].join("\n")).catch(() => {});
    }
    return NextResponse.json({ ok: true, status: "rejected" });
  }

  // ── Approve: status is now "processing" (locked in tx above) ─────────────
  // Record the accounting transaction (best-effort)
  const userSnap = await db.collection(collections.users).doc(wd.userId).get();
  const businessId = (userSnap.data()?.businessId as string | undefined) ?? null;

  if (businessId) {
    const txn: Transaction = {
      // Deterministic ID prevents duplicate accounting entries if this endpoint
      // is called twice for the same withdrawal (e.g. transient 500 + retry).
      id: `wd_txn_${id}`,
      businessId,
      userId: wd.userId,
      type: "withdrawal",
      amount: wd.amount,
      quantity: null,
      productName: "Referral Withdrawal",
      customerName: null,
      customerNameNormalized: null,
      category: "referral",
      paymentMethod: "momo",
      currency: "GHS, Cedis",
      notes: `Referral earnings withdrawal — ${wd.network ?? "MoMo"} ${wd.accountNumber} (${wd.accountName})`,
      rawText: `Referral withdrawal GHS ${wd.amount.toFixed(2)}`,
      confidence: 1,
      createdAt: now,
      syncStatus: "synced",
      source: "system",
    };
    // merge:true so a retried approve call does not overwrite an already-synced record
    await db.collection(collections.transactions).doc(txn.id)
      .set({ ...txn, synced: now }, { merge: true })
      .catch((err) => console.error("[admin/withdrawals] accounting txn write failed:", err));
  }

  // ── Attempt Paystack auto-transfer ────────────────────────────────────────
  if (paystackConfigured() && !wd.paystackTransferCode) {
    try {
      const { recipientCode, error: recErr } = await createTransferRecipient(wd);
      if (!recErr && recipientCode) {
        const transferRef = `WD-${id}`;
        const { transferCode, status: tStatus, error: txErr } = await initiateTransfer({
          amountGHS:     wd.amount,
          recipientCode,
          reference:     transferRef,
          reason:        `ZURIA referral withdrawal — ${wd.ownerName}`,
        });

        if (!txErr) {
          await wdRef.update({
            status:                tStatus === "success" ? "approved" : "processing",
            processedAt:           tStatus === "success" ? now : null,
            note:                  note ?? "Paystack auto-transfer initiated",
            paystackRecipientCode: recipientCode,
            paystackTransferCode:  transferCode,
            paystackReference:     transferRef,
          });

          if (wd.phoneNumber) {
            const msg =
              tStatus === "success"
                ? [
                    `✅ *Payment sent, ${firstName}!* 🎉`,
                    ``,
                    `*GHS ${wd.amount.toFixed(2)}* has been sent to your MoMo:`,
                    `${wd.network ?? "MoMo"} · ${wd.accountNumber}`,
                    ``,
                    `Please check your account. Thank you for sharing ZURIA! 💪`,
                    `_— ZURIA_`,
                  ].join("\n")
                : [
                    `✅ *Withdrawal processing, ${firstName}!*`,
                    ``,
                    `*GHS ${wd.amount.toFixed(2)}* is on its way to:`,
                    `${wd.network ?? "MoMo"} · ${wd.accountNumber}`,
                    ``,
                    `You'll get a confirmation when it lands. Usually within minutes. 😊`,
                    `_— ZURIA_`,
                  ].join("\n");
            sendText(`whatsapp:${wd.phoneNumber}`, msg).catch(() => {});
          }

          return NextResponse.json({ ok: true, status: tStatus === "success" ? "approved" : "processing" });
        }
      }
    } catch (err) {
      console.error("[admin/withdrawals] Paystack auto-transfer error:", err);
      // Fall through to manual approval below
    }
  }

  // ── Manual approval fallback ──────────────────────────────────────────────
  await wdRef.update({ status: "approved", processedAt: now, note: note ?? "Manual transfer completed" });

  if (wd.phoneNumber) {
    sendText(`whatsapp:${wd.phoneNumber}`, [
      `✅ *Payment sent, ${firstName}!* 🎉`,
      ``,
      `*GHS ${wd.amount.toFixed(2)}* has been sent to your MoMo:`,
      `${wd.network ?? "MoMo"} · ${wd.accountNumber}`,
      ``,
      `Please check your MoMo account. If you have any issues, reply to this message.`,
      ``,
      `Thank you for sharing ZURIA with others — keep going! 💪`,
      `_— ZURIA_`,
    ].join("\n")).catch(() => {});
  }

  return NextResponse.json({ ok: true, status: "approved" });
}
