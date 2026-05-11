import { parseTransaction } from "@/lib/parsers/transaction-parser";
import { createId } from "@/lib/utils";
import {
  fmtConfirm,
  fmtDebts,
  fmtHelp,
  fmtLoans,
  fmtNotFound,
  fmtStock,
  fmtSummary,
  fmtSystemError,
  fmtUnregistered,
} from "@/lib/whatsapp/formatter";
import {
  getAllTransactions,
  getInventory,
  getLoans,
  getOpenDebts,
  getTodayTransactions,
  getUserByPhone,
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
import { MONEY_IN_TYPES, MONEY_OUT_TYPES } from "@/types/domain";
import type { BusinessCategory, Transaction } from "@/types/domain";

// ─── Intent detection ─────────────────────────────────────────────────────────

type QueryIntent = "summary" | "debts" | "loans" | "stock" | "help";

function detectIntent(text: string): QueryIntent | null {
  const t = text.toLowerCase().trim();
  if (/\b(help|commands|what can|how to use|guide|start|tutorial)\b/.test(t)) return "help";
  if (/\b(balance|summary|report|today|how much|profit|earnings|daily|overview|status|check)\b/.test(t)) return "summary";
  if (/\b(who ow|owe me|debts?|credit list|my debtors|people ow)\b/.test(t)) return "debts";
  if (/\b(loans?|borrow|lending|my loans|i.*owe)\b/.test(t)) return "loans";
  if (/\b(stock|inventory|goods|items|products|how many|product list)\b/.test(t)) return "stock";
  return null;
}

// 4 digits only → PIN attempt
function looksLikePin(text: string): boolean {
  return /^\d{4}$/.test(text.trim());
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

  // ── Query intent ────────────────────────────────────────────────────────
  const intent = detectIntent(text);
  if (intent) {
    try {
      return await handleQuery(intent, business.id, user.ownerName, business.category, bName);
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
      return fmtConfirm(parsed, { in: moneyIn, out: moneyOut }, business.category, bName);
    } catch (err) {
      await logError("[handler] saveTransaction", err, { phone: fromPhone });
      return fmtSystemError();
    }
  }

  if (parsed.amount === 0 && /\b(money|cash|how|what|balance|total|sales|profit)\b/i.test(text)) {
    try {
      return await handleQuery("summary", business.id, user.ownerName, business.category, bName);
    } catch (err) {
      await logError("[handler] summary fallback", err, { phone: fromPhone });
      return fmtSystemError();
    }
  }

  return fmtNotFound(business.category, bName);
}

// ─── Query handlers ───────────────────────────────────────────────────────────

async function handleQuery(
  intent: QueryIntent,
  businessId: string,
  ownerName: string,
  category: BusinessCategory,
  businessName: string
): Promise<string> {
  switch (intent) {
    case "summary": {
      const txns = await getAllTransactions(businessId, 200);
      return fmtSummary(txns, ownerName, category, businessName);
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
      return fmtHelp(ownerName, category, businessName);
  }
}
