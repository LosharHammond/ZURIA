import { type NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { collections } from "@/lib/firebase/collections";
import { verifyPaystackSignature } from "@/lib/services/paystack-service";
import type { WithdrawalRequest } from "@/types/domain";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-paystack-signature") ?? "";

  if (!verifyPaystackSignature(rawBody, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  let event: { event: string; data: { reference: string; transfer_code: string; status: string; reason?: string } };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { event: eventType, data } = event;

  if (!eventType.startsWith("transfer.")) {
    return NextResponse.json({ received: true });
  }

  try {
    const db = getAdminDb();
    const wdRef = db.collection(collections.withdrawals).doc(data.reference);
    const wdSnap = await wdRef.get();

    if (!wdSnap.exists) {
      return NextResponse.json({ received: true });
    }

    const wd = wdSnap.data() as WithdrawalRequest;
    const now = new Date().toISOString();

    if (eventType === "transfer.success") {
      await wdRef.update({ status: "approved", processedAt: now });
    } else if (eventType === "transfer.failed" || eventType === "transfer.reversed") {
      if (wd.status !== "approved") {
        // Use allSettled so refund always attempts even if status update fails
        const results = await Promise.allSettled([
          wdRef.update({ status: "failed", processedAt: now, note: data.reason ?? eventType }),
          db.collection(collections.users).doc(wd.userId).update({
            referralBalance: FieldValue.increment(wd.amount),
            updatedAt: now,
          }),
        ]);
        // Log any failures so we can investigate manually
        results.forEach((r, i) => {
          if (r.status === "rejected") {
            console.error(`[paystack webhook] allSettled[${i}] failed:`, r.reason);
          }
        });
      }
    }
  } catch (err) {
    console.error("[paystack webhook] error:", err);
    // Still return 200 so Paystack doesn't retry indefinitely
    return NextResponse.json({ received: true, warning: "Internal error — logged" });
  }

  return NextResponse.json({ received: true });
}
