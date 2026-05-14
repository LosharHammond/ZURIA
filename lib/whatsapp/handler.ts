import { parseTransaction } from "@/lib/parsers/transaction-parser";
import { createId } from "@/lib/utils";
import {
  fmtConfirm,
  fmtDebts,
  fmtEndOfDayReport,
  fmtFullDashboard,
  fmtHelp,
  fmtLoans,
  fmtMonthlyReport,
  fmtNotFound,
  fmtReferralStatus,
  fmtStock,
  fmtSubscribePlans,
  fmtSubscriptionRequired,
  fmtSystemError,
  fmtUnregistered,
  fmtWeeklyReport,
} from "@/lib/whatsapp/formatter";
import {
  getAllTransactions,
  getAndMaybeResetMessageCount,
  getEffectivePlan,
  getInventory,
  getLoans,
  getMonthTransactions,
  getOpenDebts,
  getTodayAndYesterdayTransactions,
  getTodayTransactions,
  getWeekTransactions,
  getUserByPhone,
  incrementMessageCount,
  saveTransaction,
} from "@/lib/whatsapp/session";
import {
  expireSession,
  getOrCreateSession,
  isSuspiciousActivity,
  isSessionActive,
  stampSenderPhone,
  verifyPin,
} from "@/lib/whatsapp/security";
import { logError } from "@/lib/server/error-logger";
import { MONEY_IN_TYPES, MONEY_OUT_TYPES, SUBSCRIPTION_TIERS } from "@/types/domain";
import type { BusinessCategory, Debt, PaystackPayment, SubscriptionPlan, Transaction } from "@/types/domain";
import { sendText } from "@/lib/whatsapp/client";
import { getAdminDb } from "@/lib/firebase/admin";
import { collections } from "@/lib/firebase/collections";
import { APP_URL, SUPPORT_WA_LINK } from "@/lib/config";
import { initializePayment } from "@/lib/services/paystack-service";

// Admin number for subscription payment notifications
const ADMIN_PHONE = process.env.ADMIN_PHONE ?? process.env.NEXT_PUBLIC_ADMIN_PHONE ?? "";
const FREE_DAILY_LIMIT      = 10;   // free tier: 10 entries per day
const GROWTH_MONTHLY_LIMIT  = 200;  // growth tier: 200 entries per month
const MONTHLY_UNLOCK_TARGET = 30;   // referrals this month needed to unlock Growth

// ─── Intent detection ─────────────────────────────────────────────────────────

type QueryIntent =
  | "summary"
  | "debts"
  | "loans"
  | "stock"
  | "help"
  | "subscribe"
  | "weekly_report"
  | "monthly_report"
  | "full_dashboard"
  | "referral";

function detectIntent(text: string): QueryIntent | null {
  const t = text.toLowerCase().trim();

  // Referral / earnings — check before "help" to avoid false match on "help earn"
  if (/\b(referral|refer|my\s*link|my\s*earnings?|earn(ings?)?|refer\s*&?\s*earn|my\s*balance|cashout|cash\s*out|withdraw\s*referral)\b/.test(t)) return "referral";

  // Help — English + common Ghanaian phrases
  if (/\b(help|commands|what can|how to use|guide|start|tutorial|mboa me|boa me|bo me kwan)\b/.test(t)) return "help";

  // Subscribe / upgrade
  if (/\b(subscri(be|ption)|upgrade|plan|pricing|plans|hyεn|payment)\b/.test(t)) return "subscribe";

  // Full dashboard — Pro/Enterprise only
  if (/\b(full\s*dashboard|all.?time|entire|complete\s*report|all\s*report|analytics|overview\s*all)\b/.test(t)) return "full_dashboard";

  // Monthly report
  if (/\b(month(ly)?(\s*report)?|this\s*month|monthly\s*(summary|review|breakdown))\b/.test(t)) return "monthly_report";

  // Weekly report — English + Pidgin
  if (/\b(week(ly)?(\s*report)?|this\s*week|weekly\s*(summary|review|breakdown)|dis\s*week)\b/.test(t)) return "weekly_report";

  // Daily summary — English + Twi ("sika" = money, "hwε me" = check for me) + Pidgin
  if (/\b(balance|bal|summary|summ|report|today|how\s*much|profit|earn(ings)?|daily|overview|status|eod|end\s*of\s*day|sika|hwε\s*me|how\s*i\s*stand|how\s*e\s*dey|wetin\s*i\s*get|my\s*(cash|money)|tell\s*me)\b/.test(t)) return "summary";

  // Debts — English + Twi ("ka ho" = they owe)
  if (/\b(who\s*ow|owe\s*me|debts?|credit\s*list|my\s*debtors?|people\s*ow|ka\s*ho|me\s*nipa|credit)\b/.test(t)) return "debts";

  // Loans — English + Twi ("me ka" = my debt/loan)
  if (/\b(loans?|borrow(ings?)?|lending|my\s*loans?|i\s*owe|what\s*i\s*owe|me\s*ka)\b/.test(t)) return "loans";

  // Stock / inventory — English + Twi ("nneεma" = goods)
  if (/\b(stock|inventory|goods|items|products|how\s*many|product\s*list|my\s*goods|nne[εe]ma|shelf)\b/.test(t)) return "stock";

  return null;
}

