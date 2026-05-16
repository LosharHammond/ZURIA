/**
 * ZURIA Telegram Bot Handler
 *
 * Handles all incoming Telegram messages. Reuses the same parser, session,
 * formatter, and security modules as the WhatsApp handler — only the
 * transport (sendTelegram vs sendText) and identity resolution differ.
 *
 * Identity flow for a new Telegram user:
 *  1. User sends any message → bot asks for their ZURIA phone number
 *  2. User sends phone → bot checks if registered
 *  3. Bot asks for PIN (silently verified — never echoed)
 *  4. PIN correct → session linked → normal ZURIA chat begins
 *
 * Returning users: chat_id is stored in Firestore; they go straight to PIN
 * or (if session still active) straight to message handling.
 */

import { parseTransaction }   from "@/lib/parsers/transaction-parser";
import { createId, formatMoney } from "@/lib/utils";
import { sendText }           from "@/lib/whatsapp/client";
import { hashPin, verifyPin }  from "@/lib/security/pin";
import {
  fmtDebts,
  fmtEndOfDayReport,
  fmtFullDashboard,
  fmtHelp,
  fmtLoans,
  fmtMonthlyReport,
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
import { expireSession } from "@/lib/whatsapp/security";
import { logError }      from "@/lib/server/error-logger";
import { classifyMessage } from "@/lib/intelligence/intent-classifier";
import {
  loadTelegramContext, saveTelegramContext, clearTelegramContext,
  appendConversationHistory, stageLimitNotification, historyToText,
  type TxnContextUpdate,
} from "@/lib/intelligence/conversation-context";
import { enforceEngineIsolation, isDuplicateLedgerEntry } from "@/lib/intelligence/engine-guard";
import {
  zuriaConfirm, zuriaSmalltalk, zuriaError, generateInsight,
  zuriaUndoPrompt, zuriaUndoConfirmed, zuriaUndoNothing, buildLimitWarning,
} from "@/lib/intelligence/response-engine";
import { normalizeGhanaianEnglish } from "@/lib/intelligence/ghanaian-normalizer";
import { parseMultiIntent, fmtMultiConfirm } from "@/lib/intelligence/multi-intent-parser";
import { getActiveProvider } from "@/lib/intelligence/ai-provider";
import { voidTransaction } from "@/lib/whatsapp/session";
import type { ConversationState } from "@/lib/intelligence/types";
import { MONEY_IN_TYPES, MONEY_OUT_TYPES, SUBSCRIPTION_TIERS } from "@/types/domain";
import type { BusinessCategory, Debt, PaymentLedgerEntry, PaystackPayment, SubscriptionPlan, Transaction } from "@/types/domain";
import { sendTelegram }  from "@/lib/telegram/client";
import { getAdminDb }    from "@/lib/firebase/admin";
import { collections }   from "@/lib/firebase/collections";
import { APP_URL }       from "@/lib/config";
import { initializePayment } from "@/lib/services/paystack-service";

// ── Constants ─────────────────────────────────────────────────────────────────

const FREE_DAILY_LIMIT     = 10;
const GROWTH_MONTHLY_LIMIT = 200;
const ADMIN_PHONE          = process.env.ADMIN_PHONE ?? process.env.NEXT_PUBLIC_ADMIN_PHONE ?? "";

// ── Telegram session state stored in Firestore ────────────────────────────────
// Collection: telegram_links/{chatId}
// Fields: phone, userId, state, pinAttempts, lockedUntil, updatedAt

const MAX_PIN_ATTEMPTS = 5;
const PIN_LOCK_DURATION_MS = 60 * 60 * 1000; // 1 hour

type TgState = "awaiting_phone" | "awaiting_pin" | "active";

interface TgLink {
  chatId:       string;
  phone?:       string;
  userId?:      string;
  state:        TgState;
  pinAttempts?: number;          // wrong-PIN counter
  lockedUntil?: string | null;   // ISO timestamp — null/absent when not locked
  updatedAt:    string;
}

async function getTgLink(chatId: string): Promise<TgLink | null> {
  const db = getAdminDb();
  const snap = await db.collection(collections.telegramLinks).doc(chatId).get();
  if (!snap.exists) return null;
  return snap.data() as TgLink;
}

async function saveTgLink(chatId: string, data: Partial<TgLink>): Promise<void> {
  const db = getAdminDb();
  await db.collection(collections.telegramLinks).doc(chatId).set(
    { chatId, ...data, updatedAt: new Date().toISOString() },
    { merge: true }
  );
}

// ── Normalise Ghana phone input ───────────────────────────────────────────────

function normalisePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("0") && digits.length === 10) return `+233${digits.slice(1)}`;
  if (digits.startsWith("233") && digits.length === 12) return `+${digits}`;
  if (digits.length >= 10 && digits.length <= 15) return `+${digits}`;
  return `+${digits}`;
}

