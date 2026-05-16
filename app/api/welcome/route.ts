/**
 * POST /api/welcome
 *
 * Called by the onboarding form after a successful account creation.
 * Responsibilities:
 *  1. Send a WhatsApp welcome message to the new user
 *  2. Credit the referrer — this is the SOLE authoritative trigger for
 *     referral rewards in the entire system. The reward fires here because:
 *       a) The user is fully authenticated (valid Firebase ID token required)
 *       b) Onboarding has been completed (account exists in Firestore)
 *       c) This endpoint is the last server-side step before /welcome page
 *
 * Security model:
 *  - referredByCode is read from the user's Firestore document (written by
 *    /api/auth/register at account creation time), NOT from the request body.
 *    This prevents a malicious caller from POST-ing a different referral code
 *    than the one that was legitimately used during sign-up.
 *  - Rewards are idempotent: a deterministic Firestore doc ID (referrerId_refereeId)
 *    is used so concurrent or retried calls never double-credit.
 *  - An immutable referral_events ledger entry is written alongside every reward.
 */

import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { FieldValue } from "firebase-admin/firestore";
import { verifyIdToken, getAdminDb } from "@/lib/firebase/admin";
import { sendText } from "@/lib/whatsapp/client";
import { fmtWelcome } from "@/lib/whatsapp/formatter";
import { collections } from "@/lib/firebase/collections";
import { createId } from "@/lib/utils";
import { APP_URL } from "@/lib/config";
import type { Transaction } from "@/types/domain";

export const dynamic = "force-dynamic";

const REFERRAL_REWARD        = 0.5;   // GHS per successful referral
const WITHDRAWAL_THRESHOLD   = 5.0;   // GHS minimum to withdraw (10 referrals)
const MONTHLY_UNLOCK_THRESHOLD = 30;  // referrals/month needed for Growth unlock
const MILESTONE_BALANCE      = parseFloat((MONTHLY_UNLOCK_THRESHOLD * REFERRAL_REWARD).toFixed(2)); // GHS 15

const BUSINESS_CATEGORIES = [
  "provision", "food", "restaurant", "barber", "salon",
  "momo", "pharmacy", "cosmetics", "hardware", "spare-parts", "other",
] as const;

const WelcomeSchema = z.object({
  phone:        z.string().min(8).max(20).regex(/^\+?\d+$/, "Invalid phone number"),
  ownerName:    z.string().min(1).max(80).trim(),
  businessName: z.string().min(1).max(120).trim(),
  category:     z.enum(BUSINESS_CATEGORIES).default("provision"),
  // referralCode in the body is intentionally IGNORED for reward processing.
  // The authoritative code is stored on the user document by /api/auth/register.
  // We accept it here only for informational logging.
});

export async function POST(req: NextRequest) {
  const decoded = await verifyIdToken(req.headers.get("Authorization"));
  if (!decoded) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = WelcomeSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 422 }
    );
  }

  const { phone, ownerName, businessName, category } = parsed.data;
  const refereeId = decoded.uid;
  const db        = getAdminDb();

  // ── 1. Read the referee's stored referredByCode from Firestore ─────────────
  // This is the ONLY authoritative source. We do NOT trust the client-sent code.
  const userSnap = await db.collection(collections.users).doc(refereeId).get();
  const userData  = userSnap.data() ?? {};
  const referredByCode = (userData.referredByCode as string | null) ?? null;

  // ── 2. Send welcome WhatsApp + credit referrer in parallel ─────────────────
  const tasks: Promise<unknown>[] = [
    sendText(`whatsapp:${phone}`, fmtWelcome(ownerName, businessName, category ?? "provision"))
      .catch((err) => console.error("[welcome] Failed to send welcome message:", err)),
  ];

  if (referredByCode) {
    // ── Fast-path self-referral guard ──────────────────────────────────────
    // If the code being used equals the user's own referral code, they attempted
    // to refer themselves. Block before the expensive Firestore lookup.
    // The inner creditReferrer guard (referrerId === refereeId) is a second layer.
    const ownCode = (userData.referralCode as string | null) ?? null;
    if (ownCode && referredByCode === ownCode) {
      console.warn(`[welcome] Self-referral blocked (own code) — uid=${refereeId}`);
      // Emit a fraud signal for monitoring (best-effort, non-blocking)
      db.collection(collections.fraudSignals).add({
        type:        "SELF_REFERRAL",
        severity:    "MEDIUM",
        userId:      refereeId,
        phone,
        referralCode: referredByCode,
        detectedAt:  new Date().toISOString(),
        source:      "welcome_route",
      }).catch(() => {});
    } else {
      tasks.push(
        creditReferrer(db, referredByCode, refereeId, phone, (userData.businessId as string | null) ?? null)
          .catch((err) => console.error("[welcome] Referral credit failed:", err))
      );
    }
  }

  await Promise.allSettled(tasks);

  return NextResponse.json({ ok: true });
}

