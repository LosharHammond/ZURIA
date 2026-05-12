import { type NextRequest, NextResponse } from "next/server";
import { verifyIdToken, getAdminDb } from "@/lib/firebase/admin";
import { sendText } from "@/lib/whatsapp/client";
import { collections } from "@/lib/firebase/collections";
import { createId } from "@/lib/utils";

export const dynamic = "force-dynamic";

// The admin's WhatsApp number — receives a message every time a withdrawal is requested
const ADMIN_PHONE = process.env.ADMIN_PHONE ?? process.env.NEXT_PUBLIC_ADMIN_PHONE ?? "";
const WITHDRAWAL_THRESHOLD = 5.0; // GHS minimum

// POST /api/referral/withdraw
// User submits a MoMo withdrawal request.
// Saves to Firestore + notifies admin on WhatsApp + confirms to user on WhatsApp.

export async function POST(req: NextRequest) {
  const decoded = await verifyIdToken(req.headers.get("Authorization"));
  if (!decoded) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    momoNumber: string;
    momoName: string;
    network: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { momoNumber, momoName, network } = body;
  if (!momoNumber?.trim() || !momoName?.trim() || !network?.trim()) {
    return NextResponse.json({ error: "MoMo number, name, and network are required" }, { status: 400 });
  }

  const db = getAdminDb();
  const uid = decoded.uid;

  // Load the user's current data
  const userSnap = await db.collection(collections.users).doc(uid).get();
  if (!userSnap.exists) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  const userData = userSnap.data()!;
  const balance = (userData.referralBalance as number) ?? 0;
  const ownerName = (userData.ownerName as string) ?? "User";
  const userPhone = (userData.phoneNumber as string) ?? "";

  // Enforce minimum withdrawal balance
  if (balance < WITHDRAWAL_THRESHOLD) {
    return NextResponse.json(
      { error: `You need at least GHS ${WITHDRAWAL_THRESHOLD.toFixed(2)} to withdraw. Your balance is GHS ${balance.toFixed(2)}.` },
      { status: 400 }
    );
  }

  // Block if there's already a pending withdrawal
  const pendingSnap = await db
    .collection(collections.withdrawals)
    .where("userId", "==", uid)
    .where("status", "==", "pending")
    .limit(1)
    .get();
  if (!pendingSnap.empty) {
    return NextResponse.json({ error: "You already have a pending withdrawal. Please wait for it to be processed." }, { status: 409 });
  }

  // Save the withdrawal request
  const id = createId("wd");
  const now = new Date().toISOString();
  const withdrawalData = {
    id,
    userId: uid,
    ownerName,
    phoneNumber: userPhone,
    amount: balance,
    method: "momo" as const,
    network,
    accountNumber: momoNumber.trim(),
    accountName: momoName.trim(),
    status: "pending" as const,
    createdAt: now,
  };

  await db.collection(collections.withdrawals).doc(id).set(withdrawalData);

  // ── Notify admin on WhatsApp ──────────────────────────────────────────────
  if (ADMIN_PHONE) {
    const adminMsg = [
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
      `_Please transfer the money and mark as complete in the ZURIA admin panel._`,
    ].join("\n");

    sendText(`whatsapp:${ADMIN_PHONE}`, adminMsg).catch((err) =>
      console.error("[withdraw] Admin notification failed:", err)
    );
  }

  // ── Confirm to user on WhatsApp ───────────────────────────────────────────
  if (userPhone) {
    const firstName = ownerName.split(" ")[0];
    const userMsg = [
      `✅ *Withdrawal request received, ${firstName}!*`,
      ``,
      `Amount: *GHS ${balance.toFixed(2)}*`,
      `MoMo: ${network} · ${momoNumber.trim()}`,
      ``,
      `We will process it and send the money to your MoMo number within 24 hours. 😊`,
      ``,
      `_Thank you for sharing ZURIA with others! 🙏_`,
      `_— ZURIA_`,
    ].join("\n");

    sendText(`whatsapp:${userPhone}`, userMsg).catch((err) =>
      console.error("[withdraw] User confirmation failed:", err)
    );
  }

  return NextResponse.json({ ok: true, id });
}