// ── Intent detection (same rules as WhatsApp handler) ────────────────────────

type QueryIntent =
  | "summary" | "debts" | "loans" | "stock" | "help"
  | "subscribe" | "weekly_report" | "monthly_report"
  | "full_dashboard" | "referral" | "lock" | "undo";

function detectIntent(text: string): QueryIntent | null {
  const t = text.toLowerCase().trim();
  if (/\b(referral|refer|my\s*link|my\s*earnings?|earn|cash\s*out)\b/.test(t)) return "referral";
  if (/\b(help|commands|guide|start|tutorial)\b/.test(t)) return "help";
  if (/\b(subscribe|upgrade|plan|pricing|growth|pro|enterprise|paid)\b/.test(t)) return "subscribe";
  // Undo / delete last entry — checked before summary to avoid "balance" false-match
  if (/\b(undo|delete\s*last|cancel\s*last|remove\s*last|wrong\s*entry|wrong\s*amount|mistake|retract|i\s*made\s*a\s*mistake)\b/.test(t)) return "undo";
  if (/\b(weekly\s*report|this\s*week|week\s*summary)\b/.test(t)) return "weekly_report";
  if (/\b(monthly\s*report|this\s*month|month\s*summary)\b/.test(t)) return "monthly_report";
  if (/\b(full\s*dashboard|dashboard|analytics|kpi)\b/.test(t)) return "full_dashboard";
  if (/\b(balance|summary|today|report|how.*doing|profit|income)\b/.test(t)) return "summary";
  if (/\b(who\s*owes|debts?|owe\s*me|debtors?|credit\s*list|debt\s*list)\b/.test(t)) return "debts";
  if (/\b(loans?|borrowed|lent)\b/.test(t)) return "loans";
  if (/\b(stock|inventory|goods|products|items)\b/.test(t)) return "stock";
  if (/\b(lock|logout|sign\s*out|exit)\b/.test(t)) return "lock";
  return null;
}

// ── helpers ───────────────────────────────────────────────────────────────────

function sum(arr: Transaction[]) { return arr.reduce((s, t) => s + t.amount, 0); }

// ─── Paystack payment link generator ─────────────────────────────────────────

function makePayRef(): string {
  const ts   = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `ZURIA-${ts}-${rand}`;
}

async function generatePaystackLinksMessage(
  userId: string,
  phone: string,
  businessName: string,
  ownerName: string,
  currentPlan: SubscriptionPlan
): Promise<string> {
  const email = `${phone.replace("+", "")}@zuria.app`;
  const firstName = ownerName.split(" ")[0];

  // ── Duplicate-payment guard ─────────────────────────────────────────────────
  if (currentPlan === "enterprise") {
    return [
      `✅ *You're already on ZURIA Enterprise, ${firstName}!*`,
      ``,
      `Your plan is active. Send /help to see what you can do, or visit ${APP_URL}/subscription to manage your account.`,
    ].join("\n");
  }

  const upgradePlans: SubscriptionPlan[] =
    currentPlan === "free"
      ? ["growth", "pro"]
      : currentPlan === "growth"
      ? ["pro", "enterprise"]
      : ["enterprise"];

  const planLabels: Record<SubscriptionPlan, string> = {
    free:       "Free",
    growth:     "ZURIA Growth",
    pro:        "ZURIA Pro",
    enterprise: "ZURIA Enterprise",
  };

  interface PlanLink { plan: SubscriptionPlan; url: string; amountGHS: number }
  const links: PlanLink[] = [];

  for (const p of upgradePlans) {
    const tier      = SUBSCRIPTION_TIERS[p];
    const amountGHS = tier.priceGHS;
    const reference = makePayRef();
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
        // Persist payment doc + PAYMENT_INITIATED ledger entry atomically.
        // Mirrors the web /api/payments/initialize path — all checkout origins
        // must write to the payment_events ledger for full audit traceability.
        const createdAt   = new Date().toISOString();
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
          createdAt,
        };
        const initiatedLedgerId = `${reference}_PAYMENT_INITIATED`;
        const ledgerEntry: PaymentLedgerEntry = {
          id:                initiatedLedgerId,
          paystackReference: reference,
          userId,
          plan:              p,
          annual:            false,
          amountGHS,
          currency:          "GHS",
          eventType:         "PAYMENT_INITIATED",
          status:            "pending",
          source:            "system",
          idempotencyKey:    initiatedLedgerId,
          createdAt,
          _immutable:        true,
        };
        const tgDb    = getAdminDb();
        const tgBatch = tgDb.batch();
        tgBatch.set(tgDb.collection(collections.payments).doc(reference), paymentDoc);
        tgBatch.set(tgDb.collection(collections.paymentEvents).doc(initiatedLedgerId), ledgerEntry);
        tgBatch.commit().catch(() => {});
        links.push({ plan: p, url: result.authorizationUrl, amountGHS });
      }
    } catch {
      // ignore per-plan errors
    }
  }

  if (links.length === 0) {
    return fmtSubscribePlans(currentPlan, businessName);
  }

  const lines = [
    `💳 *Upgrade ZURIA, ${firstName}!*`,
    ``,
    `Tap a link below → Paystack checkout opens → pay with *MoMo*, *bank card*, or *bank transfer*.`,
    `Your plan activates *instantly* the moment payment is confirmed. ✅`,
    ``,
  ];
  links.forEach(({ plan: p, url, amountGHS }) => {
    lines.push(`*${planLabels[p]}* — GHS ${amountGHS}/month`);
    lines.push(url);
    lines.push(``);
  });
  lines.push(
    `🌐 More options + annual pricing (2 months free!):`,
    `${APP_URL}/subscription`,
    ``,
    `_Links expire in 30 min. Type *subscribe* for a fresh one._`,
    `_— ZURIA (${businessName})_`
  );
  return lines.join("\n");
}

