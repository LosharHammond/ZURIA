import { type NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb, verifyAdminToken } from "@/lib/firebase/admin";
import { collections } from "@/lib/firebase/collections";
import { createTransferRecipient, initiateTransfer, paystackConfigured } from "@/lib/services/paystack-service";
import type { WithdrawalRequest } from "@/types/domain";

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
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  const { id } = await params;
  const db = getAdminDb();
  const wdRef = db.collection(collections.withdrawals).doc(id);
  const wdSnap = await wdRef.get();

  if (!wdSnap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const wd = wdSnap.data() as WithdrawalRequest;
  if (wd.status !== "pending") return NextResponse.json({ error: "Already processed" }, { status: 409 });

  const now = new Date().toISOString();

  if (action === "reject") {
    await wdRef.update({ status: "rejected", processedAt: now, note: note ?? "" });
    return NextResponse.json({ ok: true, status: "rejected" });
  }

  // ── Approve: deduct balance immediately, then try Paystack transfer ─────────
  await Promise.all([
    wdRef.update({ status: "processing", processedAt: now }),
    db.collection(collections.users).doc(wd.userId).update({
      referralBalance: FieldValue.increment(-wd.amount),
      updatedAt: now,
    }),
  ]);

  if (!paystackConfigured()) {
    await wdRef.update({ status: "approved", note: "Processed manually (Paystack not configured)" });
    return NextResponse.json({ ok: true, status: "approved", manual: true });
  }

  try {
    const { recipientCode, error: recipientError } = await createTransferRecipient(wd);
    if (recipientError || !recipientCode) {
      await Promise.all([
        wdRef.update({ status: "failed", note: `Recipient error: ${recipientError}` }),
        db.collection(collections.users).doc(wd.userId).update({
          referralBalance: FieldValue.increment(wd.amount),
          updatedAt: now,
        }),
      ]);
      return NextResponse.json({ error: recipientError ?? "Could not create recipient" }, { status: 502 });
    }

    const { transferCode, status: txStatus, error: txError } = await initiateTransfer({
      amountGHS: wd.amount,
      recipientCode,
      reference: id,
      reason: `ZURIA referral earnings — ${wd.ownerName}`,
    });

    if (txError || !transferCode) {
      await Promise.all([
        wdRef.update({ status: "failed", note: `Transfer error: ${txError}` }),
        db.collection(collections.users).doc(wd.userId).update({
          referralBalance: FieldValue.increment(wd.amount),
          updatedAt: now,
        }),
      ]);
      return NextResponse.json({ error: txError ?? "Transfer failed" }, { status: 502 });
    }

    const finalStatus = txStatus === "success" ? "approved" : "processing";
    await wdRef.update({
      paystackRecipientCode: recipientCode,
      paystackTransferCode: transferCode,
      paystackReference: id,
      status: finalStatus,
    });

    return NextResponse.json({ ok: true, status: finalStatus, transferCode });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Refund on exception
    await Promise.allSettled([
      wdRef.update({ status: "failed", note: `Exception: ${msg}` }),
      db.collection(collections.users).doc(wd.userId).update({
        referralBalance: FieldValue.increment(wd.amount),
        updatedAt: now,
      }),
    ]);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
