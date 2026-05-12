import { type NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { verifyIdToken, getAdminDb } from "@/lib/firebase/admin";
import { sendText } from "@/lib/whatsapp/client";
import { fmtWelcome } from "@/lib/whatsapp/formatter";
import { collections } from "@/lib/firebase/collections";
import { createId } from "@/lib/utils";
import { APP_URL } from "@/lib/config";
import type { BusinessCategory, Transaction } from "@/types/domain";

export const dynamic = "force-dynamic";

const REFERRAL_REWARD = 0.5;         // GHS per successful referral
const WITHDRAWAL_THRESHOLD = 5.0;    // GHS needed before user can withdraw
const MONTHLY_UNLOCK_THRESHOLD = 30; // referrals this month needed for Growth unlock

// POST /api/welcome
// Called after a user completes onboarding.
// 1. Sends a WhatsApp welcome message to the new user
// 2. If referralCode is provided, credits the referrer and notifies them on WhatsApp

export async function POST(req: NextRequest) {
  const decoded = await verifyIdToken(req.headers.get("Authorization"));
  if (!decoded) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    phone: string;
    ownerName: string;
    businessName: string;
    category: BusinessCategory;
    referralCode?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { phone, ownerName, businessName, category, referralCode } = body;
  if (!phone || !ownerName || !businessName) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // ── 1. Send welcome WhatsApp to new user ─────────────────────────────────
  try {
    await sendText(`whatsapp:${phone}`, fmtWelcome(ownerName, businessName, category ?? "provision"));
  } catch (err) {
    console.error("[welcome] Failed to send welcome message:", err);
    // Non-critical — continue to referral handling
  }

  // ── 2. Credit referrer if a referral code was used ────────────────────────
  if (referralCode) {
    try {
      await creditReferrer(referralCode, decoded.uid, phone);
    } catch (err) {
      console.error("[welcome] Referral credit failed:", err);
      // Non-critical — user is already registered
    }
  }

  return NextResponse.json({ ok: true });
}

// ─── Server-side referral crediting ──────────────────────────────────────────

async function creditReferrer(referralCode: string, refereeId: string, refereePhone: string): Promise<void> {
  const db = getAdminDb();

  // Find the referrer by their referral code
  const snap = await db
    .collection(collections.users)
    .where("referralCode", "==", referralCode)
    .limit(1)
    .get();
  if (snap.empty) return;

  const referrerDoc = snap.docs[0];
  const referrerId = referrerDoc.id;
  const referrerData = referrerDoc.data();

  // Prevent self-referral
  if (referrerId === refereeId || referrerData.phoneNumber === refereePhone) return;

  // Prevent double-crediting the same referee (check both UID and phone for safety)
  const dupCheckUid = await db
    .collection(collections.referrals)
    .where("referrerId", "==", referrerId)
    .where("refereeId", "==", refereeId)
    .limit(1)
    .get();
  if (!dupCheckUid.empty) return;

  const dupCheckPhone = await db
    .collection(collections.referrals)
    .where("referrerId", "==", referrerId)
    .where("refereePhone", "==", refereePhone)
    .limit(1)
    .get();
  if (!dupCheckPhone.empty) return;

  const oldBalance = (referrerData.referralBalance as number) ?? 0;
  const newBalance = parseFloat((oldBalance + REFERRAL_REWARD).toFixed(2));
  const oldCount = (referrerData.referralCount as number) ?? 0;
  const now = new Date();
  const nowIso = now.toISOString();
  const thisMonth = nowIso.slice(0, 7); // "YYYY-MM"
  const referrerBusinessId = (referrerData.businessId as string | undefined) ?? null;

  // ── Compute monthly referral count (reset if new month) ──────────────────
  const storedMonthlyKey = (referrerData.referralMonthlyResetKey as string) ?? "";
  const oldMonthlyCount = storedMonthlyKey === thisMonth
    ? ((referrerData.referralMonthlyCount as number) ?? 0)
    : 0; // new month → reset
  const newMonthlyCount = oldMonthlyCount + 1;

  // ── Check if milestone just hit (exactly 30 this month) ──────────────────
  const justHitMilestone = newMonthlyCount === MONTHLY_UNLOCK_THRESHOLD;
  // End of the current calendar month at 23:59:59
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString();

  // ── Record the referral event ─────────────────────────────────────────────
  const refId = createId("ref");
  await db.collection(collections.referrals).doc(refId).set({
    id: refId,
    referrerId,
    refereeId,           // Firebase UID of the new user
    refereePhone,        // Phone number of the new user
    amount: REFERRAL_REWARD,
    createdAt: nowIso,
  });

  // ── Credit the referrer's balance + update monthly counter ───────────────
  const userUpdate: Record<string, unknown> = {
    referralBalance: FieldValue.increment(REFERRAL_REWARD),
    referralCount: FieldValue.increment(1),
    referralMonthlyCount: newMonthlyCount,
    referralMonthlyResetKey: thisMonth,
    updatedAt: nowIso,
  };
  // Grant Growth unlock for the rest of the month when milestone is hit
  if (justHitMilestone) {
    userUpdate.referralUnlockExpiresAt = endOfMonth;
  }
  await db.collection(collections.users).doc(referrerId).update(userUpdate);

  // ── Record referral earning as a transaction ──────────────────────────────
  // This makes referral income visible in the admin panel and all-time stats.
  if (referrerBusinessId) {
    const txn: Transaction = {
      id: createId("txn"),
      businessId: referrerBusinessId,
      userId: referrerId,
      type: "investment",
      amount: REFERRAL_REWARD,
      quantity: null,
      productName: "Referral Bonus",
      customerName: null,
      customerNameNormalized: null,
      category: "referral",
      paymentMethod: "unknown",
      currency: "GHS, Cedis",
      notes: `Referral reward — new user ${refereePhone} joined via referral link`,
      rawText: `Referral reward GHS ${REFERRAL_REWARD.toFixed(2)}`,
      confidence: 1,
      createdAt: nowIso,
      syncStatus: "synced",
      source: "system",
    };
    await db.collection(collections.transactions).doc(txn.id).set({ ...txn, synced: nowIso });
  }

  // ── Send WhatsApp notification to referrer ───────────────────────────────
  const referrerPhone = referrerData.phoneNumber as string;
  const firstName = ((referrerData.ownerName as string) ?? "").split(" ")[0] || "Friend";
  const hitsWithdrawalThreshold = oldBalance < WITHDRAWAL_THRESHOLD && newBalance >= WITHDRAWAL_THRESHOLD;
  const referrerCode = (referrerData.referralCode as string) ?? "";
  const referralLink = referrerCode ? `${APP_URL}/login?ref=${referrerCode}` : APP_URL;

  // ── Normal referral notification ──────────────────────────────────────────
  const MILESTONE_BALANCE = parseFloat((MONTHLY_UNLOCK_THRESHOLD * REFERRAL_REWARD).toFixed(2)); // GHS 15
  const referralsToWithdraw = Math.max(0, Math.ceil((WITHDRAWAL_THRESHOLD - newBalance) / REFERRAL_REWARD));
  const remaining30 = MONTHLY_UNLOCK_THRESHOLD - newMonthlyCount;
  const hitsMilestoneBalance = newBalance >= MILESTONE_BALANCE;

  const lines = [
    `🎉 *Great news, ${firstName}!*`,
    ``,
    `Someone just joined ZURIA using your referral link! 🙌`,
    `You earned *GHS ${REFERRAL_REWARD.toFixed(2)}* 💰`,
    ``,
    `💰 Your earnings: *GHS ${newBalance.toFixed(2)}*`,
    `📅 This month: *${newMonthlyCount}/${MONTHLY_UNLOCK_THRESHOLD}* referrals`,
    `👥 All time: *${oldCount + 1}* friend${oldCount + 1 !== 1 ? "s" : ""} joined`,
  ];

  // ── Earnings milestone & withdrawal advice ────────────────────────────────
  if (hitsMilestoneBalance) {
    // Hit full GHS 15 milestone (30 referrals worth)
    lines.push(
      ``,
      `🏆 *You've earned GHS ${MILESTONE_BALANCE.toFixed(2)} — the full milestone!*`,
      `Open ZURIA app → Refer & Earn → Withdraw to request your GHS ${newBalance.toFixed(2)}. 🎊`
    );
  } else if (hitsWithdrawalThreshold) {
    // Just hit GHS 5 — explain the choice
    const moreNeeded = MONTHLY_UNLOCK_THRESHOLD - newMonthlyCount;
    lines.push(
      ``,
      `✅ *You've reached GHS ${WITHDRAWAL_THRESHOLD.toFixed(2)} — you can withdraw now!*`,
      ``,
      `💡 *Or keep going for the big prize:*`,
      `Refer *${moreNeeded} more friend${moreNeeded !== 1 ? "s" : ""} this month* to earn`,
      `GHS ${MILESTONE_BALANCE.toFixed(2)} total + unlock *Growth features FREE!* 🚀`,
      ``,
      `Either way, open ZURIA app → Refer & Earn to withdraw.`
    );
  } else if (newBalance < WITHDRAWAL_THRESHOLD) {
    // Still below GHS 5
    const remainingCash = parseFloat((WITHDRAWAL_THRESHOLD - newBalance).toFixed(2));
    lines.push(
      ``,
      `_GHS ${remainingCash.toFixed(2)} more to reach the GHS ${WITHDRAWAL_THRESHOLD.toFixed(2)} cash-out minimum_`,
      `_(or refer ${referralsToWithdraw} more friend${referralsToWithdraw !== 1 ? "s" : ""})_`
    );
  }

  // Progress towards the 30-referral Growth unlock (show when close)
  if (remaining30 > 0 && remaining30 <= 10 && !hitsMilestoneBalance) {
    lines.push(``, `🔥 _Only ${remaining30} more referral${remaining30 !== 1 ? "s" : ""} this month to unlock *ZURIA Growth features FREE!*_`);
  }

  lines.push(``, `_Your referral link:_`, referralLink, ``, `_— ZURIA_`);

  if (referrerPhone) {
    await sendText(`whatsapp:${referrerPhone}`, lines.join("\n"));
  }

  // ── Milestone: 30 referrals this month → Growth unlock ───────────────────
  if (justHitMilestone) {
    const expDateStr = new Date(endOfMonth).toLocaleDateString("en-GH", {
      day: "numeric", month: "long",
    });
    const milestoneMsg = [
      `🏆 *INCREDIBLE, ${firstName}!* 🏆`,
      ``,
      `You referred *30 people this month!*`,
      ``,
      `As a thank-you, you've just unlocked *ZURIA Growth features* — completely FREE for the rest of the month! 🚀`,
      ``,
      `✅ 200 AI entries this month`,
      `✅ Monthly profit reports`,
      `✅ AI sales insights in your language`,
      `✅ Auto debt reminders via WhatsApp`,
      `✅ Inventory tracking`,
      ``,
      `_Expires: ${expDateStr} (end of this month)_`,
      ``,
      `Keep sharing to earn more rewards — and thank you for spreading the word! 💙`,
      ``,
      `_— ZURIA_`,
    ].join("\n");

    if (referrerPhone) {
      await sendText(`whatsapp:${referrerPhone}`, milestoneMsg);
    }
  }
}