function summariseDebts(debts: Debt[]) {
  const DAY_MS = 86_400_000;
  const now = Date.now();
  const open = debts.filter((d) => d.outstandingAmount > 0);
  let overdue7 = 0, overdue30 = 0;
  for (const d of open) {
    if (!d.createdAt) continue;
    const age = Math.floor((now - new Date(d.createdAt).getTime()) / DAY_MS);
    if (age >= 30) overdue30++;
    else if (age >= 7) overdue7++;
  }
  return { openCount: open.length, openTotal: open.reduce((s, d) => s + d.outstandingAmount, 0), overdue7, overdue30 };
}

// ─── Payment claim detection ──────────────────────────────────────────────────

function detectPaymentClaim(text: string): SubscriptionPlan | null {
  const t = text.toLowerCase().trim();
  if (/\bpaid\s+enterprise(\s+annual)?\b/.test(t)) return "enterprise";
  if (/\bpaid\s+pro(\s+annual)?\b/.test(t))        return "pro";
  if (/\bpaid\s+growth(\s+annual)?\b/.test(t))     return "growth";
  return null;
}

function isAnnualPayment(text: string): boolean {
  return /\bpaid\s+(growth|pro|enterprise)\s+annual\b/i.test(text.trim());
}

async function handlePaymentClaim(
  plan: SubscriptionPlan,
  userId: string,
  ownerName: string,
  fromPhone: string,
  businessName: string,
  annual = false
): Promise<string> {
  const tier = SUBSCRIPTION_TIERS[plan];
  const amount = annual ? (tier.annualPriceGHS ?? tier.priceGHS * 10) : tier.priceGHS;
  const price  = annual
    ? `GHS ${tier.annualPriceGHS ?? tier.priceGHS * 10}/year (2 months free!)`
    : `GHS ${tier.priceGHS}/month`;
  const planLabels: Record<string, string> = { growth: "ZURIA Growth", pro: "ZURIA Pro", enterprise: "ZURIA Enterprise" };
  const planLabel    = planLabels[plan] ?? plan;
  const durationNote = annual ? " (Annual)" : "";
  const firstName    = ownerName.split(" ")[0];
  const now          = new Date().toISOString();
  const claimId      = createId("claim");

  try {
    await getAdminDb().collection(collections.paymentClaims).doc(claimId).set({
      id: claimId, userId, ownerName, phone: fromPhone, plan, annual, amount,
      status: "pending", businessName, claimedAt: now,
    });
  } catch (err) {
    await logError("[tg/handler] persist payment claim", err, { phone: fromPhone, severity: "warn" });
  }

  if (ADMIN_PHONE) {
    sendText(`whatsapp:${ADMIN_PHONE}`, [
      `💳 *ZURIA Payment Claim (Telegram)* [Claim ID: ${claimId}]`,
      ``,
      `User:      *${ownerName}*`,
      `Phone:     ${fromPhone}`,
      `Plan:      *${planLabel}${durationNote}* — ${price}`,
      `User ID:   \`${userId}\``,
      `Annual:    ${annual ? "YES — use durationDays: 365" : "No — use durationDays: 30"}`,
      ``,
      `⚡ Check Paystack dashboard for payment from ${fromPhone} (GHS ${amount}).`,
      `PATCH /api/admin/subscriptions/${userId}`,
      `Body: { "plan": "${plan}", "durationDays": ${annual ? 365 : 30}, "claimId": "${claimId}" }`,
    ].join("\n")).catch((err) => {
      logError("[tg/handler] admin payment-claim notification", err, {
        phone: fromPhone, meta: { claimId, plan, userId }, severity: "warn",
      }).catch(() => {});
    });
  }

  return [
    `✅ *Got it, ${firstName}!*`,
    ``,
    `We've received your notification for:`,
    `*${planLabel}${durationNote}* — ${price}`,
    ``,
    `If you paid via Paystack, your plan activates *automatically* — open the ZURIA app to confirm.`,
    `If it hasn't updated yet, our team will check within *1 hour*. 😊`,
    ``,
    `_Claim ID: ${claimId}_`,
  ].join("\n");
}

