import { createId, formatMoney } from "@/lib/utils";
import {
  fmtDebts,
  fmtEndOfDayReport,
  fmtFullDashboard,
  fmtHelp,
  fmtLoans,
  fmtMonthlyReport,
  fmtReferralStatus,
  fmtStock,
  fmtLimitedIntelligenceMode,
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
  stagePendingTransaction, clearPendingTransaction,
  type TxnContextUpdate,
} from "@/lib/intelligence/conversation-context";
import type { PendingTransactionContext } from "@/lib/intelligence/types";
import { enforceEngineIsolation, isDuplicateLedgerEntry } from "@/lib/intelligence/engine-guard";
import {
  zuriaConfirm, zuriaSmalltalk, zuriaError, generateInsight,
  zuriaUndoPrompt, zuriaUndoNothing, buildLimitWarning,
  zuriaConfirmationRequest, zuriaUndoConfirmedWithEffects,
  zuriaAskAmount, zuriaCoach,
  type CoachingTopic,
} from "@/lib/intelligence/response-engine";
import { normalizeGhanaianEnglish } from "@/lib/intelligence/ghanaian-normalizer";
import { parseMultiIntent, fmtMultiConfirm } from "@/lib/intelligence/multi-intent-parser";
import { getActiveProvider, isAIProviderAvailable } from "@/lib/intelligence/ai-provider";
import { voidTransactionWithSideEffects } from "@/lib/whatsapp/session";
import {
  detectEmotionalState,
  buildOperationalReassurance,
  shouldAddEmotionalLayer,
  enrichResponseWithEmotion,
} from "@/lib/emotional-intelligence";

// Admin number for subscription payment notifications
const ADMIN_PHONE = process.env.ADMIN_PHONE ?? process.env.NEXT_PUBLIC_ADMIN_PHONE ?? "";
const FREE_DAILY_LIMIT      = 15;   // free tier: 15 entries per day
const GROWTH_MONTHLY_LIMIT  = 500;  // growth tier: 500 entries per month
const _MONTHLY_UNLOCK_TARGET = 30;   // referrals this month needed to unlock Growth (used in UI display)