// ─── Server-side referral crediting (sole trigger for referral rewards) ───────

async function creditReferrer(
  db: ReturnType<typeof getAdminDb>,
  referralCode: string,
  refereeId: string,
  refereePhone: string,
  refereeBusinessId: string | null,
): Promise<void> {

  // Find the referrer by their referral code
  const snap = await db
    .collection(collections.users)
    .where("referralCode", "==", referralCode)
    .limit(1)
    .get();
  if (snap.empty) {
    console.warn(`[welcome/creditReferrer] Unknown referral code: ${referralCode}`);
    return;
  }

  const referrerDoc  = snap.docs[0];
  const referrerId   = referrerDoc.id;
  const referrerData = referrerDoc.data();

  // Prevent self-referral (belt-and-suspenders — register already prevents this
  // by not storing self-referredByCode, but guard again here for safety).
  if (referrerId === refereeId || referrerData.phoneNumber === refereePhone) {
    console.warn(`[welcome/creditReferrer] Self-referral blocked for uid=${refereeId}`);
    return;
  }

  // Deterministic document ID — same pair → same doc → TOCTOU-safe via Firestore transaction.
  // This is the primary idempotency mechanism: any re-call for the same (referrer, referee)
  // pair will find the existing document inside the transaction and exit without double-crediting.
  const refDocId   = `${referrerId}_${refereeId}`;
  const refDocRef  = db.collection(collections.referrals).doc(refDocId);
  const referrerRef = db.collection(collections.users).doc(referrerId);

  const now          = new Date();
  const nowIso       = now.toISOString();
  const thisMonth    = nowIso.slice(0, 7); // "YYYY-MM" in UTC
  // End-of-month in UTC (first moment of the next month, exclusive)
  const endOfMonth   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
  const referralLink = referrerData.referralCode
    ? `${APP_URL}/?ref=${referrerData.referralCode as string}`
    : APP_URL;

  let justHitMilestone  = false;
  let newMonthlyCount   = 0;
  let oldCount          = 0;
  let oldBalance        = 0;
  let newBalance        = 0;

  // ── TOCTOU-safe Firestore transaction ─────────────────────────────────────
  // All reads happen inside the transaction. Only the first commit for a given
  // (referrer, referee) pair will succeed; subsequent calls see an existing
  // refDocRef and return early without modifying any balances.
  try {
    await db.runTransaction(async (tx) => {
      // Primary idempotency check — exit cleanly if already credited
      const refSnap = await tx.get(refDocRef);
      if (refSnap.exists) return;

      const freshReferrer = await tx.get(referrerRef);
      const d             = freshReferrer.data() ?? {};

      oldBalance  = (d.referralBalance as number) ?? 0;
      oldCount    = (d.referralCount   as number) ?? 0;
      newBalance  = parseFloat((oldBalance + REFERRAL_REWARD).toFixed(2));

      // Monthly count — reset if calendar month has rolled over
      const storedKey       = (d.referralMonthlyResetKey as string) ?? "";
      const oldMonthlyCount = storedKey === thisMonth
        ? ((d.referralMonthlyCount as number) ?? 0)
        : 0;
      newMonthlyCount = oldMonthlyCount + 1;

      // Milestone fires when this referral CROSSES the threshold from below
      justHitMilestone =
        newMonthlyCount >= MONTHLY_UNLOCK_THRESHOLD &&
        oldMonthlyCount < MONTHLY_UNLOCK_THRESHOLD;

      // ── Write referral record (the idempotency sentinel) ──────────────────
      tx.set(refDocRef, {
        id:           refDocId,
        referrerId,
        refereeId,
        refereePhone,
        amount:       REFERRAL_REWARD,
        createdAt:    nowIso,
      });

      // ── Update referrer balance atomically ────────────────────────────────
      const userUpdate: Record<string, unknown> = {
        referralBalance:         FieldValue.increment(REFERRAL_REWARD),
        referralCount:           FieldValue.increment(1),
        referralMonthlyCount:    newMonthlyCount,
        referralMonthlyResetKey: thisMonth,
        updatedAt:               nowIso,
      };
      if (justHitMilestone) {
        userUpdate.referralUnlockExpiresAt = endOfMonth;
      }
      tx.update(referrerRef, userUpdate);

      // ── Write immutable referral event to the audit ledger ────────────────
      // The ledger doc ID is the same as the referral doc ID for 1-to-1 traceability.
      // It is written inside the same transaction so it's atomic with the credit.
      tx.set(db.collection(collections.referralEvents).doc(refDocId), {
        id:            refDocId,
        type:          "referral_reward",
        referrerId,
        refereeId,
        refereePhone,
        amount:        REFERRAL_REWARD,
        currency:      "GHS",
        referralCode,
        balanceBefore: oldBalance,
        balanceAfter:  newBalance,
        monthlyCount:  newMonthlyCount,
        milestone:     justHitMilestone,
        createdAt:     nowIso,
        // Immutability marker — this collection should only be appended to.
        _immutable:    true,
      });
    });
  } catch (txErr) {
    console.error("[welcome/creditReferrer] transaction failed:", txErr);
    return; // Abort notifications for a failed credit
  }

  // ── Record referral earning in business transaction history ───────────────
  // Makes referral income visible in dashboard stats and admin panel.
  // Uses createId (random) — a separate read-model entry, not the idempotency doc.
  // Best-effort: failure here does NOT affect the balance (already updated above).
  const referrerBusinessId = (referrerData.businessId as string | undefined);
  if (referrerBusinessId) {
    const txnId = `ref_${refDocId}`; // deterministic ID for idempotency
    const txn: Transaction = {
      id:                    txnId,
      businessId:            referrerBusinessId,
      userId:                referrerId,
      type:                  "investment",
      amount:                REFERRAL_REWARD,
      quantity:              null,
      productName:           "Referral Reward",
      customerName:          null,
      customerNameNormalized: null,
      category:              "referral",
      paymentMethod:         "unknown",
      currency:              "GHS, Cedis",
      notes:                 `Referral reward — new user ${refereePhone} joined via referral link`,
      rawText:               `Referral reward GHS ${REFERRAL_REWARD.toFixed(2)}`,
      confidence:            1,
      createdAt:             nowIso,
      syncStatus:            "synced",
      source:                "system",
    };
    // set() with the deterministic ID is idempotent — a retry won't duplicate it.
    await db.collection(collections.transactions).doc(txnId).set(txn).catch(() => {});
  }

  // ── WhatsApp notification to referrer ─────────────────────────────────────
  const referrerPhone    = referrerData.phoneNumber as string;
  const firstName        = ((referrerData.ownerName as string) ?? "").split(" ")[0] || "Friend";
  const hitsWithdrawal   = oldBalance < WITHDRAWAL_THRESHOLD && newBalance >= WITHDRAWAL_THRESHOLD;
  const referralsToWithdraw  = Math.max(0, Math.ceil((WITHDRAWAL_THRESHOLD - newBalance) / REFERRAL_REWARD));
  const remaining30      = MONTHLY_UNLOCK_THRESHOLD - newMonthlyCount;

  const lines: string[] = [
    `🎉 *Great news, ${firstName}!*`,
    ``,
    `Someone just joined ZURIA using your referral link! 🙌`,
    `You earned *GHS ${REFERRAL_REWARD.toFixed(2)}* 💰`,
    ``,
    `💰 Your earnings: *GHS ${newBalance.toFixed(2)}*`,
    `📅 This month: *${newMonthlyCount}/${MONTHLY_UNLOCK_THRESHOLD}* referrals`,
    `👥 All time: *${oldCount + 1}* friend${oldCount + 1 !== 1 ? "s" : ""} joined`,
  ];

  if (newBalance >= MILESTONE_BALANCE) {
    lines.push(
      ``,
      `🏆 *You've earned GHS ${MILESTONE_BALANCE.toFixed(2)} — the full milestone!*`,
      `Open ZURIA app → Refer & Earn → Withdraw to request your GHS ${newBalance.toFixed(2)}. 🎊`
    );
  } else if (hitsWithdrawal) {
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
    const remainingCash = parseFloat((WITHDRAWAL_THRESHOLD - newBalance).toFixed(2));
    lines.push(
      ``,
      `_GHS ${remainingCash.toFixed(2)} more to reach the GHS ${WITHDRAWAL_THRESHOLD.toFixed(2)} cash-out minimum_`,
      `_(or refer ${referralsToWithdraw} more friend${referralsToWithdraw !== 1 ? "s" : ""})_`
    );
  }

  if (remaining30 > 0 && remaining30 <= 10 && newBalance < MILESTONE_BALANCE) {
    lines.push(``, `🔥 _Only ${remaining30} more referral${remaining30 !== 1 ? "s" : ""} this month to unlock *ZURIA Growth features FREE!*_`);
  }

  lines.push(``, `_Your referral link:_`, referralLink, ``, `_— ZURIA_`);

  const notifTasks: Promise<unknown>[] = [];

  if (referrerPhone) {
    notifTasks.push(
      sendText(`whatsapp:${referrerPhone}`, lines.join("\n")).catch(() => {})
    );
  }

  // ── Milestone: 30 referrals this month → Growth unlock notification ───────
  if (justHitMilestone && referrerPhone) {
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
    notifTasks.push(
      sendText(`whatsapp:${referrerPhone}`, milestoneMsg).catch(() => {})
    );
  }

  await Promise.allSettled(notifTasks);
}