// ─── Query dispatcher ─────────────────────────────────────────────────────────

function gateMsg(feature: string, planName: string, plan: string, businessName: string): string {
  return [
    `🔒 *${feature.charAt(0).toUpperCase() + feature.slice(1)} is a ${planName} feature.*`,
    ``,
    `You're on the Free plan, ${businessName}.`,
    `Upgrade to *${planName}* to unlock ${feature}, detailed analytics, and more.`,
    ``,
    `Type *subscribe* to see upgrade options.`,
  ].join("\n");
}

async function dispatchTgQuery(
  intent: string,
  businessId: string,
  ownerName: string,
  category: BusinessCategory,
  businessName: string,
  plan: SubscriptionPlan,
  referralLink: string | undefined,
  user: Record<string, unknown>,
  _monthKey: string,
): Promise<string> {
  const canMonthly = plan === "growth" || plan === "pro" || plan === "enterprise";
  const canFull    = plan === "pro" || plan === "enterprise";

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
    const referralBalance   = (user.referralBalance   as number | undefined) ?? 0;
    const monthlyReferrals  = (user.monthlyReferrals  as number | undefined) ?? 0;
    return fmtMonthlyReport(txns, ownerName, category, businessName, referralLink, referralBalance, monthlyReferrals, openCount, openTotal, overdue7, overdue30);
  }

  if (intent === "weekly_report") {
    const [txns, openDebts] = await Promise.all([
      getWeekTransactions(businessId),
      getOpenDebts(businessId),
    ]);
    const { openCount, openTotal, overdue7, overdue30 } = summariseDebts(openDebts);
    const referralBalance  = (user.referralBalance  as number | undefined) ?? 0;
    const monthlyReferrals = (user.monthlyReferrals as number | undefined) ?? 0;
    return fmtWeeklyReport(txns, ownerName, category, businessName, referralLink, referralBalance, monthlyReferrals, openCount, openTotal, overdue7, overdue30);
  }

  switch (intent) {
    case "summary": {
      const [txns, openDebts] = await Promise.all([
        getTodayAndYesterdayTransactions(businessId),
        getOpenDebts(businessId),
      ]);
      const openDebtCount    = openDebts.filter((d) => d.outstandingAmount > 0).length;
      const openDebtTotal    = openDebts.reduce((acc, d) => acc + (d.outstandingAmount > 0 ? d.outstandingAmount : 0), 0);
      const referralBalance  = (user.referralBalance  as number | undefined) ?? 0;
      const monthlyReferrals = (user.monthlyReferrals as number | undefined) ?? 0;
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
    case "referral": {
      const referralCode    = (user.referralCode    as string | undefined) ?? "";
      const referralCount   = (user.referralCount   as number | undefined) ?? 0;
      const referralBalance = (user.referralBalance as number | undefined) ?? 0;
      const monthlyReferrals = (user.monthlyReferrals as number | undefined) ?? 0;
      const userId           = (user.id              as string | undefined) ?? "";
      const db2              = getAdminDb();
      const wdSnap = await db2.collection(collections.withdrawals)
        .where("userId", "==", userId)
        .where("status", "in", ["pending", "processing"])
        .limit(1)
        .get();
      const pendingWithdrawal = !wdSnap.empty;
      return fmtReferralStatus(ownerName, businessName, referralCode, referralBalance, referralCount, monthlyReferrals, referralLink, pendingWithdrawal);
    }
    default:
      return gateMsg("that feature", "ZURIA Growth", "growth", businessName);
  }
}

// ── Main entry point ─────────────────────────────────────────────────────────

