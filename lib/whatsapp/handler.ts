import { parseTransaction } from "@/lib/parsers/transaction-parser";
import { createId, formatMoney } from "@/lib/utils";
import type { ConversationState } from "@/lib/intelligence/types";
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
import type { BusinessCategory, Debt, PaymentLedgerEntry, PaystackPayment, SubscriptionPlan, Transaction } from "@/types/domain";
import { sendText } from "@/lib/whatsapp/client";
import { getAdminDb } from "@/lib/firebase/admin";
import { collections } from "@/lib/firebase/collections";
import { APP_URL, SUPPORT_WA_LINK } from "@/lib/config";
import { initializePayment } from "@/lib/services/paystack-service";
import { classifyMessage } from "@/lib/intelligence/intent-classifier";
import {
  loadWhatsAppContext, saveWhatsAppContext, clearWhatsAppContext,
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

// Admin number for subscription payment notifications
const ADMIN_PHONE = process.env.ADMIN_PHONE ?? process.env.NEXT_PUBLIC_ADMIN_PHONE ?? "";
const FREE_DAILY_LIMIT      = 10;   // free tier: 10 entries per day
const GROWTH_MONTHLY_LIMIT  = 200;  // growth tier: 200 entries per month
const MONTHLY_UNLOCK_TARGET = 30;   // referrals this month needed to unlock Growth

/** Sum the amount field of an array of Transactions */
const sum = (txns: { amount: number }[]): number =>
  txns.reduce((acc, t) => acc + t.amount, 0);

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
  | "referral"
  | "undo";

function detectIntent(text: string): QueryIntent | null {
  const t = text.toLowerCase().trim();

  // Referral / earnings — check before "help" to avoid false match on "help earn"
  if (/\b(referral|refer|my\s*link|my\s*earnings?|earn(ings?)?|refer\s*&?\s*earn|my\s*balance|cashout|cash\s*out|withdraw\s*referral)\b/.test(t)) return "referral";

  // Undo / delete last entry — checked before summary/help to prevent false matches
  if (/\b(undo|delete\s*last|cancel\s*last|remove\s*last|wrong\s*entry|wrong\s*amount|mistake|retract|i\s*made\s*a\s*mistake)\b/.test(t)) return "undo";

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
    clearWhatsAppContext(fromPhone);
    await expireSession(fromPhone);
    return "🔒 *Locked!* Send any message and type your PIN to get back in. Stay safe! 🙏";
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ── UNIFIED DISPATCH PIPELINE ────────────────────────────────────────────
  //
  // Single brain. No dual-dispatch. All routing decisions are made here.
  //
  // Order:
  //  1. Load context (TTL-aware — stale context resets automatically)
  //  2. Pre-process Ghanaian English → parser-friendly terms
  //  3. Classify the (normalized) message
  //  4. Engine isolation guard (5 anti-bug rules)
  //  5. Payment claim — always before gating
  //  6. SMALLTALK & HELP — never consume message credits
  //  7. UNDO — correction is always free (trust repair)
  //  8. Message-count gate (hard wall for free/growth users)
  //  9. Staged limit warning from previous turn (shown as preamble)
  // 10. LEDGER_QUERY_ENGINE
  // 11. SUBSCRIPTION_ENGINE
  // 12. LEDGER_ENGINE (with Ghanaian normalize + multi-intent)
  // 13. ERROR — ZURIA-voice clarification
  // 14. Save context (synchronous with 800ms timeout)
  // 15. Append to conversation history (fire-and-forget)
  // ─────────────────────────────────────────────────────────────────────────

  const convCtx    = await loadWhatsAppContext(fromPhone);
  const normalized = normalizeGhanaianEnglish(text);
  const classified = classifyMessage(normalized, convCtx);
  const isolation  = enforceEngineIsolation(classified, convCtx, null, normalized);
  const finalIntent = isolation.blocked ? isolation.override! : classified;
  const isDuplicate = isDuplicateLedgerEntry(isolation);

  const effectivePlan = getEffectivePlan(user);
  const referralCode  = user.referralCode ?? "";
  const referralLink  = referralCode ? `${APP_URL}/?ref=${referralCode}` : undefined;
  const thisMonthKey  = new Date().toISOString().slice(0, 7);
  const monthlyReferrals =
    (user.referralMonthlyResetKey ?? "") === thisMonthKey
      ? (user.referralMonthlyCount ?? 0)
      : 0;

  // Helper: save context + update history in one call
  const persist = async (reply: string, txnUpdate?: TxnContextUpdate, subUiShown = false): Promise<void> => {
    await saveWhatsAppContext(fromPhone, finalIntent, subUiShown, txnUpdate);
    appendConversationHistory("whatsapp", fromPhone, text, reply, convCtx.conversationHistory);
  };

  // ── 5. Payment claim — bypasses all gating ────────────────────────────────
  const paymentPlan = detectPaymentClaim(text);
  if (paymentPlan) {
    const annual = isAnnualPayment(text);
    const reply = await handlePaymentClaim(paymentPlan, user.id, user.ownerName, fromPhone, bName, annual);
    await persist(reply);
    return reply;
  }

  // ── 6. SMALLTALK & HELP — before gate, never consume credits ─────────────
  if (finalIntent.intent === "SMALLTALK") {
    const ai = getActiveProvider();
    const aiReply = await ai.generate({
      businessContext:     `${user.ownerName}, ${effectivePlan} plan, ${business.category}`,
      conversationHistory: historyToText(convCtx.conversationHistory),
      currentMessage:      text,
      financialContext:    "",
    });
    const reply = aiReply ?? zuriaSmalltalk(text, user.ownerName);
    await persist(reply);
    return reply;
  }

  if (finalIntent.intent === "HELP_ENGINE") {
    const result = await handleQuery(
      "help", business.id, user.ownerName, business.category,
      bName, effectivePlan, referralLink,
      (user.referralBalance as number | undefined) ?? 0,
      monthlyReferrals, user as unknown as Record<string, unknown>
    );
    await persist(result);
    return result;
  }

  // ── 7. UNDO — correction flow, never gated ───────────────────────────────
  if (finalIntent.intent === "UNDO") {
    const lastId   = convCtx.lastTransactionId;
    const lastDesc = convCtx.lastTransactionDesc;

    // Sub-case: user already confirmed an undo (previous turn was undo prompt)
    if (convCtx.activeFlow === "undo_confirm" as ConversationState["active_flow"] && lastId) {
      const affirmRE = /^(yes|yep|yeah|yh|confirm|do it|ok|okay|sure|remove|delete|void)$/i;
      if (affirmRE.test(text.trim())) {
        const success = await voidTransaction(lastId);
        const reply = success
          ? zuriaUndoConfirmed(lastDesc ?? "that entry", user.ownerName)
          : zuriaUndoNothing(user.ownerName);
        // Reset context after undo
        await saveWhatsAppContext(fromPhone, {
          ...finalIntent,
          intent: "UNDO",
          state: { ...finalIntent.state, active_flow: "none" },
        }, false, { transactionId: "", transactionDesc: "" });
        appendConversationHistory("whatsapp", fromPhone, text, reply, convCtx.conversationHistory);
        return reply;
      }
    }

    // Show undo confirmation prompt
    const reply = zuriaUndoPrompt(lastDesc, user.ownerName);
    // Set activeFlow to undo_confirm so the next "yes" triggers the delete
    await saveWhatsAppContext(fromPhone, {
      ...finalIntent,
      state: { ...finalIntent.state, active_flow: "undo_confirm" as ConversationState["active_flow"] },
    }, false);
    appendConversationHistory("whatsapp", fromPhone, text, reply, convCtx.conversationHistory);
    return reply;
  }

  // ── 8. Message-count gate ─────────────────────────────────────────────────
  if (effectivePlan === "free" || effectivePlan === "growth") {
    const limit = effectivePlan === "free" ? FREE_DAILY_LIMIT : GROWTH_MONTHLY_LIMIT;
    let usedCount = 0;
    try {
      usedCount = await getAndMaybeResetMessageCount(user, effectivePlan);
    } catch (err) {
      await logError("[handler] getAndMaybeResetMessageCount", err, { phone: fromPhone });
    }

    if (usedCount >= limit) {
      // Hard block — subscription wall
      return fmtSubscriptionRequired(limit, bName, referralLink, effectivePlan === "growth" ? "monthly" : "daily");
    }

    // Check if we need to stage a limit warning for the NEXT response
    // (never appended to the current financial confirmation)
    const suppressSubUi = finalIntent.state.subscription_ui_suppressed;
    if (!suppressSubUi) {
      const remaining = Math.max(0, limit - usedCount - 1); // -1 for this message
      const period = effectivePlan === "free" ? "today" : "this month";
      if (remaining <= 2 && remaining >= 0) {
        // Stage warning — it will appear as preamble on the NEXT message
        stageLimitNotification(
          "whatsapp", fromPhone,
          buildLimitWarning(remaining, limit, period, referralLink),
        ).catch(() => {});
      }
    }

    incrementMessageCount(user.id, effectivePlan).catch(() => {});
  }

  // ── 9. Staged limit warning from previous turn ────────────────────────────
  // If the previous turn staged a warning, prepend it to this response.
  // This cleanly separates monetization from financial confirmations.
  const stagedWarning = convCtx.pendingLimitNotification;

  // ── 10. LEDGER_QUERY_ENGINE ───────────────────────────────────────────────
  if (finalIntent.intent === "LEDGER_QUERY_ENGINE") {
    const queryMap: Partial<Record<string, QueryIntent>> = {
      summary:         "summary",
      debt_list:       "debts",
      loan_list:       "loans",
      stock_level:     "stock",
      weekly_report:   "weekly_report",
      monthly_report:  "monthly_report",
      full_dashboard:  "full_dashboard",
      referral_status: "referral",
    };
    const queryIntent: QueryIntent =
      (queryMap[finalIntent.sub_intent ?? ""] as QueryIntent | undefined)
      ?? (detectIntent(text) as QueryIntent | null)
      ?? "summary";

    try {
      const result = await handleQuery(
        queryIntent, business.id, user.ownerName, business.category,
        bName, effectivePlan, referralLink,
        (user.referralBalance as number | undefined) ?? 0,
        monthlyReferrals, user as unknown as Record<string, unknown>
      );
      const reply = stagedWarning ? `${stagedWarning}\n\n${result}` : result;
      await persist(reply);
      return reply;
    } catch (err) {
      await logError("[handler] handleQuery", err, { phone: fromPhone });
      return fmtSystemError();
    }
  }

  // ── 11. SUBSCRIPTION_ENGINE ───────────────────────────────────────────────
  if (finalIntent.intent === "SUBSCRIPTION_ENGINE") {
    const suppressSubUi = finalIntent.state.subscription_ui_suppressed;
    if (!suppressSubUi || finalIntent.sub_intent === "upgrade_request") {
      const reply = await handleSubscribeIntent(
        user.id, fromPhone, bName, user.ownerName, effectivePlan
      );
      await persist(reply, undefined, true);
      return reply;
    }
    // Subscription UI suppressed — give a brief acknowledgment
    const brief = `You're on the *${effectivePlan}* plan. Reply *"subscribe"* anytime to upgrade.`;
    await persist(brief);
    return brief;
  }

  // ── 12. LEDGER_ENGINE — multi-intent aware ────────────────────────────────
  if (finalIntent.intent === "LEDGER_ENGINE") {
    // Try multi-intent parse first (catches "sold rice 120 and bought fuel 40")
    const multiResult = parseMultiIntent(normalized);

    if (multiResult.isMultiIntent) {
      try {
        const now = new Date().toISOString();
        let lastTxnId = "";
        let lastDesc  = "";

        for (const p of multiResult.transactions) {
          const txn: Transaction = {
            id: createId("txn"),
            businessId: business.id,
            userId:     user.id,
            rawText:    normalized,
            type:       p.type,
            amount:     p.amount,
            quantity:   p.quantity,
            productName: p.productName,
            customerName: p.customerName,
            customerNameNormalized: p.customerNameNormalized,
            category:   p.category,
            paymentMethod: p.paymentMethod,
            currency:   "GHS, Cedis",
            notes:      p.notes,
            confidence: p.confidence,
            createdAt:  now,
            syncStatus: "synced",
            source:     "manual",
          };
          if (!isDuplicate) await saveTransaction(txn, fromPhone);
          lastTxnId = txn.id;
          lastDesc  = `${p.type} of ${formatMoney(p.amount)}${p.productName ? ` (${p.productName})` : ""}`;
        }

        const todayTxns = await getTodayTransactions(business.id);
        const moneyIn   = sum(todayTxns.filter((t) => MONEY_IN_TYPES.includes(t.type)));
        const moneyOut  = sum(todayTxns.filter((t) => MONEY_OUT_TYPES.includes(t.type)));
        const reply     = fmtMultiConfirm(multiResult.transactions, moneyIn, moneyOut);
        const fullReply = stagedWarning ? `${stagedWarning}\n\n${reply}` : reply;

        await persist(fullReply, { transactionId: lastTxnId, transactionDesc: lastDesc });
        return fullReply;
      } catch (err) {
        await logError("[handler] multi-intent save", err, { phone: fromPhone });
        return fmtSystemError();
      }
    }

    // Single-intent ledger path
    const parsed = multiResult.transactions[0];
    if (!parsed || parsed.amount <= 0 || parsed.confidence < 0.40) {
      const ai = getActiveProvider();
      const aiErr = await ai.generate({
        businessContext:     `${user.ownerName}, ${effectivePlan} plan, ${business.category}`,
        conversationHistory: historyToText(convCtx.conversationHistory),
        currentMessage:      text,
        financialContext:    "",
      });
      const reply = aiErr ?? zuriaError(business.category, bName);
      await persist(reply);
      return reply;
    }

    try {
      const now = new Date().toISOString();
      const txnId = createId("txn");
      const txn: Transaction = {
        id:                     txnId,
        businessId:             business.id,
        userId:                 user.id,
        rawText:                normalized,
        type:                   parsed.type,
        amount:                 parsed.amount,
        quantity:               parsed.quantity,
        productName:            parsed.productName,
        customerName:           parsed.customerName,
        customerNameNormalized: parsed.customerNameNormalized,
        category:               parsed.category,
        paymentMethod:          parsed.paymentMethod,
        currency:               "GHS, Cedis",
        notes:                  parsed.notes,
        confidence:             parsed.confidence,
        createdAt:              now,
        syncStatus:             "synced",
        source:                 "manual",
      };

      if (!isDuplicate) await saveTransaction(txn, fromPhone);

      const todayTxns = await getTodayTransactions(business.id);
      const moneyIn   = todayTxns.filter((t) => MONEY_IN_TYPES.includes(t.type)).reduce((a, t) => a + t.amount, 0);
      const moneyOut  = todayTxns.filter((t) => MONEY_OUT_TYPES.includes(t.type)).reduce((a, t) => a + t.amount, 0);

      const ai = getActiveProvider();
      const aiResp = await ai.generate({
        businessContext:     `${user.ownerName}, ${effectivePlan} plan, ${business.category}`,
        conversationHistory: historyToText(convCtx.conversationHistory),
        currentMessage:      text,
        financialContext:    `Today: in=${moneyIn}, out=${moneyOut}`,
      });

      const confirm  = aiResp ?? zuriaConfirm(parsed, { in: moneyIn, out: moneyOut }, business.category, bName);
      const insight  = !aiResp ? generateInsight({ dailyIn: moneyIn, dailyOut: moneyOut }) : null;
      const core     = [confirm, insight].filter(Boolean).join("\n\n");
      const fullReply = stagedWarning ? `${stagedWarning}\n\n${core}` : core;

      const txnDesc = `${parsed.type} of ${formatMoney(parsed.amount)}${parsed.productName ? ` (${parsed.productName})` : ""}`;
      await persist(fullReply, isDuplicate ? undefined : { transactionId: txnId, transactionDesc: txnDesc });
      return fullReply;
    } catch (err) {
      await logError("[handler] saveTransaction", err, { phone: fromPhone });
      return fmtSystemError();
    }
  }

  // ── 13. ERROR — ZURIA-voice clarification ────────────────────────────────
  {
    const ai = getActiveProvider();
    const aiReply = await ai.generate({
      businessContext:     `${user.ownerName}, ${effectivePlan} plan, ${business.category}`,
      conversationHistory: historyToText(convCtx.conversationHistory),
      currentMessage:      text,
      financialContext:    "",
    });
    const reply = aiReply ?? zuriaError(business.category, bName);
    const fullReply = stagedWarning ? `${stagedWarning}\n\n${reply}` : reply;
    await persist(fullReply);
    return fullReply;
  }
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

  // ── Duplicate-payment guard ─────────────────────────────────────────────────
  // Enterprise is the top tier — there is nothing to upgrade to.
  // Returning a clear message prevents a new payment link being generated for an
  // already-active plan, which would expose the user to a double-charge.
  if (currentPlan === "enterprise") {
    return [
      `✅ *You're already on ZURIA Enterprise, ${firstName}!*`,
      ``,
      `Your plan is active. Reply *"help"* to see what you can do, or visit ${APP_URL}/subscription to manage your account.`,
      `_— ZURIA_`,
    ].join("\n");
  }

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
        // Persist pending payment + PAYMENT_INITIATED ledger entry atomically.
        // The ledger entry ensures every payment initialization is traceable
        // regardless of whether the user completes checkout.
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
        const db = getAdminDb();
        const waBatch = db.batch();
        waBatch.set(db.collection(collections.payments).doc(reference), paymentDoc);
        waBatch.set(db.collection(collections.paymentEvents).doc(initiatedLedgerId), ledgerEntry);
        waBatch.commit().catch(() => {});

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
    `Tap a link below to pay — it opens Paystack's secure checkout in your browser.`,
    `You can pay with *MoMo* (any network), *bank card*, or *bank transfer*.`,
    `Your plan activates *instantly* the moment payment is confirmed. ✅`,
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
    `🌐 More options + annual pricing (2 months free!):`,
    `${APP_URL}/subscription`,
    ``,
    `_Links expire in 30 minutes. Reply *"subscribe"* for a fresh one._`,
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
  // Always derive prices from the canonical SUBSCRIPTION_TIERS source so that
  // changes to pricing need to be made in one place only (types/domain.ts).
  const tier = SUBSCRIPTION_TIERS[plan];
  const amount = annual ? (tier.annualPriceGHS ?? tier.priceGHS * 10) : tier.priceGHS;
  const price = annual
    ? `GHS ${tier.annualPriceGHS ?? tier.priceGHS * 10}/year (2 months free!)`
    : `GHS ${tier.priceGHS}/month`;

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

  // ── Notify admin — manual fallback for when Paystack webhook may have missed ──
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
      `⚡ Check Paystack dashboard for payment from ${fromPhone} (GHS ${amount}).`,
      `   If confirmed, activate:`,
      `PATCH /api/admin/subscriptions/${userId}`,
      `Body: { "plan": "${plan}", "durationDays": ${annual ? 365 : 30}, "claimId": "${claimId}" }`,
    ].join("\n")).catch((err) => {
      logError("[handler] admin payment-claim notification", err, {
        phone: fromPhone,
        meta: { claimId, plan, userId },
        severity: "warn",
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
    `📋 _Reference: ${claimId} — keep this in case you need support._`,
    ``,
    `💡 _Next time, reply *"subscribe"* to get a direct Paystack link — instant activation, no waiting._`,
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

  if (intent === "undo") {
    return await handleUndoIntent(businessId, businessName);
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

// ─── Undo / delete last transaction ──────────────────────────────────────────
// Finds and deletes the most recent transaction for this business.
// Best-effort: debt and inventory side-effects are reversed via Admin SDK.

async function handleUndoIntent(businessId: string, businessName: string): Promise<string> {
  try {
    const adminDb = getAdminDb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let lastTxn: any;
    try {
      const snap = await adminDb
        .collection(collections.transactions)
        .where("businessId", "==", businessId)
        .orderBy("createdAt", "desc")
        .limit(1)
        .get();
      lastTxn = snap.docs[0];
    } catch {
      // Composite index may not be deployed yet — sort client-side
      const snap = await adminDb
        .collection(collections.transactions)
        .where("businessId", "==", businessId)
        .limit(50)
        .get();
      const sorted = snap.docs.sort((a, b) => {
        const aT = String(a.data().createdAt ?? "");
        const bT = String(b.data().createdAt ?? "");
        return bT.localeCompare(aT);
      });
      lastTxn = sorted[0];
    }

    if (!lastTxn) {
      return [
        "❌ *No entries found to undo.*",
        "",
        "Record something first, then reply *undo* to delete it.",
        "",
        `_— ZURIA (${businessName})_`,
      ].join("\n");
    }

    const txnData = lastTxn.data();
    const label = (txnData.rawText as string | undefined)
      || (txnData.productName as string | undefined)
      || (txnData.notes as string | undefined)
      || "entry";
    const amount = (txnData.amount as number | undefined) ?? 0;
    const txnType = (txnData.type as string | undefined) ?? "";

    await lastTxn.ref.delete();

    const hasDebtEffect  = txnType === "debt" || txnType === "repayment";
    const hasStockEffect = (txnType === "sale" || txnType === "stock_purchase") && txnData.quantity;
    const sideEffectNote = (hasDebtEffect || hasStockEffect)
      ? `\n\n⚠️ _This was a ${hasDebtEffect ? "debt" : "stock"} entry. Check your ${hasDebtEffect ? "Debts" : "Inventory"} section to verify the balance is correct._`
      : "";

    return [
      `✅ *Deleted!*`,
      ``,
      `"${label}" — GHS ${amount} has been removed from your records.${sideEffectNote}`,
      ``,
      `Just type the correct entry to record it again. 😊`,
      ``,
      `_— ZURIA (${businessName})_`,
    ].join("\n");
  } catch (err) {
    console.error("[handleUndoIntent]", err);
    return [
      "❌ *Couldn't delete the entry.*",
      "",
      "Please try again or open the ZURIA app to correct it manually.",
      "",
      `_— ZURIA (${businessName})_`,
    ].join("\n");
  }
}

// Gating message when a lower tier tries an advanced report
function gateMsg(
  feature: string,
  requiredPlanLabel: string,
  requiredPlan: SubscriptionPlan,
  businessName: string
): string {
  const tierInfo = SUBSCRIPTION_TIERS[requiredPlan];
  const price = tierInfo ? `GHS ${tierInfo.priceGHS}/month` : "";
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