// Spec-mandated 4-tier confidence thresholds are now read from lib/confidence
// (TIER_THRESHOLDS: AUTO=0.90, AI_ENHANCE=0.75, HUMAN=0.50, REJECT=0.00).
// The ensemble confidence engine (computeEnsembleConfidence) is called inline
// in the LEDGER_ENGINE path and sets ensemble.requiresHuman / ensemble.shouldReject.

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

  // Referral
  if (/\b(referral|refer|my\s*link|my\s*earnings?|earn(ings?)?|refer\s*&?\s*earn|my\s*balance|cashout|cash\s*out|withdraw\s*referral)\b/.test(t)) return "referral";

  // Undo / delete last entry
  if (/\b(undo|delete\s*last|cancel\s*last|remove\s*last|wrong\s*entry|wrong\s*amount|mistake|retract|i\s*made\s*a\s*mistake)\b/.test(t)) return "undo";

  // Help
  if (/\b(help|commands|what can|how to use|guide|start|tutorial|mboa me|boa me|bo me kwan)\b/.test(t)) return "help";

  // Subscribe / upgrade
  if (/\b(subscri(be|ption)|upgrade|plan|pricing|plans|hyεn|payment)\b/.test(t)) return "subscribe";

  // Full dashboard / advanced analytics
  if (/\b(full\s*dashboard|all.?time|entire|complete\s*report|all\s*report|analytics|overview\s*all)\b/.test(t)) return "full_dashboard";
  if (/\b(advice|recommend(?:ation)?s?|tips?\s*for\b|smart\s*(?:tip|recommendation)|give\s*me\s*(?:business\s*)?advice)\b/.test(t)) return "full_dashboard";
  if (/\b(top\s*(?:customer|client|buyer)|best[\s-]?selling|most\s*(?:sold|popular|frequent)|customer\s*rank)\b/.test(t)) return "full_dashboard";
  if (/\b(which\s*supplier|top\s*supplier|supplier\s*(?:rank|most|analysis)|buy\s*from\s*(?:most|whom))\b/.test(t)) return "full_dashboard";
  if (/\b(overspend|spent?\s*too\s*much|spending\s*too\s*much|we\s*spend\s*too\s*much|expense\s*(?:hurting|killing|too\s*high)|biggest\s*expense)\b/.test(t)) return "full_dashboard";
  if (/\b(burn\s*rate|runway|cash\s*survive|days?\s*of\s*cash|run\s*out\s*of\s*cash|how\s*long\s*(?:can|will)\s*(?:cash|money))\b/.test(t)) return "full_dashboard";
  if (/\b(business\s*score|health\s*score|my\s*score|why\s*(?:is\s*)?(?:my\s*)?score|performance\s*score)\b/.test(t)) return "full_dashboard";
  if (/\b(suspicious|unusual\s*(?:spend|transaction)|detect\s*(?:unusual|fraud))\b/.test(t)) return "full_dashboard";
  if (/\b(recurring\s*(?:expense|cost)|regular\s*expense|fixed\s*(?:expense|cost))\b/.test(t)) return "full_dashboard";
  if (/\b(compare\s*(?:branch|outlet|week|month)|branch\s*(?:perform|compar)|vs\s*last\s*(?:week|month)|versus\s*last)\b/.test(t)) return "full_dashboard";
  if (/\b(executive\s*(?:report|summary|review)|investor\s*(?:report|summary)|quarterly\s*(?:analysis|report)|ai\s*executive|generate\s*(?:ai|executive|operational|intelligence|comprehensive))\b/.test(t)) return "full_dashboard";
  if (/\b(operational\s*health|business\s*health|efficiency|productivity)\b/.test(t)) return "full_dashboard";
  if (/\b(declin(?:e|ing)|drop(?:ped|ping)\s*(?:suddenly|this)|why\s*(?:is|are)[\w\s]*(?:declin|drop|fall))\b/.test(t)) return "full_dashboard";
  if (/\b(what\s*are\s*my\s*risks?|business\s*risk|vulnerability|weakness)\b/.test(t)) return "full_dashboard";
  if (/\b(margin|markup|best\s*margin|product\s*margin)\b/.test(t)) return "full_dashboard";
  if (/\b(which\s*days?\s*(?:perform|sell|do)\s*best|peak\s*(?:day|hour))\b/.test(t)) return "full_dashboard";
  if (/\b(tax\s*(?:estimate|liability)|how\s*much\s*tax|estimate\s*[\w\s]*\btax\b|gra\s*(?:estimate|payment))\b/.test(t)) return "full_dashboard";
  if (/\b(analy[sz]e?\s*(?:this|my|the|business|beverage|transport|utility|electricity|food|debt|inventory|expense[sd]?|stock|revenue|profit|performance|categor|product|branch|supplier|customer|sales?))\b/.test(t)) return "full_dashboard";
  if (/\b(forecast|predict(?:ion)?|projection)\b/.test(t)) return "full_dashboard";
  if (/\b(expand(?:sion)?|scale\s*up|can\s*(?:i|we)\s*afford|should\s*(?:i|we)\s*expand)\b/.test(t)) return "full_dashboard";
  if (/\b(cash\s*collection\s*(?:rate|improve)|improve\s*cash\s*collection)\b/.test(t)) return "full_dashboard";
  if (/\b(expenses?\s*(?:are\s*)?too\s*high|cash\s*flow\s*(?:is\s*)?(?:a\s*)?problem)\b/.test(t)) return "full_dashboard";
  if (/\b(made?\s*(?:a\s*)?loss|making\s*loss|losing\s*money|i\s*made\s*loss)\b/.test(t)) return "full_dashboard";
  if (/\b(explain\s*(?:my\s*)?(?:\w+\s+){0,3}business|understand\s*(?:my\s*)?(?:\w+\s+){0,2}business|business\s*performance|business\s*(?:advantage|strength|momentum|habit|risk))\b/.test(t)) return "full_dashboard";
  if (/\b(staff\s*(?:spending|cost|too\s*much)|payroll\s*analysis)\b/.test(t)) return "full_dashboard";
  if (/\b(should\s*(?:i|we)\s*reduce|reduce\s*(?:expense|cost|spending)|cut\s*(?:expense|cost))\b/.test(t)) return "full_dashboard";
  if (/\b(alert\s*(?:me\s*)?when\s*(?:cash|money)|notify\s*(?:me\s*)?when\s*cash|cash\s*alert)\b/.test(t)) return "full_dashboard";
  if (/\b(branch(?:es)?|outlet)\b/.test(t)) return "full_dashboard";
  if (/\b(small\s*expense[sd]?\s*adding|petty\s*(?:cash\s*)?expense)\b/.test(t)) return "full_dashboard";
  if (/\b(sales?\s*(?:drop(?:ped|s|ping)?|fell|fallen|declin(?:e|ed|ing)?|slow(?:ed|ing)?)|beverage\s*(?:sales?|revenue)|biscuit\s*sales?\s*(?:drop|fell|declin))\b/.test(t)) return "full_dashboard";
  if (/\b(smart\s*recommendation|business\s*improvement)\b/.test(t)) return "full_dashboard";
  if (/\b(inventory\s*turnover|stock\s*turnover|how\s*fast\s*(?:stock|inventory)|movement\s*rate|fast[\s-]?(?:moving|mover)|slow[\s-]?(?:moving|mover))\b/.test(t)) return "full_dashboard";
  if (/\b(supplier\s*(?:reduc|increas|rais|chang).*price|price.*(?:reduc|increas|rais|lower).*(?:supplier|this|week|month)|renegotiat)\b/.test(t)) return "full_dashboard";
  if (/\b(percentage\s*of\s*revenue|revenue.*(?:vs|versus|against|compar).*(?:expense|cost|debt)|outpac(?:e|ed|ing)|expense\s*(?:categor|group|type).*(?:fastest|growing|most)|which\s*expense\s*categor)\b/.test(t)) return "full_dashboard";
  if (/\b(simulat|if\s*(?:sales?|expense[sd]?|cost[sd]?)\s*(?:continue|increase|decrease)|what\s*(?:would|will)\s*happen\b|what\s*if\s*(?:i|we|sales?|expense)|scenario\s*(?:plan|analys))\b/.test(t)) return "full_dashboard";
  if (/\b(compare\s*(?:my\s*)?(?:best|worst|last)\s*(?:month|week|period)|best\s*month.*worst|worst\s*month|my\s*best\s*(?:month|period))\b/.test(t)) return "full_dashboard";
  if (/\b((?:average|estimate[d]?|typical)\s*(?:weekly|daily|monthly)?\s*(?:operating|operational|overhead|running|fixed)\s*cost[sd]?|weekly\s*operating\s*cost|average\s*(?:cost|expense)\s*(?:per\s*week|per\s*month|weekly|monthly))\b/.test(t)) return "full_dashboard";
  if (/\b(weekend[sd]?|which\s*days?\s*(?:generate|produce|make|create)|strongest\s*(?:sales?\s*)?day[sd]?|best\s*(?:performing\s*)?day[sd]?|why\s*do\s*(?:weekend|weekday|day))\b/.test(t)) return "full_dashboard";
  if (/\b(cash\s*(?:tied|locked|stuck)\s*(?:up|in)|explain\s*(?:my\s*)?cash\s*flow|cash\s*flow\s*(?:risk|issue|problem|gap|clarity|position)|money\s*(?:tied|stuck)\s*up|cash\s*conversion\s*(?:rate|cycle))\b/.test(t)) return "full_dashboard";
  if (/\b(financial\s*(?:pressure|stress|strain|health\s*check)|pressure\s*on\s*(?:the\s*)?business|calculate\s*(?:the\s*)?(?:financial\s*)?pressure)\b/.test(t)) return "full_dashboard";
  if (/\b(operational\s*(?:habit|stress|challenge|weakness|pattern|inefficien)|hidden\s*(?:inefficien|cost|loss|expense)|hurting\s*(?:the\s*)?business|identify\s*(?:hidden|inefficien)|signs?\s*of\s*(?:operational\s*)?(?:stress|decline|failure))\b/.test(t)) return "full_dashboard";
  if (/\b(duplicate\s*(?:entry|entries|transaction|record|inventory|expense)|detect\s*duplicate|recalculate\s*after|after\s*removing\s*duplicate)\b/.test(t)) return "full_dashboard";
  if (/\b(customer\s*lifetime\s*value|lifetime\s*value|\bclv\b|\bltv\b|customers?\s*(?:who\s*(?:owe|buy\s*regularly)|regularly\s*(?:buy|owe))|owe\s*too\s*much)\b/.test(t)) return "full_dashboard";
  if (/\b(personal\s*(?:money|expense[sd]?|fund[sd]?)\s*(?:for|into|in)\s*business|separate\s*(?:business\s*(?:and|from)|personal\s*expense)|used\s*personal\s*(?:money|fund))\b/.test(t)) return "full_dashboard";
  if (/\b(business\s*intelligence|intelligence\s*(?:review|dashboard|report)|ai\s*(?:operational|intelligence|review)|full\s*(?:ai|intelligence|operational)\s*review|operational\s*intelligence)\b/.test(t)) return "full_dashboard";
  if (/\bsales?\s*(?:increased|went\s*up|is\s*(?:up|high|good)|grew|growing|rising|improved)\b.{0,60}\bprofit\b|\bprofit\s*(?:still|feels?|seems?|looks?|is)\s*(?:low|down|less|small|reducing|dropping)\b/.test(t)) return "full_dashboard";
  if (/\b(strongest\s*(?:business\s*)?(?:advantage|strength|asset|area)|biggest\s*(?:business\s*)?advantage|explain\s*(?:my\s*)?(?:strongest|biggest|main|core)\s*(?:\w+\s+){0,2}(?:advantage|strength|risk|weakness))\b/.test(t)) return "full_dashboard";
  if (/\b(zuria\s*(?:notice|see|observe|find|detect)|what\s*(?:does\s*)?(?:zuria|the\s*ai)\s*(?:notice|see|think|suggest|observe)|patterns?\s*(?:about|in)\s*my\s*business)\b/.test(t)) return "full_dashboard";
  if (/\b(detect\s*(?:risky|risk|unusual\s*pattern|signs?\s*of)|risky\s*(?:pattern|behavior|trend|business\s*pattern))\b/.test(t)) return "full_dashboard";
  if (/\b(unstable|unpredictable|volatile)\s*(?:demand|sales?|pattern|movement)\b/.test(t)) return "full_dashboard";
  if (/\b(staff\s*(?:activity|habit|behavior|financially\s*risky|risk)|financially\s*risky\s*(?:staff|activity|behavior))\b/.test(t)) return "full_dashboard";
  if (/\b(sold?\s*(?:inventory|goods?|stock|items?)?\s*below\s*(?:normal|market|cost|normal\s*price)|below\s*normal\s*price|selling\s*at\s*(?:a\s*)?loss)\b/.test(t)) return "full_dashboard";
  if (/\b(revenue\s*growth\s*(?:vs|versus|against|outpac|compared)|did\s*revenue|outpac(?:e|ed|ing)|which\s*grew\s*faster)\b/.test(t)) return "full_dashboard";
  if (/\b(business\s*intelligence\s*dashboard|intelligence\s*dashboard|full\s*(?:business\s*)?dashboard|operational\s*(?:dashboard|intelligence\s*review))\b/.test(t)) return "full_dashboard";

  // Monthly report
  if (/\b(month(ly)?(\s*report)?|this\s*month|next\s*month|monthly\s*(summary|review|breakdown))\b/.test(t)) return "monthly_report";

  // Weekly report
  if (/\b(week(ly)?(\s*report)?|this\s*week|last\s*week|weekly\s*(summary|review|breakdown)|dis\s*week)\b/.test(t)) return "weekly_report";

  // Daily summary
  if (/\b(balance|bal|summary|summ|report|today|yesterday|how\s*much|profit|earn(ings)?|daily|overview|status|eod|end\s*of\s*day|sika|hwε\s*me|how\s*i\s*stand|how\s*e\s*dey|wetin\s*i\s*get|my\s*(cash|money)|tell\s*me)\b/.test(t)) return "summary";
  if (/\b(repeat\s*(?:last|previous|same)|same\s*(?:as\s*before|again)|do\s*(?:it\s*)?again)\b/.test(t)) return "summary";
  if (/\b(remind|send\s*(?:report\s*)?again)\b/.test(t)) return "summary";

  // Debts
  if (/\b(who\s*ow|owe\s*me|debts?|credit\s*list|my\s*debtors?|people\s*ow|ka\s*ho|me\s*nipa|credit|follow\s*up\s*debt|unpaid)\b/.test(t)) return "debts";
  if (/\b(debt\s*aging|aging\s*(?:analysis|report)|overdue\s*(?:debt|payment|balance)|long\s*overdue)\b/.test(t)) return "debts";
  if (/\b(risky\s*debtor|late\s*(?:payer|payments?)|slow\s*payer|delinquent|prioritize\s*debtor|delay(?:s|ed|ing)?\s*payments?|repeatedly\s*delay|show\s*customers?\s*who\s*(?:delay|repeat|late))\b/.test(t)) return "debts";

  // Loans / liabilities / creditors
  if (/\b(loans?|borrow(ings?)?|lending|my\s*loans?|i\s*owe|what\s*i\s*owe|me\s*ka|how\s*much\s*debt\s*(?:do\s*i|still))\b/.test(t)) return "loans";
  if (/\b(liabilit(?:y|ies)|total\s*liabilit|supplier\s*(?:debt|balance|owes?|owe)|owe\s*(?:supplier|creditor|vendor)|creditor\s*(?:balance|payment|list)?)\b/.test(t)) return "loans";
  if (/\b(demanding\s*payment|supplier\s*demanding|creditor\s*(?:call|demand|ask|want)|supplier\s*want\s*(?:money|payment))\b/.test(t)) return "loans";
  if (/\b(debt[\s-]to[\s-]cash|debt\s*ratio|total\s*(?:owed|liabilit)|my\s*total\s*debt)\b/.test(t)) return "loans";

  // Stock / inventory
  if (/\b(stock|inventory|goods|items|products|how\s*many|product\s*list|my\s*goods|nne[εe]ma|shelf|restock|low\s*stock|running\s*out|finish(?:ing)?\s*fast)\b/.test(t)) return "stock";
  if (/\b(warehouse|storage\s*(?:value|report)|getting\s*empty)\b/.test(t)) return "stock";
  if (/\b(expir(?:e|es|ing|y|ation|ed\s+stock)|best\s*before|sell\s*by|use\s*by|expiry\s*date|which\s*products?\s*expire)\b/.test(t)) return "stock";
  if (/\b(shortage|stockout|stock[\s-]?out|out\s*of\s*stock|days?\s*(?:to\s*)?stockout|stock\s*shortage)\b/.test(t)) return "stock";
  if (/\b(inventory\s*(?:value|worth|total)|warehouse\s*value|stock\s*(?:value|worth)|total\s*stock\s*value)\b/.test(t)) return "stock";
  if (/\b(dead\s*stock|stagnant\s*(?:stock|inventory)|not\s*(?:moving|selling)\s*(?:stock|item|product))\b/.test(t)) return "stock";
  if (/\b(stock\s*audit|inventory\s*audit|full\s*(?:stock|inventory)\s*(?:count|check|audit)|physical\s*count)\b/.test(t)) return "stock";

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

  // ── Emotional Intelligence — detect stress/panic/frustration early ────────
  // Runs on original text (pre-normalization preserves emotional signals best).
  // Result is passed to AI generator and used to enrich confirmations.
  const emotionalSignal = detectEmotionalState(text);

  const classified = classifyMessage(normalized, convCtx);
  // Pass the stored last normalized text so RULE 5 can detect duplicate webhook deliveries.
  const isolation  = enforceEngineIsolation(classified, convCtx, convCtx.lastNormalizedText, normalized);
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

  // Staged limit warning — declared here so it's available inside 4b and all engine branches.
  const stagedWarning = convCtx.pendingLimitNotification;

  // Helper: save context + update history in one call
  // Always passes the current normalized text for RULE 5 duplicate detection.
  // Pass pendingTransaction=null to explicitly clear any staged confirmation.
  const persist = async (
    reply: string,
    txnUpdate?: TxnContextUpdate,
    subUiShown = false,
    pendingTxn?: PendingTransactionContext | null,
  ): Promise<void> => {
    await saveWhatsAppContext(fromPhone, finalIntent, subUiShown, txnUpdate, undefined, normalized, pendingTxn);
    appendConversationHistory("whatsapp", fromPhone, text, reply, convCtx.conversationHistory);
  };

  // ── 4b. Pre-save confirmation flow ───────────────────────────────────────────
  // If the previous turn staged a low-confidence transaction awaiting user "yes",
  // intercept this message BEFORE normal classification.
  if (convCtx.activeFlow === "pending_confirmation" && convCtx.pendingTransaction) {
    const pending = convCtx.pendingTransaction;
    const affirmRE = /^(yes|yep|yeah|yh|confirm|ok|okay|sure|save|correct|right|ɛɛ|yoo|yes please|go ahead)$/i;
    const negateRE = /^(no|nope|nah|wrong|incorrect|cancel|stop|nevermind|never\s*mind|try again|redo)$/i;

    if (affirmRE.test(text.trim())) {
      // User confirmed — save the staged transaction
      try {
        const now   = new Date().toISOString();
        const txnId = createId("txn");
        const txn: Transaction = {
          id:                     txnId,
          businessId:             business.id,
          userId:                 user.id,
          rawText:                pending.originalText,        // ← original user words
          type:                   pending.type as Transaction["type"],
          amount:                 pending.amount,
          quantity:               pending.quantity,
          productName:            pending.productName,
          customerName:           pending.customerName,
          customerNameNormalized: pending.customerNameNormalized,
          paymentMethod:          pending.paymentMethod as Transaction["paymentMethod"],
          notes:                  pending.notes ?? "",
          category:               business.category,
          currency:               "GHS, Cedis",
          confidence:             pending.confidence,
          createdAt:              now,
          syncStatus:             "synced",
          source:                 "manual",
        };

        await saveTransaction(txn, fromPhone);

        const todayTxns = await getTodayTransactions(business.id);
        const moneyIn   = todayTxns.filter((t) => MONEY_IN_TYPES.includes(t.type)).reduce((a, t) => a + t.amount, 0);
        const moneyOut  = todayTxns.filter((t) => MONEY_OUT_TYPES.includes(t.type)).reduce((a, t) => a + t.amount, 0);
        // Build a minimal ParsedTransaction for zuriaConfirm — only the fields it reads
        const parsedForConfirm = {
          type:       pending.type as Transaction["type"],
          amount:     pending.amount,
          confidence: pending.confidence,
          customerName:  pending.customerName ?? undefined,
          productName:   pending.productName ?? undefined,
          notes:         pending.notes ?? undefined,
          quantity:      pending.quantity ?? undefined,
          paymentMethod: (pending.paymentMethod ?? undefined) as Transaction["paymentMethod"],
          category:      business.category,
          currency:      "GHS, Cedis" as const,
          syncStatus:    "synced" as const,
          customerNameNormalized: pending.customerNameNormalized ?? undefined,
        } as import("@/types/domain").ParsedTransaction;
        const confirm   = zuriaConfirm(
          parsedForConfirm,
          { in: moneyIn, out: moneyOut },
          business.category,
          bName,
        );
        const insight   = generateInsight({ dailyIn: moneyIn, dailyOut: moneyOut, businessCategory: business.category });
        const core      = [confirm, insight].filter(Boolean).join("\n\n");
        const fullReply = stagedWarning ? `${stagedWarning}\n\n${core}` : core;

        const txnDesc = `${pending.type} of ${formatMoney(pending.amount)}${pending.productName ? ` (${pending.productName})` : ""}`;
        // Clear pendingTransaction (null) and persist txnId for undo
        await persist(fullReply, { transactionId: txnId, transactionDesc: txnDesc }, false, null);
        return fullReply;
      } catch (err) {
        await logError("[handler] pending-confirmation save", err, { phone: fromPhone });
        return fmtSystemError();
      }
    }

    if (negateRE.test(text.trim())) {
      // User rejected — clear pending, ask them to rephrase
      await clearPendingTransaction("whatsapp", fromPhone, "none");
      const retryReplies = [
        "No problem. Tell me what happened and I'll record it correctly.",
        "Got it. Say it again and I'll get it right.",
        "Sure — just rephrase it and I'll try again.",
      ];
      const reply = retryReplies[Math.floor(Math.random() * retryReplies.length)]!;
      appendConversationHistory("whatsapp", fromPhone, text, reply, convCtx.conversationHistory);
      return reply;
    }

    // User sent something completely different — abandon the pending confirmation
    // and fall through to normal processing. The pending transaction is lost, but
    // that's better than recording something the user moved on from.
    await clearPendingTransaction("whatsapp", fromPhone, "none");
  }

  // ── 5. Payment claim — bypasses all gating ────────────────────────────────
  const paymentPlan = detectPaymentClaim(text);
  if (paymentPlan) {
    const annual = isAnnualPayment(text);
    const reply = await handlePaymentClaim(paymentPlan, user.id, user.ownerName, fromPhone, bName, annual, effectivePlan);
    await persist(reply, undefined, false, null);
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
      // Pass emotional tone so AI calibrates warmth appropriately
      emotionalTone:       emotionalSignal.state !== "neutral" ? emotionalSignal.state : undefined,
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
    if (convCtx.activeFlow === "undo_confirm" && lastId) {
      const affirmRE = /^(yes|yep|yeah|yh|confirm|do it|ok|okay|sure|remove|delete|void)$/i;
      if (affirmRE.test(text.trim())) {
        const result = await voidTransactionWithSideEffects(lastId);
        const reply = result.success
          ? zuriaUndoConfirmedWithEffects(
              lastDesc ?? "that entry",
              user.ownerName,
              result.hasDebtEffect,
              result.hasInventoryEffect,
              result.hasLoanEffect,
            )
          : zuriaUndoNothing(user.ownerName);
        // Reset context after undo — clear pendingTransaction too
        await saveWhatsAppContext(fromPhone, {
          ...finalIntent,
          intent: "UNDO",
          state: { ...finalIntent.state, active_flow: "none" },
        }, false, { transactionId: "", transactionDesc: "" }, undefined, normalized, null);
        appendConversationHistory("whatsapp", fromPhone, text, reply, convCtx.conversationHistory);
        return reply;
      }
    }

    // Show undo confirmation prompt — set active_flow = "undo_confirm" so the
    // next "yes" triggers the actual delete. "undo_confirm" is now a valid member
    // of the ConversationState["active_flow"] union (fixed in types.ts).
    const reply = zuriaUndoPrompt(lastDesc, user.ownerName);
    await saveWhatsAppContext(fromPhone, {
      ...finalIntent,
      state: { ...finalIntent.state, active_flow: "undo_confirm" },
    }, false, undefined, undefined, normalized);
    appendConversationHistory("whatsapp", fromPhone, text, reply, convCtx.conversationHistory);
    return reply;
  }

  // ── 8. Message-count gate — ONLY blocks new transaction recording ────────────
  //
  // Spec (ZURIA Free User Limit Failsafe):
  //   "When daily limits are reached, NEVER lock users out entirely."
  //   Still allow: subscribe, plans, upgrade, billing, support, referrals,
  //               viewing reports, exporting existing data.
  //
  // Therefore the gate ONLY fires for LEDGER_ENGINE (new AI transaction entries).
  // SUBSCRIPTION_ENGINE, LEDGER_QUERY_ENGINE, HELP_ENGINE, SMALLTALK, and UNDO
  // are handled before this gate or bypass it entirely.
  //
  if ((effectivePlan === "free" || effectivePlan === "growth") && finalIntent.intent === "LEDGER_ENGINE") {
    const limit = effectivePlan === "free" ? FREE_DAILY_LIMIT : GROWTH_MONTHLY_LIMIT;
    let usedCount = 0;
    try {
      usedCount = await getAndMaybeResetMessageCount(user, effectivePlan);
    } catch (err) {
      await logError("[handler] getAndMaybeResetMessageCount", err, { phone: fromPhone });
    }

    if (usedCount >= limit) {
      // Soft wall — show upgrade prompt but do NOT block reports/subscription commands
      return fmtSubscriptionRequired(limit, bName, referralLink, effectivePlan === "growth" ? "monthly" : "daily");
    }

    // Stage a limit warning for the NEXT response (never in this one)
    const suppressSubUi = finalIntent.state.subscription_ui_suppressed;
    if (!suppressSubUi) {
      const remaining = Math.max(0, limit - usedCount - 1); // -1 for this message
      const period = effectivePlan === "free" ? "today" : "this month";
      if (remaining <= 2 && remaining >= 0) {
        stageLimitNotification(
          "whatsapp", fromPhone,
          buildLimitWarning(remaining, limit, period, referralLink),
        ).catch(() => {});
      }
    }

    incrementMessageCount(user.id, effectivePlan).catch(() => {});
  }

  // ── 9. Staged limit warning ────────────────────────────────────────────────
  // (stagedWarning was declared above, alongside `persist`, so it's available
  // in all branches including the pending-confirmation intercept at step 4b.)

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
        monthlyReferrals, user as unknown as Record<string, unknown>, text
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
            rawText:    text,        // ← original user words, not normalized
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

    // No parse → AI clarification immediately
    if (!parsed) {
      const ai = getActiveProvider();
      const aiErr = await ai.generate({
        businessContext:     `${user.ownerName}, ${effectivePlan} plan, ${business.category}`,
        conversationHistory: historyToText(convCtx.conversationHistory),
        currentMessage:      text,
        financialContext:    "",
        emotionalTone:       emotionalSignal.state !== "neutral" ? emotionalSignal.state : undefined,
      });
      const reply = aiErr ?? zuriaError(business.category, bName);
      await persist(reply, undefined, false, null);
      return reply;
    }

    // ── Spec-mandated 4-tier Confidence Engine ────────────────────────────────
    // Compute ensemble confidence from parser output + multi-signal scoring.
    // Tiers: DETERMINISTIC_AUTO (≥90%), AI_ENHANCEMENT (75–89%),
    //        HUMAN_CLARIFICATION (50–74%), REJECT_UNSAFE (<50%)
    const { computeEnsembleConfidence } = await import("@/lib/confidence");
    const ensemble = computeEnsembleConfidence({
      parserConfidence: parsed.confidence,
      amount:           parsed.amount,
      rawText:          text,
      transactionType:  parsed.type,
      customerName:     parsed.customerName ?? null,
      productName:      parsed.productName ?? null,
    });

    // REJECT_UNSAFE (<50%): do not save, ask AI to clarify
    if (ensemble.shouldReject) {
      const ai = getActiveProvider();
      const aiErr = await ai.generate({
        businessContext:     `${user.ownerName}, ${effectivePlan} plan, ${business.category}`,
        conversationHistory: historyToText(convCtx.conversationHistory),
        currentMessage:      text,
        financialContext:    "",
        emotionalTone:       emotionalSignal.state !== "neutral" ? emotionalSignal.state : undefined,
      });
      const reply = aiErr ?? zuriaError(business.category, bName);
      await persist(reply, undefined, false, null);
      return reply;
    }

    // Negative amounts (e.g., "expense -50") — data-entry slip.
    // Silently convert to positive: the user almost certainly meant +50.
    if (parsed.amount < 0) {
      (parsed as { amount: number }).amount = Math.abs(parsed.amount);
    }

    // Amount is zero — route based on type
    if (parsed.amount <= 0) {
      // stock_purchase with a known quantity is intentionally amount=0
      // (user received stock but hasn't set a price yet) — let it fall through
      // to the save block so zuriaConfirm can display the qty-only confirmation.
      const isStockWithQty = parsed.type === "stock_purchase" && (parsed.quantity ?? 0) > 0;

      if (!isStockWithQty) {
        // For specific action types, the user omitted the amount — prompt for it.
        const AMOUNT_LABELS: Partial<Record<string, string>> = {
          salary:       "salary payment",
          expense:      "expense",
          sale:         "sale",
          debt_record:  "debt",
          debt_payment: "payment",
          loan_given:   "loan",
          loan_repaid:  "loan repayment",
          investment:   "investment",
          withdrawal:   "withdrawal",
          refund:       "refund",
        };
        const label = AMOUNT_LABELS[parsed.type];
        if (label) {
          const reply = zuriaAskAmount(label, parsed.customerName, parsed.productName);
          await persist(reply, undefined, false, null);
          return reply;
        }
        // Unknown type with no amount → AI clarification
        const ai = getActiveProvider();
        const aiErr = await ai.generate({
          businessContext:     `${user.ownerName}, ${effectivePlan} plan, ${business.category}`,
          conversationHistory: historyToText(convCtx.conversationHistory),
          currentMessage:      text,
          financialContext:    "",
        });
        const reply = aiErr ?? zuriaError(business.category, bName);
        await persist(reply, undefined, false, null);
        return reply;
      }
      // isStockWithQty — fall through to the save block with amount=0
    }

    // ── Pre-save confirmation for HUMAN_CLARIFICATION tier (50–74%) ──────────
    // Spec: 50–74% ensemble confidence → ask user to confirm before writing.
    // AI_ENHANCEMENT (75–89%) and DETERMINISTIC_AUTO (≥90%) proceed to save.
    if (ensemble.requiresHuman && !isDuplicate) {
      const confirmReq = zuriaConfirmationRequest(
        parsed.type, parsed.amount, parsed.customerName ?? null,
        parsed.productName ?? null, business.category,
      );
      const fullReply = stagedWarning ? `${stagedWarning}\n\n${confirmReq}` : confirmReq;

      // Stage the parsed transaction in context; set activeFlow = pending_confirmation
      const pending: PendingTransactionContext = {
        type:                   parsed.type,
        amount:                 parsed.amount,
        confidence:             parsed.confidence,
        customerName:           parsed.customerName ?? null,
        customerNameNormalized: parsed.customerNameNormalized ?? null,
        productName:            parsed.productName ?? null,
        notes:                  parsed.notes ?? null,
        quantity:               parsed.quantity ?? null,
        paymentMethod:          parsed.paymentMethod ?? null,
        normalizedText:         normalized,
        originalText:           text,
      };

      await stagePendingTransaction("whatsapp", fromPhone, pending);
      appendConversationHistory("whatsapp", fromPhone, text, fullReply, convCtx.conversationHistory);
      return fullReply;
    }

    try {
      const now = new Date().toISOString();
      const txnId = createId("txn");
      const txn: Transaction = {
        id:                     txnId,
        businessId:             business.id,
        userId:                 user.id,
        rawText:                text,           // ← original user words, not normalized
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
        // Emotional tone so AI calibrates warmth in the confirmation
        emotionalTone:       emotionalSignal.state !== "neutral" ? emotionalSignal.state : undefined,
      });

      const confirm = aiResp ?? zuriaConfirm(parsed, { in: moneyIn, out: moneyOut }, business.category, bName);
      // generateInsight always fires — not gated on AI fallback
      const insight = generateInsight({ dailyIn: moneyIn, dailyOut: moneyOut, businessCategory: business.category });
      // Append LIMITED INTELLIGENCE MODE notice if no AI provider is available
      const limitedModeNotice = (!aiResp && !isAIProviderAvailable()) ? fmtLimitedIntelligenceMode() : "";
      let core = [confirm, insight, limitedModeNotice].filter(Boolean).join("\n\n");

      // Emotional Intelligence: prepend business-grounded reassurance when user
      // signals stress / panic / frustration — uses today's known metrics.
      if (shouldAddEmotionalLayer(emotionalSignal.state)) {
        const reassurance = buildOperationalReassurance(emotionalSignal.state, {
          avgDailyRevenue: moneyIn,          // today's money-in as proxy
          totalDebt:       0,                // debt not loaded on this path — conservative default
          cashFlowPattern: moneyIn > moneyOut ? "growing" : moneyIn < moneyOut ? "declining" : "stable",
          riskLevel:       "low",            // conservative — no full risk score on this path
        });
        core = enrichResponseWithEmotion(core, emotionalSignal.state, reassurance);
      }

      const fullReply = stagedWarning ? `${stagedWarning}\n\n${core}` : core;

      const txnDesc = `${parsed.type} of ${formatMoney(parsed.amount)}${parsed.productName ? ` (${parsed.productName})` : ""}`;
      // Clear any stale pendingTransaction (null) when saving a new real transaction
      await persist(fullReply, isDuplicate ? undefined : { transactionId: txnId, transactionDesc: txnDesc }, false, null);
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

  interface PlanLink { plan: SubscriptionPlan; url: string; amountGHS: number; annual: boolean }
  const links: PlanLink[] = [];

  // Generate both monthly and annual links for each upgrade plan.
  // Annual = 2 months free. If annual price not set, use priceGHS * 10.
  const billingVariants: Array<{ annual: boolean }> = [
    { annual: false },
    { annual: true },
  ];

  for (const p of upgradePlans) {
    for (const { annual } of billingVariants) {
      const tier      = SUBSCRIPTION_TIERS[p];
      const amountGHS = annual ? (tier.annualPriceGHS ?? tier.priceGHS * 10) : tier.priceGHS;
      const reference = makeRef();
      const callbackUrl = `${APP_URL}/subscription/callback?ref=${reference}`;

      try {
        const result = await initializePayment({
          email,
          amountGHS,
          reference,
          callbackUrl,
          metadata: { userId, phone, ownerName, plan: p, annual, amountGHS },
          label: ownerName || "ZURIA Customer",
        });

        if (!result.error && result.authorizationUrl) {
          // Persist pending payment + PAYMENT_INITIATED ledger entry atomically.
          const createdAt = new Date().toISOString();
          const paymentDoc: PaystackPayment = {
            id:               reference,
            reference,
            userId,
            phone,
            plan:             p,
            annual,
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
            annual,
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

          links.push({ plan: p, url: result.authorizationUrl, amountGHS, annual });
        }
      } catch {
        // Ignore individual plan/billing errors — we'll show what we can
      }
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
    `Tap a link below to pay — opens Paystack's secure checkout.`,
    `Pay with *MoMo* (any network), *bank card*, or *bank transfer*.`,
    `Your plan activates *instantly* the moment payment is confirmed. ✅`,
    ``,
  ];

  // Group links by plan, showing monthly then annual
  const plansSeen = new Set<SubscriptionPlan>();
  for (const { plan: p, url, amountGHS, annual } of links) {
    if (!plansSeen.has(p)) {
      lines.push(`*${planLabels[p]}*`);
      plansSeen.add(p);
    }
    if (annual) {
      lines.push(`  📅 Annual — GHS ${amountGHS}/year _(2 months free!)_`, `  ${url}`, ``);
    } else {
      lines.push(`  📆 Monthly — GHS ${amountGHS}/month`, `  ${url}`, ``);
    }
  }

  lines.push(
    `_Links expire in 30 minutes. Reply *"subscribe"* for fresh ones._`,
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
  annual = false,
  currentPlan: SubscriptionPlan = "free",
): Promise<string> {
  const firstName = ownerName.split(" ")[0];

  // ── Guard: user is already on this plan or a higher one ─────────────────────
  // Plan hierarchy: free < growth < pro < enterprise
  const PLAN_RANK: Record<SubscriptionPlan, number> = { free: 0, growth: 1, pro: 2, enterprise: 3 };
  if (PLAN_RANK[currentPlan] >= PLAN_RANK[plan]) {
    return [
      `✅ *${firstName}, you're already on ${currentPlan === plan ? `*${currentPlan}*` : `*${currentPlan}* (which includes everything in *${plan}*)`}!*`,
      ``,
      `Your plan is active — open the ZURIA app to confirm.`,
      `Reply *"help"* to see what you can do, or *"subscribe"* to upgrade further.`,
      ``,
      `_— ZURIA (${businessName})_`,
    ].join("\n");
  }

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
    `We've noted your *MoMo payment* notification for:`,
    `*${planLabel}${durationNote}* — ${price}`,
    ``,
    `📋 _Reference: ${claimId}_`,
    ``,
    `*What happens next:*`,
    `Our team will verify your MoMo payment and activate your plan within *1 hour*. 😊`,
    ``,
    `⚡ *Already paid via the Paystack link?*`,
    `Your plan activates *instantly* — no need to send this message.`,
    `Open the ZURIA app to confirm it's active. If it isn't, contact support below.`,
    ``,
    `💡 _Tip: Reply *"subscribe"* to always get a direct Paystack link — instant activation, no waiting._`,
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
  user?: Record<string, unknown>,
  rawText = "",
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
    if (!canFull) {
      // Growth/Free users get an AI-powered advisory + coaching tip + soft Pro upsell
      // instead of a hard gate. They still receive real business insight — just not
      // the full AI dashboard (forecasts, customer rankings, risk alerts, etc.).
      try {
        const [weekTxns, openDebts] = await Promise.all([
          getWeekTransactions(businessId),
          getOpenDebts(businessId),
        ]);
        const weekIn  = weekTxns.filter((t) => MONEY_IN_TYPES.includes(t.type)).reduce((a, t) => a + t.amount, 0);
        const weekOut = weekTxns.filter((t) => MONEY_OUT_TYPES.includes(t.type)).reduce((a, t) => a + t.amount, 0);
        const openDebtTotal = openDebts.reduce((acc, d) => acc + (d.outstandingAmount > 0 ? d.outstandingAmount : 0), 0);

        const financialContext = [
          `This week: revenue GHS ${weekIn.toFixed(2)}, expenses GHS ${weekOut.toFixed(2)}, net GHS ${(weekIn - weekOut).toFixed(2)}.`,
          openDebtTotal > 0 ? `Open debts owed to you: GHS ${openDebtTotal.toFixed(2)}.` : "",
        ].filter(Boolean).join(" ");

        const topic = detectCoachingTopic(rawText);
        const coachTip = zuriaCoach(topic);

        const ai = getActiveProvider();
        const aiReply = await ai.generate({
          businessContext:     `${ownerName}, ${plan} plan, ${category} business`,
          conversationHistory: "",
          currentMessage:      rawText || `Give me business advice for my ${category} business`,
          financialContext,
        });

        const parts: string[] = [];
        if (aiReply) parts.push(aiReply);
        if (coachTip) parts.push(`\n💡 *Quick coaching tip:*\n${coachTip}`);
        parts.push(
          `\n🔒 _For your full AI dashboard — forecasts, customer rankings, risk alerts, and more — upgrade to *ZURIA Pro*. Reply *"subscribe"* to see plans._`,
        );
        return parts.join("\n");
      } catch {
        // Fallback to gate message if advisory generation fails
        return gateMsg("full dashboard", "ZURIA Pro", "pro", businessName);
      }
    }
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

    // Use voidTransactionWithSideEffects to reverse debt/inventory/loan side effects
    const result = await voidTransactionWithSideEffects(lastTxn.id);

    const effectNotes: string[] = [];
    if (result.hasDebtEffect)      effectNotes.push("_The related debt balance has been reversed._");
    if (result.hasInventoryEffect) effectNotes.push("_The stock count has been corrected._");
    if (result.hasLoanEffect)      effectNotes.push("_The loan balance has been reversed._");
    const sideEffectNote = effectNotes.length > 0 ? `\n\n${effectNotes.join("\n")}` : "";

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

// ─── Coaching topic detector ──────────────────────────────────────────────────

/**
 * Infer the most relevant coaching topic from the user's raw query text.
 * Used when serving advisory responses to Growth/Free users who ask
 * full_dashboard questions — selects the right zuriaCoach() tip category.
 */
function detectCoachingTopic(text: string): CoachingTopic {
  const t = text.toLowerCase();
  if (/cash\s*flow|liquidity|tight|cash\s*leakage|money\s*stuck|tied\s*up/.test(t))      return "cash_flow";
  if (/debt|owe|credit|collect|outstanding|debtor|disappear/.test(t))                    return "debt_management";
  if (/price|margin|profit|markup|pricing|undercharge/.test(t))                          return "pricing";
  if (/stock|inventory|restock|reorder|warehouse|expir|running\s*out/.test(t))           return "inventory";
  if (/staff|salary|payroll|worker|employee|hire|resign|absent|morale/.test(t))          return "staff_management";
  if (/fraud|steal|alter|suspicious|leakage|unauthorized|someone\s*took/.test(t))        return "risk_fraud";
  if (/expense|cost|transport|utility|bill|spending|overhead|running\s*cost/.test(t))    return "expense_control";
  if (/revenue|sales.*drop|customer.*slow|grow|expand|acquisition|marketing/.test(t))    return "revenue_growth";
  if (/forecast|predict|plan|next\s*month|target|budget|seasonal/.test(t))              return "planning";
  return "general";
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