export async function handleTelegram(update: Record<string, unknown>): Promise<void> {
  // Support both `message` and `edited_message` update types so users who
  // edit their first phone-number message still get the flow to continue.
  const message = (
    (update.message ?? update.edited_message) as Record<string, unknown> | undefined
  );

  if (!message) {
    // Non-message update (callback query, inline, channel post, etc.) — log and ignore.
    const updateType = Object.keys(update).filter((k) => k !== "update_id")[0] ?? "unknown";
    console.info("[telegram/handler] ignoring non-message update type:", updateType);
    return;
  }

  const chatId    = String((message.chat as Record<string, unknown>)?.id ?? "");
  const rawText   = (message.text as string | undefined)?.trim() ?? "";
  const firstName = ((message.from as Record<string, unknown>)?.first_name as string | undefined) ?? "there";

  if (!chatId) return; // no chat to reply to — nothing we can do

  const reply = (text: string) => sendTelegram(chatId, text);

  // ── Non-text content (sticker, photo, voice note, contact, etc.) ──────────
  // Give users friendly feedback instead of silently ignoring them.
  if (!rawText) {
    try {
      await reply(
        "📝 *Please send a text message.*\n\n" +
        "I can only read text right now — just type your message and I'll handle it! 😊"
      );
    } catch {
      // best-effort — don't crash on send failure
    }
    return;
  }

  // ── Top-level error boundary ───────────────────────────────────────────────
  // Any unexpected Firestore error, env-var issue, or unhandled throw is
  // caught here. The user gets a system-error reply rather than silence.
  try {
    await _handleTelegramInner(chatId, rawText, firstName, reply);
  } catch (err) {
    console.error("[telegram/handler] unhandled error:", err);
    try {
      await reply(fmtSystemError());
    } catch {
      // best-effort
    }
  }
}

// ── Inner handler (wrapped by the error boundary above) ───────────────────────

