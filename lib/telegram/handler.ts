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
import { createId }           from "@/lib/utils";
import { hashPin, verifyPin }  from "@/lib/security/pin";
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
import { expireSession } from "@/lib/whatsapp/security";
import { logError }      from "@/lib/server/error-logger";
import { MONEY_IN_TYPES, MONEY_OUT_TYPES, SUBSCRIPTION_TIERS } from "@/types/domain";
import type { BusinessCategory, Debt, PaystackPayment, SubscriptionPlan, Transaction } from "@/types/domain";
import { sendTelegram }  from "@/lib/telegram/client";
import { getAdminDb }    from "@/lib/firebase/admin";
import { collections }   from "@/lib/firebase/collections";
import { APP_URL }       from "@/lib/config";
import { initializePayment } from "@/lib/services/paystack-service";

// ── Constants ─────────────────────────────────────────────────────────────────

const FREE_DAILY_LIMIT     = 10;
const GROWTH_MONTHLY_LIMIT = 200;

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
  | "full_dashboard" | "referral" | "lock";

function detectIntent(text: string): QueryIntent | null {
  const t = text.toLowerCase().trim();
  if (/\b(referral|refer|my\s*link|my\s*earnings?|earn|cash\s*out)\b/.test(t)) return "referral";
  if (/\b(help|commands|guide|start|tutorial)\b/.test(t)) return "help";
  if (/\b(subscribe|upgrade|plan|pricing|growth|pro|enterprise|paid)\b/.test(t)) return "subscribe";
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
      // ignore per-plan errors
    }
  }

  if (links.length === 0) {
    return fmtSubscribePlans(currentPlan, businessName);
  }

  const lines = [
    `💳 *Upgrade ZURIA, ${firstName}!*`,
    ``,
    `Tap a link to pay securely via MoMo, bank transfer, or card — activates instantly:`,
    ``,
  ];
  links.forEach(({ plan: p, url, amountGHS }) => {
    lines.push(`*${planLabels[p]}* — GHS ${amountGHS}/month`);
    lines.push(url);
    lines.push(``);
  });
  lines.push(
    `🌐 Full plans + annual pricing:`,
    `${APP_URL}/subscription`,
    ``,
    `_Links expire in 30 min. Type *subscribe* for a fresh link._`,
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

// ── Main entry point ─────────────────────────────────────────────────────────

export async function handleTelegram(update: Record<string, unknown>): Promise<void> {
  const message = update.message as Record<string, unknown> | undefined;
  if (!message) return; // ignore non-message updates (edits, reactions, etc.)

  const chatId    = String((message.chat as Record<string, unknown>)?.id ?? "");
  const rawText   = (message.text as string | undefined)?.trim() ?? "";
  const firstName = ((message.from as Record<string, unknown>)?.first_name as string | undefined) ?? "there";

  if (!chatId || !rawText) return;

  const reply = (text: string) => sendTelegram(chatId, text);

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
  const businessId  = user.businessId ?? "";
  const ownerName   = user.ownerName ?? "there";
  const plan        = getEffectivePlan(user) as SubscriptionPlan;
  const businessName = (business.name as string | undefined) ?? "Your Business";
  const category     = (business.category as BusinessCategory | undefined) ?? "provision";

  // Message count / subscription gate
  const msgCount = await getAndMaybeResetMessageCount(user, plan);
  if (plan === "free" && msgCount >= FREE_DAILY_LIMIT) {
    // Do NOT increment — user is already at limit; incrementing further is misleading
    await reply(fmtSubscriptionRequired(FREE_DAILY_LIMIT, businessName, undefined, "daily"));
    return;
  }
  if (plan === "growth" && msgCount >= GROWTH_MONTHLY_LIMIT) {
    // Do NOT increment — user is already at limit
    await reply(fmtSubscriptionRequired(GROWTH_MONTHLY_LIMIT, businessName, undefined, "monthly"));
    return;
  }

  // ── Query intents ─────────────────────────────────────────────────────────
  const intent = detectIntent(rawText);

  if (intent === "help") {
    await incrementMessageCount(user.id, plan);
    await reply(fmtHelp(ownerName, category, businessName, plan));
    return;
  }

  if (intent === "subscribe") {
    const payMsg = await generatePaystackLinksMessage(user.id, phone, businessName, ownerName, plan);
    await reply(payMsg);
    return;
  }

  if (intent === "debts") {
    try {
      const debts = await getOpenDebts(businessId);
      await reply(fmtDebts(debts, businessName));
    } catch (err) {
      await logError("telegram/debts", err, { phone });
      await reply(fmtSystemError());
    }
    return;
  }

  if (intent === "loans") {
    try {
      const loans = await getLoans(businessId);
      await reply(fmtLoans(loans, businessName));
    } catch (err) {
      await logError("telegram/loans", err, { phone });
      await reply(fmtSystemError());
    }
    return;
  }

  if (intent === "stock") {
    try {
      const inventory = await getInventory(businessId);
      await reply(fmtStock(inventory, businessName));
    } catch (err) {
      await logError("telegram/stock", err, { phone });
      await reply(fmtSystemError());
    }
    return;
  }

  if (intent === "summary") {
    try {
      const txns = await getTodayAndYesterdayTransactions(businessId);
      const debts = await getOpenDebts(businessId);
      const { openCount, openTotal } = summariseDebts(debts);
      const referralLink = user.referralCode
        ? `${APP_URL}/?ref=${user.referralCode}`
        : undefined;
      await reply(fmtEndOfDayReport(
        txns, ownerName, category, businessName,
        referralLink, user.referralBalance ?? 0,
        user.referralCount ?? 0, openCount, openTotal
      ));
    } catch (err) {
      await logError("telegram/summary", err, { phone });
      await reply(fmtSystemError());
    }
    return;
  }

  if (intent === "weekly_report") {
    try {
      const [txns, debts] = await Promise.all([
        getWeekTransactions(businessId),
        getOpenDebts(businessId),
      ]);
      const { openCount, openTotal, overdue7, overdue30 } = summariseDebts(debts);
      const referralLink = user.referralCode
        ? `${APP_URL}/?ref=${user.referralCode}`
        : undefined;
      await reply(fmtWeeklyReport(
        txns, ownerName, category, businessName,
        referralLink, user.referralBalance ?? 0,
        user.referralCount ?? 0, openCount, openTotal, overdue7, overdue30
      ));
    } catch (err) {
      await logError("telegram/weekly_report", err, { phone });
      await reply(fmtSystemError());
    }
    return;
  }

  if (intent === "monthly_report") {
    if (plan === "free") {
      await reply("📅 *Monthly reports* are available on ZURIA Growth and above. Type *subscribe* to upgrade.");
      return;
    }
    try {
      const [txns, debts] = await Promise.all([
        getMonthTransactions(businessId),
        getOpenDebts(businessId),
      ]);
      const { openCount, openTotal, overdue7, overdue30 } = summariseDebts(debts);
      const referralLink = user.referralCode
        ? `${APP_URL}/?ref=${user.referralCode}`
        : undefined;
      await reply(fmtMonthlyReport(
        txns, ownerName, category, businessName,
        referralLink, user.referralBalance ?? 0,
        user.referralCount ?? 0, openCount, openTotal, overdue7, overdue30
      ));
    } catch (err) {
      await logError("telegram/monthly_report", err, { phone });
      await reply(fmtSystemError());
    }
    return;
  }

  if (intent === "full_dashboard") {
    if (plan !== "pro" && plan !== "enterprise") {
      await reply("🏛️ *Full Dashboard* is available on ZURIA Pro and Enterprise. Type *subscribe* to upgrade.");
      return;
    }
    try {
      const txns = await getAllTransactions(businessId);
      await reply(fmtFullDashboard(txns, ownerName, category, businessName, plan));
    } catch (err) {
      await logError("telegram/full_dashboard", err, { phone });
      await reply(fmtSystemError());
    }
    return;
  }

  if (intent === "referral") {
    try {
      const referralLink = user.referralCode
        ? `${APP_URL}/?ref=${user.referralCode}`
        : undefined;
      const db = getAdminDb();
      const [refSnap, wdSnap] = await Promise.all([
        db.collection(collections.referrals)
          .where("referrerId", "==", user.id)
          .get(),
        db.collection(collections.withdrawals)
          .where("userId", "==", user.id)
          .where("status", "in", ["pending", "processing"])
          .limit(1)
          .get(),
      ]);
      const now = new Date();
      const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      const monthlyReferrals = refSnap.docs.filter(
        (d) => (d.data().createdAt as string | undefined)?.startsWith(monthKey)
      ).length;
      const pendingWithdrawal = !wdSnap.empty;
      await reply(fmtReferralStatus(
        ownerName, businessName,
        user.referralCode ?? "",
        user.referralBalance ?? 0,
        user.referralCount ?? 0,
        monthlyReferrals, referralLink, pendingWithdrawal
      ));
    } catch (err) {
      await logError("telegram/referral", err, { phone });
      await reply(fmtSystemError());
    }
    return;
  }

  // ── Transaction recording ─────────────────────────────────────────────────
  const parsed = parseTransaction(rawText);

  if (parsed.confidence < 0.30 || (parsed.amount === 0 && !parsed.customerName)) {
    await reply(fmtNotFound(category, businessName));
    return;
  }

  try {
    const txn: Transaction = {
      id:                     createId("txn"),
      businessId,
      userId:                 user.id,
      rawText,
      type:                   parsed.type,
      amount:                 parsed.amount,
      quantity:               parsed.quantity,
      productName:            parsed.productName,
      customerName:           parsed.customerName,
      customerNameNormalized: parsed.customerNameNormalized,
      category:               parsed.category,
      paymentMethod:          parsed.paymentMethod,
      currency:               "GHS, Cedis",
      notes:                  rawText,
      confidence:             parsed.confidence,
      syncStatus:             "synced",
      source:                 "manual",
      createdAt:              new Date().toISOString(),
    };

    await saveTransaction(txn, phone);
    await incrementMessageCount(user.id, plan);

    const todayTxns = await getTodayTransactions(businessId);
    const moneyIn  = sum(todayTxns.filter((t) => MONEY_IN_TYPES.includes(t.type)));
    const moneyOut = sum(todayTxns.filter((t) => MONEY_OUT_TYPES.includes(t.type)));

    await reply(fmtConfirm(parsed, { in: moneyIn, out: moneyOut }, category, businessName));
  } catch (err) {
    await logError("telegram/saveTransaction", err, { phone });
    await reply(fmtSystemError());
  }
}
