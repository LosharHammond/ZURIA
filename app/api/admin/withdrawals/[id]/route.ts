import { type NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb, verifyAdminToken } from "@/lib/firebase/admin";
import { sendText } from "@/lib/whatsapp/client";
import { collections } from "@/lib/firebase/collections";
import type { Transaction, WithdrawalRequest } from "@/types/domain";
import { createId } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Paystack automated transfer is disabled — withdrawals are processed manually.
// The Paystack service code is preserved in lib/services/paystack-service.ts
// and can be re-enabled by importing it and restoring the transfer block below.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const decoded = await verifyAdminToken(req.headers.get("Authorization"));
  if (!decoded) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { action, note } = await req.json() as { action: "approve" | "reject"; note?: string };
  if (action !== "approve" && action !== "reject") {
    return NextResponse.json({ error: "action must be 'approve' or 'reject'" }, { status: 400 });
  }

  const { id } = await params;
  const db = getAdminDb();
  const wdRef = db.collection(collections.withdrawals).doc(id);
  const wdSnap = await wdRef.get();

  if (!wdSnap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const wd = wdSnap.data() as WithdrawalRequest;
  if (wd.status !== "pending") return NextResponse.json({ error: "Already processed" }, { status: 409 });

  const now = new Date().toISOString();
  const firstName = wd.ownerName.split(" ")[0];

  // ── Reject ────────────────────────────────────────────────────────────────
  if (action === "reject") {
    await wdRef.update({ status: "rejected", processedAt: now, note: note ?? "" });

    if (wd.phoneNumber) {
      sendText(`whatsapp:${wd.phoneNumber}`, [
        `😔 *Withdrawal update, ${firstName}*`,
        ``,
        `Your withdrawal request of *GHS ${wd.amount.toFixed(2)}* could not be processed at this time.`,
        note ? `Reason: ${note}` : `Please contact us for more information.`,
        ``,
        `Your balance has not been changed — you can try again later.`,
        `_— ZURIA_`,
      ].join("\n")).catch(() => {});
    }

    return NextResponse.json({ ok: true, status: "rejected" });
  }

  // ── Approve: deduct balance + update status + record transaction ──────────
  // Load user data to get businessId for the transaction record
  const userSnap = await db.collection(collections.users).doc(wd.userId).get();
  const businessId = (userSnap.data()?.businessId as string | undefined) ?? null;

  const writes: Promise<unknown>[] = [
    wdRef.update({ status: "approved", processedAt: now, note: note ?? "Manual transfer completed" }),
    db.collection(collections.users).doc(wd.userId).update({
      referralBalance: FieldValue.increment(-wd.amount),
      updatedAt: now,
    }),
  ];

  // Record the withdrawal as a transaction so it appears in all-time stats
  if (businessId) {
    const txn: Transaction = {
      id: createId("txn"),
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
    writes.push(
      db.collection(collections.transactions).doc(txn.id).set({ ...txn, synced: now })
    );
  }

  await Promise.all(writes);

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