async function _handleTelegramInner(
  chatId: string,
  rawText: string,
  firstName: string,
  reply: (text: string) => Promise<void>
): Promise<void> {
  // ── Step 1: resolve Telegram → ZURIA identity ─────────────────────────────
  const link = await getTgLink(chatId);

  // /start command or brand-new user → always show the welcome prompt
  const isStartCommand = rawText === "/start" || rawText.startsWith("/start ");
  if (!link || isStartCommand) {
    await saveTgLink(chatId, { state: "awaiting_phone", pinAttempts: 0, lockedUntil: null });
    await reply(
      `👋 *Welcome to ZURIA, ${firstName}!*\n\n` +
      `I'm your personal business helper — record sales, track debts, check your balance, and more.\n\n` +
      `To get started, please send me your *ZURIA phone number* (the one you registered with).\n` +
      `Example: *0241234567*\n\n` +
      `Don't have an account yet? Create one at:\n${APP_URL}/signup`
    );
    return;
  }

  // Awaiting phone number
  if (link.state === "awaiting_phone") {
    const phone = normalisePhone(rawText);
    if (!/^\+\d{10,15}$/.test(phone)) {
      await reply("❌ That doesn't look like a valid phone number. Please send your Ghana number, e.g. *0241234567*");
      return;
    }
    // Check if registered
    const lookup = await getUserByPhone(phone);
    if (!lookup) {
      await reply(
        `❌ No ZURIA account found for *${rawText.trim()}*.\n\n` +
        `Please create an account first at:\n${APP_URL}/login\n\n` +
        `Then come back here and send your number again.`
      );
      return;
    }
    // Phone found — ask for PIN (silently, without showing it anywhere)
    await saveTgLink(chatId, { phone, userId: lookup.user.id, state: "awaiting_pin" });
    await reply(
      `✅ Found your account!\n\n` +
      `🔐 Please enter your *4-digit ZURIA PIN* to verify it's you.\n\n` +
      `_Your PIN is never stored or shown in this chat._`
    );
    return;
  }

  // Awaiting PIN — silently verify, never echo the PIN back
  if (link.state === "awaiting_pin") {
    // ── Check if account is locked due to too many wrong PINs ────────────
    if (link.lockedUntil && new Date(link.lockedUntil) > new Date()) {
      await reply(
        "🔒 *Too many wrong PINs. Your Telegram link is locked for 1 hour.*\n\n" +
        "If this wasn't you, please open the ZURIA app and change your PIN immediately. 🙏"
      );
      return;
    }

    const phone = link.phone!;
    const isPinEntry = /^\d{4}$/.test(rawText);
    if (!isPinEntry) {
      await reply("🔐 Please enter your *4-digit PIN* to continue.");
      return;
    }

    // Look up stored PIN and verify
    const lookup = await getUserByPhone(phone);
    if (!lookup || !lookup.pin) {
      await reply("❌ Could not verify your account. Please try sending your phone number again.");
      await saveTgLink(chatId, { state: "awaiting_phone", pinAttempts: 0, lockedUntil: null });
      return;
    }

    const pinCheck = verifyPin(rawText, lookup.pin ?? "");
    const pinCorrect = pinCheck.valid;

    if (!pinCorrect) {
      const attempts = (link.pinAttempts ?? 0) + 1;
      const attemptsLeft = Math.max(0, MAX_PIN_ATTEMPTS - attempts);
      if (attempts >= MAX_PIN_ATTEMPTS) {
        const lockedUntil = new Date(Date.now() + PIN_LOCK_DURATION_MS).toISOString();
        await saveTgLink(chatId, { pinAttempts: attempts, lockedUntil });
        await reply(
          "🔒 *Too many wrong PINs. Your Telegram link is locked for 1 hour.*\n\n" +
          "If this wasn't you, please open the ZURIA app and change your PIN immediately. 🙏"
        );
      } else {
        await saveTgLink(chatId, { pinAttempts: attempts });
        await reply(
          `❌ Incorrect PIN. You have *${attemptsLeft}* ${attemptsLeft === 1 ? "try" : "tries"} left.\n\n` +
          `If you've forgotten your PIN, visit the ZURIA app to reset it.`
        );
      }
      return;
    }

    // PIN correct — activate link, clear lockout counters
    await saveTgLink(chatId, { state: "active", pinAttempts: 0, lockedUntil: null });
    if (pinCheck.needsRehash) {
      getAdminDb().collection(collections.users).doc(lookup.user.id).update({ whatsappPin: hashPin(rawText) }).catch(() => {});
    }
    const { user } = lookup;
    const name = user.ownerName?.split(" ")[0] ?? "there";
    await reply(
      `✅ *Welcome back, ${name}!* 🎉\n\n` +
      `ZURIA is ready. Just tell me what happened in your business:\n` +
      `• "Sold rice 120"\n` +
      `• "Ama owes me 200"\n` +
      `• "balance" — today's report\n` +
      `• "help" — full guide\n\n` +
      `_I'm right here for you! 😊_`
    );
    return;
  }

  // ── Step 2: active session — handle the message ───────────────────────────
  const phone = link.phone!;

  // Silently handle if message looks like a raw 4-digit PIN (security)
  if (/^\d{4}$/.test(rawText)) {
    await reply("🔐 _PIN received. If you meant to lock your account, type \"lock\". Otherwise just tell me what happened in your business._");
    return;
  }

  // Lock intent
  if (detectIntent(rawText) === "lock") {
    clearTelegramContext(chatId);
    await expireSession(phone);
    await saveTgLink(chatId, { state: "awaiting_pin" });
    await reply("🔒 *Account locked.* Send your 4-digit PIN anytime to unlock.");
    return;
  }

  // Load user & business
  const lookup = await getUserByPhone(phone);
  if (!lookup) {
    await reply(fmtUnregistered());
    return;
  }

  const { user, business } = lookup;
  const businessId   = user.businessId ?? "";
  const ownerName    = user.ownerName ?? "there";
  const plan         = getEffectivePlan(user) as SubscriptionPlan;
  const businessName = (business.name as string | undefined) ?? "Your Business";
  const category     = (business.category as BusinessCategory | undefined) ?? "provision";
  const referralLink = user.referralCode ? `${APP_URL}/?ref=${user.referralCode}` : undefined;
  const now          = new Date();
  const monthKey     = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  // ── Unified dispatch pipeline ─────────────────────────────────────────────
  const tgCtx        = await loadTelegramContext(chatId);
  const normalized   = normalizeGhanaianEnglish(rawText);
  const tgClassified = classifyMessage(normalized, tgCtx);
  const tgIsolation  = enforceEngineIsolation(tgClassified, tgCtx, null, normalized);
  const tgIntent     = tgIsolation.blocked ? tgIsolation.override! : tgClassified;
  const tgIsDup      = isDuplicateLedgerEntry(tgIsolation);

  const tgPersist = async (msg: string, txnUpdate?: TxnContextUpdate, subUi = false): Promise<void> => {
    await saveTelegramContext(chatId, tgIntent, subUi, txnUpdate);
    appendConversationHistory("telegram", chatId, rawText, msg, tgCtx.conversationHistory);
  };

  // ── Payment claim — bypasses gating ───────────────────────────────────────
  const paymentClaim = detectPaymentClaim(rawText);
  if (paymentClaim) {
    const isAnnual = isAnnualPayment(rawText);
    const claimReply = await handlePaymentClaim(paymentClaim, user.id, ownerName, phone, businessName, isAnnual);
    await tgPersist(claimReply);
    await reply(claimReply);
    return;
  }

  // ── SMALLTALK & HELP — before gate, never consume credits ─────────────────
  if (tgIntent.intent === "SMALLTALK") {
    const ai = getActiveProvider();
    const aiReply = await ai.generate({
      businessContext:     `${ownerName}, ${plan} plan, ${category}`,
      conversationHistory: historyToText(tgCtx.conversationHistory),
      currentMessage:      rawText,
      financialContext:    "",
    });
    const msg = aiReply ?? zuriaSmalltalk(rawText, ownerName);
    await tgPersist(msg);
    await reply(msg);
    return;
  }

  if (tgIntent.intent === "HELP_ENGINE") {
    const msg = fmtHelp(ownerName, category, businessName, plan);
    await tgPersist(msg);
    await reply(msg);
    return;
  }

  // ── UNDO — never gated ────────────────────────────────────────────────────
  if (tgIntent.intent === "UNDO") {
    const lastId   = tgCtx.lastTransactionId;
    const lastDesc = tgCtx.lastTransactionDesc;

    if (tgCtx.activeFlow === "undo_confirm" as ConversationState["active_flow"] && lastId) {
      const affirmRE = /^(yes|yep|yeah|yh|confirm|do it|ok|okay|sure|remove|delete|void)$/i;
      if (affirmRE.test(rawText.trim())) {
        const success = await voidTransaction(lastId);
        const msg = success
          ? zuriaUndoConfirmed(lastDesc ?? "that entry", ownerName)
          : zuriaUndoNothing(ownerName);
        await saveTelegramContext(chatId, {
          ...tgIntent,
          state: { ...tgIntent.state, active_flow: "none" },
        }, false, { transactionId: "", transactionDesc: "" });
        appendConversationHistory("telegram", chatId, rawText, msg, tgCtx.conversationHistory);
        await reply(msg);
        return;
      }
    }

    const undoMsg = zuriaUndoPrompt(lastDesc, ownerName);
    await saveTelegramContext(chatId, {
      ...tgIntent,
      state: { ...tgIntent.state, active_flow: "undo_confirm" as ConversationState["active_flow"] },
    }, false);
    appendConversationHistory("telegram", chatId, rawText, undoMsg, tgCtx.conversationHistory);
    await reply(undoMsg);
    return;
  }

  // ── Message-count gate ────────────────────────────────────────────────────
  const msgCount = await getAndMaybeResetMessageCount(user, plan);
  if (plan === "free" && msgCount >= FREE_DAILY_LIMIT) {
    await reply(fmtSubscriptionRequired(FREE_DAILY_LIMIT, businessName, undefined, "daily"));
    return;
  }
  if (plan === "growth" && msgCount >= GROWTH_MONTHLY_LIMIT) {
    await reply(fmtSubscriptionRequired(GROWTH_MONTHLY_LIMIT, businessName, undefined, "monthly"));
    return;
  }

  // Stage near-limit notification for the NEXT response
  const tgSuppressSub = tgIntent.state.subscription_ui_suppressed;
  if (!tgSuppressSub && (plan === "free" || plan === "growth")) {
    const limit     = plan === "free" ? FREE_DAILY_LIMIT : GROWTH_MONTHLY_LIMIT;
    const remaining = Math.max(0, limit - msgCount - 1);
    const period    = plan === "free" ? "today" : "this month";
    if (remaining <= 2) {
      stageLimitNotification("telegram", chatId,
        buildLimitWarning(remaining, limit, period, referralLink)
      ).catch(() => {});
    }
  }

  incrementMessageCount(user.id, plan).catch(() => {});

  const tgStaged = tgCtx.pendingLimitNotification;

  // ── LEDGER_QUERY_ENGINE ───────────────────────────────────────────────────
  if (tgIntent.intent === "LEDGER_QUERY_ENGINE") {
    const queryMap: Partial<Record<string, string>> = {
      summary:         "summary",
      debt_list:       "debts",
      loan_list:       "loans",
      stock_level:     "stock",
      weekly_report:   "weekly_report",
      monthly_report:  "monthly_report",
      full_dashboard:  "full_dashboard",
      referral_status: "referral",
    };
    const qi = (queryMap[tgIntent.sub_intent ?? ""] ?? detectIntent(rawText) ?? "summary") as string;

    try {
      const result = await dispatchTgQuery(
        qi, businessId, ownerName, category, businessName,
        plan, referralLink, user as unknown as Record<string, unknown>, monthKey
      );
      const msg = tgStaged ? `${tgStaged}\n\n${result}` : result;
      await tgPersist(msg);
      await reply(msg);
    } catch (err) {
      await logError("telegram/query", err, { phone });
      await reply(fmtSystemError());
    }
    return;
  }

  // ── SUBSCRIPTION_ENGINE ───────────────────────────────────────────────────
  if (tgIntent.intent === "SUBSCRIPTION_ENGINE") {
    if (!tgSuppressSub || tgIntent.sub_intent === "upgrade_request") {
      const payMsg = await generatePaystackLinksMessage(user.id, phone, businessName, ownerName, plan);
      await tgPersist(payMsg, undefined, true);
      await reply(payMsg);
    } else {
      const brief = `You're on the *${plan}* plan. Type *subscribe* to upgrade.`;
      await tgPersist(brief);
      await reply(brief);
    }
    return;
  }

  // ── LEDGER_ENGINE — multi-intent aware ────────────────────────────────────
  if (tgIntent.intent === "LEDGER_ENGINE") {
    const multiResult = parseMultiIntent(normalized);

    if (multiResult.isMultiIntent) {
      try {
        const createdAt = new Date().toISOString();
        let lastTxnId = "";
        let lastDesc  = "";

        for (const p of multiResult.transactions) {
          const txn: Transaction = {
            id: createId("txn"), businessId, userId: user.id,
            rawText: normalized, type: p.type,
            amount: p.amount, quantity: p.quantity,
            productName: p.productName, customerName: p.customerName,
            customerNameNormalized: p.customerNameNormalized,
            category: p.category, paymentMethod: p.paymentMethod,
            currency: "GHS, Cedis", notes: p.notes,
            confidence: p.confidence, createdAt, syncStatus: "synced", source: "manual",
          };
          if (!tgIsDup) await saveTransaction(txn, phone);
          lastTxnId = txn.id;
          lastDesc = `${p.type} of ${formatMoney(p.amount)}${p.productName ? ` (${p.productName})` : ""}`;
        }

        const todayTxns = await getTodayTransactions(businessId);
        const moneyIn   = sum(todayTxns.filter((t) => MONEY_IN_TYPES.includes(t.type)));
        const moneyOut  = sum(todayTxns.filter((t) => MONEY_OUT_TYPES.includes(t.type)));
        const core = fmtMultiConfirm(multiResult.transactions, moneyIn, moneyOut);
        const msg  = tgStaged ? `${tgStaged}\n\n${core}` : core;

        await tgPersist(msg, { transactionId: lastTxnId, transactionDesc: lastDesc });
        await reply(msg);
        return;
      } catch (err) {
        await logError("telegram/multi-intent", err, { phone });
        await reply(fmtSystemError());
        return;
      }
    }

    const parsed = multiResult.transactions[0];
    if (!parsed || parsed.amount <= 0 || parsed.confidence < 0.40) {
      const ai = getActiveProvider();
      const errReply = await ai.generate({
        businessContext: `${ownerName}, ${plan} plan, ${category}`,
        conversationHistory: historyToText(tgCtx.conversationHistory),
        currentMessage: rawText,
        financialContext: "",
      });
      const msg = errReply ?? zuriaError(category, businessName);
      await tgPersist(msg);
      await reply(msg);
      return;
    }

    try {
      const createdAt = new Date().toISOString();
      const txnId = createId("txn");
      const txn: Transaction = {
        id: txnId, businessId, userId: user.id,
        rawText: normalized, type: parsed.type,
        amount: parsed.amount, quantity: parsed.quantity,
        productName: parsed.productName, customerName: parsed.customerName,
        customerNameNormalized: parsed.customerNameNormalized,
        category: parsed.category, paymentMethod: parsed.paymentMethod,
        currency: "GHS, Cedis", notes: parsed.notes,
        confidence: parsed.confidence, createdAt, syncStatus: "synced", source: "manual",
      };

      if (!tgIsDup) await saveTransaction(txn, phone);

      const todayTxns = await getTodayTransactions(businessId);
      const moneyIn  = sum(todayTxns.filter((t) => MONEY_IN_TYPES.includes(t.type)));
      const moneyOut = sum(todayTxns.filter((t) => MONEY_OUT_TYPES.includes(t.type)));

      const ai = getActiveProvider();
      const aiConf = await ai.generate({
        businessContext:     `${ownerName}, ${plan} plan, ${category}`,
        conversationHistory: historyToText(tgCtx.conversationHistory),
        currentMessage:      rawText,
        financialContext:    `Today: in=${moneyIn}, out=${moneyOut}`,
      });
      const confirm = aiConf ?? zuriaConfirm(parsed, { in: moneyIn, out: moneyOut }, category, businessName);
      const insight = !aiConf ? generateInsight({ dailyIn: moneyIn, dailyOut: moneyOut }) : null;
      const core    = [confirm, insight].filter(Boolean).join("\n\n");
      const msg     = tgStaged ? `${tgStaged}\n\n${core}` : core;

      const txnDesc = `${parsed.type} of ${formatMoney(parsed.amount)}${parsed.productName ? ` (${parsed.productName})` : ""}`;
      await tgPersist(msg, tgIsDup ? undefined : { transactionId: txnId, transactionDesc: txnDesc });
      await reply(msg);
    } catch (err) {
      await logError("telegram/saveTransaction", err, { phone });
      await reply(fmtSystemError());
    }
    return;
  }

  // ── ERROR fallback ────────────────────────────────────────────────────────
  {
    const ai = getActiveProvider();
    const aiReply = await ai.generate({
      businessContext:     `${ownerName}, ${plan} plan, ${category}`,
      conversationHistory: historyToText(tgCtx.conversationHistory),
      currentMessage:      rawText,
      financialContext:    "",
    });
    const msg = aiReply ?? zuriaError(category, businessName);
    await tgPersist(msg);
    await reply(msg);
  }
}