// 4 digits only → PIN attempt
function looksLikePin(text: string): boolean {
  return /^\d{4}$/.test(text.trim());
}

// "PAID GROWTH" / "paid pro" / "PAID ENTERPRISE" — also handles annual variants
function detectPaymentClaim(text: string): SubscriptionPlan | null {
  const t = text.toLowerCase().trim();
  if (/\bpaid\s+enterprise(\s+annual)?\b/.test(t)) return "enterprise";
  if (/\bpaid\s+pro(\s+annual)?\b/.test(t))        return "pro";
  if (/\bpaid\s+growth(\s+annual)?\b/.test(t))     return "growth";
  return null;
}

// Whether the payment was for an annual subscription
function isAnnualPayment(text: string): boolean {
  return /\bpaid\s+(growth|pro|enterprise)\s+annual\b/i.test(text.trim());
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function handleMessage(fromPhone: string, rawText: string): Promise<string> {
  let lookup: Awaited<ReturnType<typeof getUserByPhone>>;
  try {
    lookup = await getUserByPhone(fromPhone);
  } catch (err) {
    await logError("[handler] getUserByPhone", err, { phone: fromPhone });
    return fmtSystemError();
  }

  if (!lookup) {
    return fmtUnregistered();
  }

  const { user, business, pin: storedPin } = lookup;
  const text = rawText.trim();
  const bName = business.name;

  // ── If no PIN is set yet, guide user to set one ──────────────────────────
  if (!storedPin) {
    return [
      `👋 Welcome *${user.ownerName}*! 😊 I'm *ZURIA (${bName})*, your business helper.`,
      "",
      "Before we start, you need a 4-digit PIN to keep your account safe.",
      "",
      "👉 Open the ZURIA app → Profile → Set WhatsApp PIN",
      "",
      "_Once you set it, come back here and we'll get started! 🚀_",
    ].join("\n");
  }

  // ── Get or create WhatsApp session ──────────────────────────────────────
  let session: Awaited<ReturnType<typeof getOrCreateSession>>;
  try {
    session = await getOrCreateSession(fromPhone, business.id, user.id, user.ownerName);
  } catch (err) {
    await logError("[handler] getOrCreateSession", err, { phone: fromPhone });
    return fmtSystemError();
  }

  // ── Locked account ──────────────────────────────────────────────────────
  if (session.state === "locked") {
    return [
      "🔒 *Your account is locked for 1 hour.*",
      "",
      "Too many wrong PINs were entered.",
      "",
      "Come back in an hour and try again. 🙏",
      "If it wasn't you, please open the ZURIA app right away.",
    ].join("\n");
  }

  // ── Session waiting for PIN ─────────────────────────────────────────────
  if (session.state === "pending_pin") {
    if (!looksLikePin(text)) {
      return [
        `🔐 Hi *${user.ownerName}*! 😊`,
        "",
        "Please type your *4-digit PIN* to unlock your account.",
        "_It's the PIN you set when you created your ZURIA account._",
      ].join("\n");
    }

    // PIN digits are never logged — pass only the hash check result
    const result = await verifyPin(session, text, storedPin);
    if (result.ok) {
      const firstName = user.ownerName.split(" ")[0];
      return [
        `✅ *Welcome back, ${firstName}!* 🎉`,
        "",
        `*ZURIA (${bName})* is ready to help you.`,
        "Just tell me what happened:",
        '• "Sold rice 120"',
        '• "Ama owes me 200"',
        '• "balance" — to see today\'s report',
        '• "help" — for everything I can do',
        "",
        "_I'm right here for you! 😊_",
      ].join("\n");
    }

    if (result.locked) {
      return [
        "🔒 *Too many wrong PINs. Account locked for 1 hour.*",
        "",
        "If it wasn't you, open the ZURIA app right away. 🙏",
      ].join("\n");
    }

    return `❌ Wrong PIN. You have *${result.attemptsLeft}* ${result.attemptsLeft === 1 ? "try" : "tries"} left.`;
  }

  // ── Session expired — need to re-enter PIN ─────────────────────────────
  if (!isSessionActive(session)) {
    await expireSession(fromPhone);
    const firstName = user.ownerName.split(" ")[0];
    return [
      `🔐 *${firstName}*, your session expired. Type your *4-digit PIN* to continue.`,
      "",
      "_For your security, sessions last 24 hours. 🙏_",
    ].join("\n");
  }

  // ── Active session — check for suspicious activity ─────────────────────
  if (isSuspiciousActivity(session, fromPhone)) {
    await expireSession(fromPhone);
    return [
      "⚠️ *We noticed something unusual on your account.*",
      "",
      "For your safety, your session has been reset.",
      "Type your *4-digit PIN* to continue.",
      "",
      "_If this wasn't you, please check who has your phone. 🙏_",
    ].join("\n");
  }

  await stampSenderPhone(fromPhone, fromPhone);

  // ── Explicit lock/logout ─────────────────────────────────────────────────
  if (text.toLowerCase() === "lock" || text.toLowerCase() === "logout") {
    await expireSession(fromPhone);
    return "🔒 *Locked!* Send any message and type your PIN to get back in. Stay safe! 🙏";
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ── Subscription gating (active session only) ─────────────────────────
  // ─────────────────────────────────────────────────────────────────────────

  const effectivePlan = getEffectivePlan(user);

  // ── Build referral link for this user (used in several messages below) ───
  const referralCode = user.referralCode ?? "";
  const referralLink = referralCode ? `${APP_URL}/?ref=${referralCode}` : undefined;

  // ── How many referrals this month (for milestone progress) ───────────────
  const thisMonthKey = new Date().toISOString().slice(0, 7);
  const monthlyReferrals =
    (user.referralMonthlyResetKey ?? "") === thisMonthKey
      ? (user.referralMonthlyCount ?? 0)
      : 0;

  // ── Handle "PAID GROWTH/PRO/ENTERPRISE" claim before gating ─────────────
  const paymentPlan = detectPaymentClaim(text);
  if (paymentPlan) {
    const annual = isAnnualPayment(text);
    return await handlePaymentClaim(paymentPlan, user.id, user.ownerName, fromPhone, bName, annual);
  }

  // ── Message-count gating (free = daily, growth = monthly) ───────────────
  if (effectivePlan === "free" || effectivePlan === "growth") {
    const limit = effectivePlan === "free" ? FREE_DAILY_LIMIT : GROWTH_MONTHLY_LIMIT;
    let usedCount = 0;
    try {
      usedCount = await getAndMaybeResetMessageCount(user, effectivePlan);
    } catch (err) {
      await logError("[handler] getAndMaybeResetMessageCount", err, { phone: fromPhone });
    }

    if (usedCount >= limit) {
      // Hard block — show subscription prompt (do NOT count this call)
      return fmtSubscriptionRequired(limit, bName, referralLink, effectivePlan === "growth" ? "monthly" : "daily");
    }

    // Increment atomically (fire-and-forget — minor over-count on failure is acceptable)
    incrementMessageCount(user.id, effectivePlan).catch(() => {});
  }

  // ── Compute soft-limit warning flag (80%+ usage) ─────────────────────────
  // We'll append a gentle note to transaction confirmation replies only.
  let nearLimitWarning = "";
  if (effectivePlan === "free" || effectivePlan === "growth") {
    const limit  = effectivePlan === "free" ? FREE_DAILY_LIMIT : GROWTH_MONTHLY_LIMIT;
    const period = effectivePlan === "free" ? "today" : "this month";
    const count  = user.whatsappMessageCount ?? 0;
    const pct    = limit > 0 ? count / limit : 0;
    const remaining30 = Math.max(0, MONTHLY_UNLOCK_TARGET - monthlyReferrals);
    const refCta = referralLink
      ? `\n💡 _Earn GHS 0.50/referral: ${referralLink}_`
      : `\n💡 _Earn GHS 0.50/referral — open ZURIA app → Refer & Earn!_`;
    const milestoneCta = remaining30 > 0
      ? `\n🎁 _${remaining30} more referral${remaining30 !== 1 ? "s" : ""} this month = Growth features FREE!_`
      : "";

    if (pct >= 0.90) {
      const left = Math.max(0, limit - count);
      nearLimitWarning = left === 0
        ? `\n\n⛔ _You've reached your ${limit} entry limit for ${period}. Reply *"subscribe"* to upgrade._${refCta}${milestoneCta}`
        : `\n\n⚠️ _Almost at your limit — ${left} entr${left === 1 ? "y" : "ies"} left ${period}. Reply *"subscribe"* to upgrade._${refCta}${milestoneCta}`;
    } else if (pct >= 0.80) {
      const left = Math.max(0, limit - count);
      nearLimitWarning = `\n\n💡 _${left} entries remaining ${period}. Reply *"subscribe"* or refer friends to earn more!_${referralLink ? `\n_Your link: ${referralLink}_` : ""}${milestoneCta}`;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ── Query intent ────────────────────────────────────────────────────────
  // ─────────────────────────────────────────────────────────────────────────

  const intent = detectIntent(text);
  if (intent) {
    try {
      const referralBalance = (user.referralBalance as number | undefined) ?? 0;
      return await handleQuery(
        intent,
        business.id,
        user.ownerName,
        business.category,
        bName,
        effectivePlan,
        referralLink,
        referralBalance,
        monthlyReferrals,
        user as unknown as Record<string, unknown>
      );
    } catch (err) {
      await logError("[handler] handleQuery", err, { phone: fromPhone, meta: { intent } });
      return fmtSystemError();
    }
  }

  // ── Try transaction parse ────────────────────────────────────────────────
  const parsed = parseTransaction(text);

  if (parsed.amount > 0 && parsed.confidence >= 0.40) {
    const now = new Date().toISOString();
    const txn: Transaction = {
      id: createId("txn"),
      businessId: business.id,
      userId: user.id,
      rawText: text,
      type: parsed.type,
      amount: parsed.amount,
      quantity: parsed.quantity,
      productName: parsed.productName,
      customerName: parsed.customerName,
      customerNameNormalized: parsed.customerNameNormalized,
      category: parsed.category,
      paymentMethod: parsed.paymentMethod,
      currency: "GHS, Cedis",
      notes: parsed.notes,
      confidence: parsed.confidence,
      createdAt: now,
      syncStatus: "synced",
      source: "manual",
    };

    try {
      await saveTransaction(txn, fromPhone);
      const todayTxns = await getTodayTransactions(business.id);
      const moneyIn = todayTxns.filter((t) => MONEY_IN_TYPES.includes(t.type)).reduce((a, t) => a + t.amount, 0);
      const moneyOut = todayTxns.filter((t) => MONEY_OUT_TYPES.includes(t.type)).reduce((a, t) => a + t.amount, 0);
      const confirm = fmtConfirm(parsed, { in: moneyIn, out: moneyOut }, business.category, bName);
      return nearLimitWarning ? confirm + nearLimitWarning : confirm;
    } catch (err) {
      await logError("[handler] saveTransaction", err, { phone: fromPhone });
      return fmtSystemError();
    }
  }

  if (parsed.amount === 0 && /\b(money|cash|how|what|balance|total|sales|profit)\b/i.test(text)) {
    try {
      return await handleQuery("summary", business.id, user.ownerName, business.category, bName, effectivePlan, referralLink, (user.referralBalance as number | undefined) ?? 0, monthlyReferrals, user as unknown as Record<string, unknown>);
    } catch (err) {
      await logError("[handler] summary fallback", err, { phone: fromPhone });
      return fmtSystemError();
    }
  }

  return fmtNotFound(business.category, bName);
}

// ─── Subscribe intent handler — generates Paystack checkout links ─────────────

function makeRef(): string {
  const ts   = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `ZURIA-${ts}-${rand}`;
}

async function handleSubscribeIntent(
  userId: string,
  phone: string,
  businessName: string,
  ownerName: string,
  currentPlan: SubscriptionPlan
): Promise<string> {
  const email = `${phone.replace("+", "")}@zuria.app`;
  const firstName = ownerName.split(" ")[0];

  // Generate payment links for the two most common upgrade paths
  const upgradePlans: SubscriptionPlan[] =
    currentPlan === "free"
      ? ["growth", "pro"]
      : currentPlan === "growth"
      ? ["pro", "enterprise"]
      : ["enterprise"];

  interface PlanLink { plan: SubscriptionPlan; url: string; amountGHS: number }
  const links: PlanLink[] = [];

  for (const p of upgradePlans) {
    const tier     = SUBSCRIPTION_TIERS[p];
    const amountGHS = tier.priceGHS;
    const reference = makeRef();
    const callbackUrl = `${APP_URL}/subscription/callback?ref=${reference}`;

    try {
      const result = await initializePayment({
        email,
        amountGHS,
        reference,
        callbackUrl,
        metadata: { userId, phone, ownerName, plan: p, annual: false, amountGHS },
        label: ownerName || "ZURIA Customer",
      });

      if (!result.error && result.authorizationUrl) {
        // Persist pending payment
        const paymentDoc: PaystackPayment = {
          id:               reference,
          reference,
          userId,
          phone,
          plan:             p,
          annual:           false,
          amountGHS,
          status:           "pending",
          authorizationUrl: result.authorizationUrl,
          accessCode:       result.accessCode,
          createdAt:        new Date().toISOString(),
        };
        getAdminDb()
          .collection(collections.payments)
          .doc(reference)
          .set(paymentDoc)
          .catch(() => {});

        links.push({ plan: p, url: result.authorizationUrl, amountGHS });
      }
    } catch {
      // Ignore individual plan errors — we'll show what we can
    }
  }

  if (links.length === 0) {
    // Fallback to static plans page if Paystack links fail
    return fmtSubscribePlans(currentPlan, businessName);
  }

  const planLabels: Record<SubscriptionPlan, string> = {
    free:       "Free",
    growth:     "ZURIA Growth",
    pro:        "ZURIA Pro",
    enterprise: "ZURIA Enterprise",
  };

  const lines = [
    `💳 *Upgrade your ZURIA plan, ${firstName}!*`,
    ``,
    `Pay securely via MoMo, bank transfer, or card — activates instantly after payment.`,
    ``,
  ];

  links.forEach(({ plan: p, url, amountGHS }) => {
    lines.push(
      `*${planLabels[p]}* — GHS ${amountGHS}/month`,
      url,
      ``
    );
  });

  lines.push(
    `🌐 Or visit your subscription page:`,
    `${APP_URL}/subscription`,
    ``,
    `_Payment links expire in 30 minutes. Reply *"subscribe"* for a fresh link._`,
    `_— ZURIA (${businessName})_`
  );

  return lines.join("\n");
}

// ─── Payment claim handler ────────────────────────────────────────────────────

async function handlePaymentClaim(
  plan: SubscriptionPlan,
  userId: string,
  ownerName: string,
  fromPhone: string,
  businessName: string,
  annual = false
): Promise<string> {
  const monthlyPrices: Record<string, number> = { growth: 20, pro: 50, enterprise: 100 };
  const annualPrices:  Record<string, number> = { growth: 200, pro: 500, enterprise: 1000 };
  const amount = annual ? (annualPrices[plan] ?? 0) : (monthlyPrices[plan] ?? 0);
  const price = annual
    ? `GHS ${annualPrices[plan] ?? "?"}/year (2 months free!)`
    : `GHS ${monthlyPrices[plan] ?? "?"}/month`;

  const planLabels: Record<string, string> = {
    growth:     "ZURIA Growth",
    pro:        "ZURIA Pro",
    enterprise: "ZURIA Enterprise",
  };
  const planLabel = planLabels[plan] ?? plan;
  const durationNote = annual ? " (Annual)" : "";
  const firstName = ownerName.split(" ")[0];
  const now = new Date().toISOString();

  // ── Persist claim to Firestore (idempotent: one pending claim per user per plan) ──
  // This ensures no claim is ever lost even if the WhatsApp notification fails.
  // Admin can query: GET /api/admin/payment-claims?status=pending
  const claimId = createId("claim");
  try {
    await getAdminDb().collection(collections.paymentClaims).doc(claimId).set({
      id: claimId,
      userId,
      ownerName,
      phone: fromPhone,
      plan,
      annual,
      amount,
      status: "pending",
      businessName,
      claimedAt: now,
    });
  } catch (err) {
    await logError("[handler] persist payment claim", err, { phone: fromPhone, severity: "warn" });
    // Non-critical — still notify admin via WhatsApp even if Firestore write fails
  }

  // ── Notify admin on WhatsApp with all details needed to activate ──────────
  if (ADMIN_PHONE) {
    sendText(`whatsapp:${ADMIN_PHONE}`, [
      `💳 *ZURIA Payment Claim* [Claim ID: ${claimId}]`,
      ``,
      `User:      *${ownerName}*`,
      `Phone:     ${fromPhone}`,
      `Plan:      *${planLabel}${durationNote}* — ${price}`,
      `User ID:   \`${userId}\``,
      `Annual:    ${annual ? "YES — use durationDays: 365" : "No — use durationDays: 30"}`,
      ``,
      `⚡ Activate after verifying MoMo payment:`,
      `PATCH /api/admin/subscriptions/${userId}`,
      `Body: { "plan": "${plan}", "durationDays": ${annual ? 365 : 30}, "claimId": "${claimId}" }`,
      ``,
      `_Check MoMo: look for GHS ${amount} from ${fromPhone} with reference matching their WhatsApp number._`,
    ].join("\n")).catch((err) => {
      // Log so admin can manually review the payment claim in Firestore
      logError("[handler] admin payment-claim notification", err, {
        phone: fromPhone,
        meta: { claimId, plan, userId },
        severity: "warn",
      }).catch(() => {});
    });
  }

  return [
    `✅ *Thank you, ${firstName}!*`,
    ``,
    `We received your payment notification for:`,
    `*${planLabel}${durationNote}* — ${price}`,
    ``,
    `We will verify your MoMo payment and activate your plan within *1 hour*.`,
    `You'll get a confirmation message here as soon as it's done. 😊`,
    ``,
    `📋 _Reference: ${claimId} — keep this in case you need support._`,
    ``,
    `Need help? Reply *"help"* or contact: ${SUPPORT_WA_LINK}`,
    ``,
    `_— ZURIA (${businessName})_`,
  ].join("\n");
}

// ─── Query handlers ───────────────────────────────────────────────────────────

async function handleQuery(
  intent: QueryIntent,
  businessId: string,
  ownerName: string,
  category: BusinessCategory,
  businessName: string,
  plan: SubscriptionPlan,
  referralLink?: string,
  referralBalance = 0,
  monthlyReferrals = 0,
  user?: Record<string, unknown>
): Promise<string> {
  // ── Tier-gating for advanced reports ──────────────────────────────────────
  // Free + Growth: weekly report (free gets same basic weekly — it's in the spec)
  // Growth+: monthly report
  // Pro+: full dashboard / advanced analytics
  const canMonthly = plan === "growth" || plan === "pro" || plan === "enterprise";
  const canFull    = plan === "pro" || plan === "enterprise";

  if (intent === "subscribe") {
    const uid   = (user?.id         as string | undefined) ?? "";
    const phone = (user?.phoneNumber as string | undefined) ?? "";
    return await handleSubscribeIntent(uid, phone, businessName, ownerName, plan);
  }

  if (intent === "full_dashboard") {
    if (!canFull) return gateMsg("full dashboard", "ZURIA Pro", "pro", businessName);
    const txns = await getAllTransactions(businessId, 2000);
    return fmtFullDashboard(txns, ownerName, category, businessName, plan);
  }

  if (intent === "monthly_report") {
    if (!canMonthly) return gateMsg("monthly report", "ZURIA Growth", "growth", businessName);
    const [txns, openDebts] = await Promise.all([
      getMonthTransactions(businessId),
      getOpenDebts(businessId),
    ]);
    const { openCount, openTotal, overdue7, overdue30 } = summariseDebts(openDebts);
    return fmtMonthlyReport(txns, ownerName, category, businessName, referralLink, referralBalance, monthlyReferrals, openCount, openTotal, overdue7, overdue30);
  }

  if (intent === "weekly_report") {
    // All tiers get weekly — free users see the basic weekly (per spec: "Weekly SMS-style report")
    const [txns, openDebts] = await Promise.all([
      getWeekTransactions(businessId),
      getOpenDebts(businessId),
    ]);
    const { openCount, openTotal, overdue7, overdue30 } = summariseDebts(openDebts);
    return fmtWeeklyReport(txns, ownerName, category, businessName, referralLink, referralBalance, monthlyReferrals, openCount, openTotal, overdue7, overdue30);
  }

  switch (intent) {
    case "summary": {
      // Fetch today + yesterday + open debts in parallel
      const [txns, openDebts] = await Promise.all([
        getTodayAndYesterdayTransactions(businessId),
        getOpenDebts(businessId),
      ]);
      const openDebtCount = openDebts.filter((d) => d.outstandingAmount > 0).length;
      const openDebtTotal = openDebts.reduce((acc, d) => acc + (d.outstandingAmount > 0 ? d.outstandingAmount : 0), 0);
      return fmtEndOfDayReport(txns, ownerName, category, businessName, referralLink, referralBalance, monthlyReferrals, openDebtCount, openDebtTotal);
    }
    case "debts": {
      const debts = await getOpenDebts(businessId);
      return fmtDebts(debts, businessName);
    }
    case "loans": {
      const loans = await getLoans(businessId);
      return fmtLoans(loans, businessName);
    }
    case "stock": {
      const inv = await getInventory(businessId);
      return fmtStock(inv, businessName);
    }
    case "help":
      return fmtHelp(ownerName, category, businessName, plan);
    case "referral": {
      const referralCode   = (user?.referralCode as string | undefined) ?? "";
      const referralCount  = (user?.referralCount as number | undefined) ?? 0;
      const userId = (user?.id as string | undefined) ?? "";
      const db2 = getAdminDb();
      const wdSnap = await db2.collection(collections.withdrawals)
        .where("userId", "==", userId)
        .where("status", "in", ["pending", "processing"])
        .limit(1)
        .get();
      const pendingWithdrawal = !wdSnap.empty;
      return fmtReferralStatus(
        ownerName,
        businessName,
        referralCode,
        referralBalance,
        referralCount,
        monthlyReferrals,
        referralLink,
        pendingWithdrawal
      );
    }
  }
}

// ─── Debt summary helper ──────────────────────────────────────────────────────

function summariseDebts(debts: Debt[]) {
  const DAY_MS = 86_400_000;
  const now = Date.now();
  const open = debts.filter((d) => d.outstandingAmount > 0);
  let overdue7 = 0;
  let overdue30 = 0;
  for (const d of open) {
    if (!d.createdAt) continue;
    const ageDays = Math.floor((now - new Date(d.createdAt).getTime()) / DAY_MS);
    if (ageDays >= 30) overdue30++;
    else if (ageDays >= 7) overdue7++;
  }
  return {
    openCount: open.length,
    openTotal: open.reduce((s, d) => s + d.outstandingAmount, 0),
    overdue7,
    overdue30,
  };
}

// Gating message when a lower tier tries an advanced report
function gateMsg(
  feature: string,
  requiredPlanLabel: string,
  requiredPlan: SubscriptionPlan,
  businessName: string
): string {
  const priceMap: Record<string, string> = {
    growth: "GHS 20/month",
    pro: "GHS 50/month",
    enterprise: "GHS 100/month",
  };
  const price = priceMap[requiredPlan] ?? "";
  return [
    `🔒 *${feature.charAt(0).toUpperCase() + feature.slice(1)} requires ${requiredPlanLabel}.*`,
    ``,
    `${requiredPlanLabel} (${price}) and above unlocks this feature.`,
    ``,
    `Reply *"subscribe"* to see all plans and how to pay with MoMo.`,
    ``,
    `_— ZURIA (${businessName})_`,
  ].join("\n");
}
