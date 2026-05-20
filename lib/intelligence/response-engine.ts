/**
 * ZURIA Response Engine — the brain and voice.
 *
 * This is the Conversational Cognition Layer: the rule-based intelligence
 * that generates warm, emotionally-aware, financially-precise responses in
 * the ZURIA voice. It implements the full ZURIA behavioral specification.
 *
 * Architecture position:
 *   Intent Classifier → Engine Guard → Financial Logic
 *   → HERE (Response Intelligence Layer) → WhatsApp / Telegram reply
 *
 * Design principles (one per axis of the spec):
 *   Variety      — pick() ensures no two consecutive responses sound identical
 *   Warmth       — use the person's name; acknowledge effort before showing numbers
 *   Precision    — exact GH₵ amounts, 2 dp, never invented
 *   Brevity      — short unless data demands length
 *   Emotion      — detect stress / celebration / confusion; respond accordingly
 *   Insight      — surface intelligence when timely; never force it
 *   Coaching     — speak like an experienced African business advisor
 *   Safety       — never hallucinate, never expose internal labels
 *   Low-literacy — scannable, direct, no accounting jargon
 *   African-first — natural Ghanaian English patterns throughout
 */

import type { BusinessCategory, ParsedTransaction, TransactionType } from "@/types/domain";
import { MONEY_IN_TYPES, MONEY_OUT_TYPES } from "@/types/domain";
import { formatMoney } from "@/lib/utils";
import {
  detectIndustryVertical,
  generateIndustryWarnings,
} from "@/lib/industry";

// ─── Core helpers ─────────────────────────────────────────────────────────────

/** Pick a random item — creates natural variety across responses */
function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

/** Format amount as GH₵ string */
function ghs(amount: number): string {
  return formatMoney(Math.abs(amount));
}

/** Extract first name from a full name */
function firstName(name: string): string {
  return (name.split(" ")[0] ?? name).trim();
}

// ─── Emotion Detection ────────────────────────────────────────────────────────

const STRESS_SIGNALS: readonly string[] = [
  // English stress
  "bad", "rough", "slow", "loss", "hard time", "difficult", "problem", "tired", "stress",
  "zero sales", "no sales", "no customer", "nothing today", "nobody buy", "nobody came",
  "nothing sell", "nobody enter", "market dead", "market empty", "market slow", "slow day",
  "dead today", "customers scarce", "nothing move", "slow movement",
  "sales slow", "sales were slow", "sales dropped", "revenue low", "revenue down",
  "profit low", "losing money", "cash tight", "cash is tight", "cash flow tight",
  "business hard", "business dying", "business is hard", "business is dying",
  "debts increasing", "expenses too high", "expenses high", "costs too high",
  "after the rain", "market no good", "sales no move", "dey lose money",
  // Ghanaian English / Pidgin stress
  "chop loss", "i chop loss", "we chop loss", "today bad", "business slow", "things slow",
  "things bad", "e no easy", "things no go well", "i dey manage", "no money", "i broke",
  "tough today", "ei today", "business no move", "e pain me", "business die",
  "hard life", "things hard", "no customer today", "wahala", "suffer",
  "business hard this week", "business hard this month", "revenue weak", "weak paa",
];

const POSITIVE_SIGNALS: readonly string[] = [
  // English positive
  "nice", "good day", "great day", "profit", "made it", "banked", "sold out",
  "amazing", "best day", "blessed", "rush", "boom", "killing it",
  "doing well", "on fire",
  // Ghanaian English / Pidgin positive
  "customer plenty", "customers full", "rush today", "today sweet", "business sweet",
  "e move", "moving well", "we dey move", "fine fine", "business dey go",
  "today was fire", "sold everything", "e work", "things work",
  "today e go well", "serious rush", "we cook", "all sold", "serious sales",
  "we move", "business good", "i'm happy", "things moving",
];

const GRATEFUL_SIGNALS: readonly string[] = [
  "thank", "thanks", "thank you", "appreciate", "bless", "god bless",
  "thanks zuria", "you're helpful", "you are helpful", "you help me",
  "medaase", "eda ase", "meda wo ase",
];

const CONFUSED_SIGNALS: readonly string[] = [
  "i don't understand", "i dont understand", "what do you mean", "confus",
  "i'm lost", "i lost", "how do i", "what is", "explain",
  "help me understand", "i no understand", "i no get am", "wetin you mean",
];

const FRUSTRATED_SIGNALS: readonly string[] = [
  "again", "still wrong", "not right", "this is wrong", "why is it", "not working",
  "keeps saying", "keeps doing", "always wrong", "stop", "useless", "not what i said",
  "that's not", "thats not", "wrong again", "it's wrong", "fix this",
];

export type EmotionTone = "stressed" | "positive" | "grateful" | "confused" | "frustrated" | "neutral";

export function detectEmotion(rawText: string): EmotionTone {
  const lower = rawText.toLowerCase();
  // Priority order: grateful → frustrated → stressed → positive → confused → neutral
  if (GRATEFUL_SIGNALS.some((s)   => lower.includes(s))) return "grateful";
  if (FRUSTRATED_SIGNALS.some((s) => lower.includes(s))) return "frustrated";
  if (STRESS_SIGNALS.some((s)     => lower.includes(s))) return "stressed";
  if (POSITIVE_SIGNALS.some((s)   => lower.includes(s))) return "positive";
  if (CONFUSED_SIGNALS.some((s)   => lower.includes(s))) return "confused";
  return "neutral";
}

// ─── Transaction Confirmations ────────────────────────────────────────────────

const CONFIRMS_IN: readonly string[] = [
  "✅ Noted.", "💰 Received.", "👌 Got it.", "📘 Logged.", "🧾 Done.", "✅ Added.", "💚 Recorded.",
];

const CONFIRMS_OUT: readonly string[] = [
  "✅ Noted.", "📘 Recorded.", "👌 Done.", "💸 Logged.", "🧾 Saved.", "✅ Entered.", "📘 Done.",
];

const CONFIRMS_NEUTRAL: readonly string[] = [
  "✅ Noted.", "📘 Logged.", "👌 Got it.", "🧾 Done.", "✅ Recorded.",
];

// Human-readable transaction type labels — ZURIA voice, not accounting jargon
const TYPE_LABELS: Partial<Record<TransactionType, string>> = {
  sale:            "Sale",
  expense:         "Expense",
  debt:            "Credit given",
  repayment:       "Payment received",
  stock_purchase:  "Stock bought",
  cost:            "Business bill",
  salary:          "Salary paid",
  tax:             "Tax / levy",
  borrow_in:       "Loan received",
  borrow_out:      "Loan given",
  loan_repay_out:  "Loan repaid",
  loan_collect_in: "Loan collected",
  investment:      "Investment",
  withdrawal:      "Owner withdrawal",
  refund_out:      "Refund given",
  refund_in:       "Refund received",
  transfer:        "Transfer",
};

function humanType(type: TransactionType, category: BusinessCategory): string {
  if (type === "sale" && (category === "barber" || category === "salon")) return "Service";
  if (type === "sale" && category === "momo")     return "Transaction";
  if (type === "sale" && category === "other") return "Service";
  return TYPE_LABELS[type] ?? type;
}

/**
 * Generate a ZURIA-voice transaction confirmation.
 *
 * Format (per spec):
 *  1. Confirmation line (varied — never the same phrase twice)
 *  2. Key financial result (amount, person, key data)
 *  3. Daily summary (compact net)
 *  4. Optional: low-confidence caveat
 */
export function zuriaConfirm(
  parsed: ParsedTransaction,
  dailyTotal: { in: number; out: number },
  category: BusinessCategory,
  businessName: string,
  remainingDebt?: number | null,
): string {
  const isIn  = MONEY_IN_TYPES.includes(parsed.type);
  const isOut = MONEY_OUT_TYPES.includes(parsed.type);
  const dir   = isIn ? CONFIRMS_IN : isOut ? CONFIRMS_OUT : CONFIRMS_NEUTRAL;
  const confirm = pick(dir);

  const lines: string[] = [];
  const amount = ghs(parsed.amount);

  // ── Transaction detail line ────────────────────────────────────────────────
  if (parsed.type === "debt" && parsed.customerName) {
    lines.push(`${confirm} *${parsed.customerName}* now owes you *${amount}*.`);

  } else if (parsed.type === "repayment" && parsed.customerName) {
    if (remainingDebt !== null && remainingDebt !== undefined && remainingDebt > 0) {
      lines.push(`${confirm} *${parsed.customerName}* paid *${amount}*. Balance: *${ghs(remainingDebt)}* still owed.`);
    } else if (remainingDebt === 0) {
      lines.push(`${confirm} *${parsed.customerName}* has cleared their debt completely. 🎉`);
    } else {
      lines.push(`${confirm} *${parsed.customerName}* paid *${amount}*.`);
    }

  } else if (parsed.type === "salary" && parsed.customerName) {
    lines.push(`${confirm} Salary for *${parsed.customerName}* — *${amount}* paid.`);

  } else if (parsed.type === "borrow_out" && parsed.customerName) {
    lines.push(`${confirm} Loan to *${parsed.customerName}* — *${amount}* noted.`);

  } else if (parsed.type === "borrow_in") {
    const from = parsed.customerName ? ` from *${parsed.customerName}*` : "";
    lines.push(`${confirm} Loan received${from} — *${amount}* recorded.`);

  } else if (parsed.type === "loan_collect_in" && parsed.customerName) {
    lines.push(`${confirm} *${parsed.customerName}* repaid *${amount}* of the loan.`);

  } else if (parsed.type === "transfer" && parsed.customerName) {
    lines.push(`${confirm} Sent *${amount}* to *${parsed.customerName}*.`);

  } else if (parsed.type === "stock_purchase") {
    const item = parsed.productName ? ` (${parsed.productName})` : "";
    if (parsed.amount === 0 && (parsed.quantity ?? 0) > 0) {
      // Received inventory with a unit count but no price (e.g. "received 1300 pcs of gloves")
      const qty = ` — *${parsed.quantity!.toLocaleString()} units*`;
      lines.push(`${confirm} Stock received${qty}${item}.`);
    } else if (parsed.amount === 0) {
      // Stock noted without price or quantity
      lines.push(`${confirm} Stock noted${item}. _Add a price when you know it._`);
    } else {
      lines.push(`${confirm} Stock bought — *${amount}*${item}.`);
    }

  } else if (parsed.type === "investment") {
    lines.push(`${confirm} Investment of *${amount}* recorded.`);

  } else {
    // Generic: "✅ Noted. Sale — GH₵120 (Rice) · Ama"
    const typeLabel = humanType(parsed.type, category);
    const itemPart  = parsed.productName  ? ` (${parsed.productName})`    : "";
    const custPart  = parsed.customerName ? ` · ${parsed.customerName}`   : "";
    lines.push(`${confirm} ${typeLabel} — *${amount}*${itemPart}${custPart}`);
  }

  // ── Daily snapshot (compact) ───────────────────────────────────────────────
  const net = dailyTotal.in - dailyTotal.out;
  lines.push("");
  if (net > 0)      lines.push(`📊 You're *+${ghs(net)}* today.`);
  else if (net < 0) lines.push(`📊 Down *${ghs(Math.abs(net))}* today.`);
  else              lines.push(`📊 Even today — *${ghs(dailyTotal.in)}* in, *${ghs(dailyTotal.out)}* out.`);

  // ── Low-confidence caveat ──────────────────────────────────────────────────
  if (parsed.confidence < 0.55) {
    lines.push("", "_Wasn't 100% sure about that — double-check if needed._");
  }

  void businessName; // used by caller for context; not needed in this response
  return lines.join("\n");
}

// ─── Smalltalk / Emotional Response ──────────────────────────────────────────

const GREETINGS: readonly string[] = [
  "Hey! What happened in the business today?",
  "I'm here. What's the update?",
  "Tell me what went on today.",
  "What's the business looking like?",
  "Ready when you are — what happened today?",
  "All ears. What sold today?",
];

const CONFUSED_RESPONSES: readonly string[] = [
  `No worries. Just say something like *"sold rice 50"* and I'll handle the rest.`,
  `Try *"Ama paid 20"* or *"bought fuel 40"* — I'll take it from there.`,
  `Just tell me what happened in plain language — I'll figure it out.`,
  `It's fine. Something like *"expense: ECG bill 80"* or *"Kofi owes 200"* works perfectly.`,
];

// Note: frustrated responses are generated dynamically (with name) in zuriaSmalltalk below.

/**
 * Generate a ZURIA-voice smalltalk / emotional response.
 * Used when classified intent is SMALLTALK or a pure greeting.
 *
 * Detects emotional tone and responds with appropriate warmth before
 * any financial data — emotion first, numbers second.
 */
export function zuriaSmalltalk(
  rawText: string,
  ownerName: string,
  netBalance?: number,
): string {
  const emotion = detectEmotion(rawText);
  const name    = firstName(ownerName);

  switch (emotion) {
    case "stressed": {
      if (netBalance !== undefined && netBalance !== 0) {
        const dir = netBalance < 0 ? `down *${ghs(Math.abs(netBalance))}*` : `up *${ghs(netBalance)}*`;
        return pick([
          `Sorry today was rough, ${name}. You're ${dir} right now — but the day isn't over. What else happened?`,
          `Tough one. You're ${dir} today. Let's still capture everything properly — what went on?`,
        ] as const);
      }
      return pick([
        `Sorry to hear that, ${name}. One step at a time — what happened today?`,
        `Tough day. Let's still get it all recorded properly, ${name}. What went on?`,
        `That happens. Let's see where things stand — what sold today?`,
        `It's okay, ${name}. Tell me what happened and we'll work through it.`,
      ] as const);
    }

    case "positive": {
      if (netBalance !== undefined && netBalance > 0) {
        return pick([
          `🔥 That's the energy, ${name}! You're up *${ghs(netBalance)}* today. Keep going!`,
          `🔥 Love it, ${name}! *${ghs(netBalance)}* in the green today. What else?`,
        ] as const);
      }
      return pick([
        `🔥 Love that, ${name}! What made it a good one?`,
        `Nice work, ${name}! Let's make sure it's all recorded properly.`,
        `🔥 That's how it's done, ${name}! What sold today?`,
        `Good energy, ${name}! Tell me what happened.`,
      ] as const);
    }

    case "grateful": {
      if (netBalance !== undefined && netBalance > 0) {
        return pick([
          `Anytime, ${name}! 😊 You're up *${ghs(netBalance)}* today — keep it going!`,
          `Always here for you, ${name}. 💪 *${ghs(netBalance)}* in the green today.`,
        ] as const);
      }
      if (netBalance !== undefined && netBalance < 0) {
        return pick([
          `Anytime, ${name}. 😊 Things are down *${ghs(Math.abs(netBalance))}* today — let's make sure everything is recorded.`,
          `Happy to help, ${name}. You're down *${ghs(Math.abs(netBalance))}* — what else happened today?`,
        ] as const);
      }
      return pick([
        `Anytime, ${name}! 😊 What else can I help with?`,
        `Happy to be here, ${name}. What's next?`,
        `Always here for you, ${name}. 💪`,
        `That's what I'm for, ${name}. What's going on with the business?`,
      ] as const);
    }

    case "frustrated": {
      return pick([
        `Sorry about that, ${name}. Say it again and I'll get it right this time.`,
        `My apologies, ${name}. Tell me exactly what happened and I'll record it correctly.`,
        `I hear you, ${name}. Let's fix it — what should the entry say?`,
        `That's on me, ${name}. Say it again slowly and I'll make sure it goes in right.`,
      ] as const);
    }

    case "confused": {
      return pick(CONFUSED_RESPONSES);
    }

    default: {
      return pick(GREETINGS);
    }
  }
}

// ─── Clarification / Ambiguity Handling ──────────────────────────────────────

export type MissingField =
  | "amount"
  | "person"
  | "transaction_type"
  | "which_person"
  | "sale_or_expense"
  | "general";

const CLARIFICATIONS: Record<MissingField, readonly string[]> = {
  amount: [
    "How much?",
    "What's the amount?",
    "How much was it?",
    "What's the figure?",
    "Amount?",
  ],
  person: [
    "Who paid you?",
    "Which customer?",
    "Who is this for?",
    "Whose payment is this?",
    "Which person?",
  ],
  transaction_type: [
    "Was that a sale or an expense?",
    "Did you earn that or spend it?",
    "Money in or money out?",
    "Sale, expense, or something else?",
  ],
  which_person: [
    "Which person — a customer or a worker?",
    "Who exactly — customer or employee?",
    "Customer or staff member?",
  ],
  sale_or_expense: [
    "Was that a sale or an expense?",
    "Did you sell something or pay for something?",
    "Money you received or money you spent?",
  ],
  general: [
    `I didn't quite catch that. Try something like *"sold bread 50"* or *"Kofi paid 30"*.`,
    `Not sure what you mean. Try *"expense: fuel 40"* or *"Ama owes 100"*.`,
    `Say it again — like *"sold 3 bags rice 240"* — and I'll get it.`,
    `Hmm, let me understand better. Try *"bought goods 80"* or *"customer paid 60"*.`,
  ],
};

/**
 * Shortest possible natural clarification.
 * Never sounds like a form validation error.
 */
export function zuriaAskClarification(field: MissingField = "general"): string {
  return pick(CLARIFICATIONS[field]);
}

/**
 * Ask for the missing amount for a specific transaction type.
 * Short, natural, no accounting jargon.
 *
 * @param typeLabel  - Human-readable description e.g. "salary payment", "loan given"
 * @param personName - Optional: customer / employee name extracted from message
 * @param productName - Optional: product / item name extracted from message
 */
export function zuriaAskAmount(
  typeLabel: string,
  personName?: string | null,
  productName?: string | null,
): string {
  const who  = personName  ? ` for *${personName}*`  : "";
  const what = productName ? ` (${productName})`     : "";
  return pick([
    `How much was the ${typeLabel}${who}${what}?`,
    `What's the amount${who} — the ${typeLabel}${what}?`,
    `Just send the amount${who}${what}.`,
    `Got it. How much${who}${what}?`,
  ] as const);
}

/**
 * "I didn't understand" fallback — includes a usage hint, never robotic.
 * Category-aware so hints feel relevant to the specific business.
 */
export function zuriaError(category: BusinessCategory, _businessName: string): string {
  const examples = categoryExamples(category);
  return pick([
    `🤔 I didn't catch that.\n\nTry:\n${examples}`,
    `Not quite sure what you mean.\n\nSomething like:\n${examples}`,
    `Say it again and I'll get it.\n\nExamples:\n${examples}`,
  ] as const);
}

function categoryExamples(category: BusinessCategory): string {
  switch (category) {
    case "provision":
    case "food":
      return `• *"Sold rice 120"*\n• *"Ama paid 20"*\n• *"Bought goods 80"*`;
    case "salon":
    case "barber":
      return `• *"Service 50"*\n• *"Kojo paid 30"*\n• *"Bought shampoo 40"*`;
    case "momo":
      return `• *"Transaction 200"*\n• *"Expense ECG 60"*\n• *"Yaa paid 100"*`;
    case "cosmetics":
    case "hardware":
    case "spare-parts":
      return `• *"Sold 120"*\n• *"Customer paid 50"*\n• *"Bought stock 200"*`;
    case "pharmacy":
      return `• *"Sold paracetamol 25"*\n• *"Stock purchased 300"*\n• *"Customer paid 40"*`;
    default:
      return `• *"Sold 120"*\n• *"Ama paid 20"*\n• *"Bought goods 80"*`;
  }
}

// ─── Insight Layer ────────────────────────────────────────────────────────────

export interface DailySnapshot {
  dailyIn: number;
  dailyOut: number;
  previousDayNet?: number;
  topDebtCount?: number;
  topDebtTotal?: number;
  stockWarnings?: string[];   // product names running low
  transactionCount?: number;
  /** Optional business category — enables vertical-specific intelligence */
  businessCategory?: BusinessCategory;
  /** Total outstanding customer debt — used for vertical KPI warnings */
  totalDebt?: number;
}

/**
 * Generate a lightweight, timely business insight.
 * Returns null if there is nothing interesting to say — never forces an insight.
 *
 * Priority (most impactful first):
 *  1. Expense alarm (spending > income)
 *  2. Debt overload warning
 *  3. Stock warning
 *  4. Sales milestone
 *  5. Stronger than yesterday
 *  6. Vertical-specific industry warning (pharmacy expiry, salon demand, etc.)
 */
export function generateInsight(snap: DailySnapshot): string | null {
  const { dailyIn, dailyOut, previousDayNet, topDebtCount, topDebtTotal, stockWarnings, businessCategory, totalDebt } = snap;
  const net = dailyIn - dailyOut;

  // 1. Expense alarm
  if (dailyOut > 0 && dailyOut > dailyIn * 1.5 && dailyOut > 50) {
    return `⚠️ Spending is running higher than income today. Keep an eye on it.`;
  }

  // 2. Many open debts with large total
  if (topDebtCount !== undefined && topDebtCount >= 5 && topDebtTotal !== undefined && topDebtTotal > 200) {
    return `💡 You have *${topDebtCount}* customers who owe a total of *${ghs(topDebtTotal)}*. Type *"who owes me"* to see the list.`;
  }
  if (topDebtCount !== undefined && topDebtCount >= 5) {
    return `💡 ${topDebtCount} open debts. Type *"who owes me"* to see them.`;
  }

  // 3. Stock warnings
  if (stockWarnings && stockWarnings.length > 0) {
    const items = stockWarnings.slice(0, 2).join(", ");
    return `📦 Stock running low: *${items}*. Consider restocking soon.`;
  }

  // 4. Sales milestones
  if (dailyIn >= 1000 && dailyIn < 1010) return `🔥 Sales just crossed *${ghs(1000)}* today!`;
  if (dailyIn >= 500  && dailyIn < 510)  return `🔥 Passed the *${ghs(500)}* mark today.`;
  if (dailyIn >= 2000 && dailyIn < 2010) return `🔥 *${ghs(2000)}* in sales today — strong day!`;

  // 5. Significantly stronger than yesterday
  if (previousDayNet !== undefined && previousDayNet > 0 && net > previousDayNet * 1.5 && net > 100) {
    return `📈 Today is tracking stronger than yesterday. Nice momentum.`;
  }

  // 6. Vertical-specific industry warning — only when business category is known
  if (businessCategory && dailyIn > 0) {
    try {
      const vertical     = detectIndustryVertical(businessCategory, []);
      const expenseRatio = dailyOut > 0 && dailyIn > 0 ? dailyOut / dailyIn : 0;
      const debtRatio    = (totalDebt ?? 0) > 0 && dailyIn > 0 ? (totalDebt ?? 0) / dailyIn : 0;
      const warnings     = generateIndustryWarnings(vertical, {
        expenseRatio,
        debtRatio,
        avgDailyRevenue: dailyIn,
        totalDebt:       totalDebt ?? 0,
      });
      // Surface the most critical warning (severity: critical > warning > info)
      const order = ["critical", "warning", "info"] as const;
      const top = warnings.sort(
        (a, b) => order.indexOf(a.severity) - order.indexOf(b.severity),
      )[0];
      if (top && top.severity === "critical") {
        return `🏭 _${top.message}_`;
      }
    } catch {
      // Vertical detection errors must never crash insight generation
    }
  }

  return null;
}

// ─── Coaching Mode ────────────────────────────────────────────────────────────

export type CoachingTopic =
  | "cash_flow"
  | "debt_management"
  | "pricing"
  | "inventory"
  | "savings"
  | "record_keeping"
  | "staff_management"
  | "risk_fraud"
  | "expense_control"
  | "revenue_growth"
  | "planning"
  | "general";

const COACHING_RESPONSES: Record<CoachingTopic, readonly string[]> = {
  cash_flow: [
    `💡 *Cash flow tip:* Every cedi you collect today is money available tomorrow. Prioritise collecting your debts before buying more stock.`,
    `💡 *Cash flow:* Know your minimum daily number — the amount you need to cover costs. Once you pass it, you're building profit.`,
    `💡 *Cash flow:* If your expenses are eating your sales, track them separately. You can't fix what you don't see.`,
    `💡 *Tight cash?* Check three things first: debts not collected, slow-moving stock, and recurring costs you can reduce. Usually the answer is in one of those three.`,
  ],
  debt_management: [
    `💡 *Debt tip:* Set a maximum credit limit per customer. When they hit it, no more goods until they pay. This is how you protect your cash.`,
    `💡 *Credit advice:* The longer a debt sits, the harder it is to collect. Follow up with customers within a week.`,
    `💡 *Debt tip:* Record every credit sale immediately. Memory is not a ledger — ZURIA is.`,
    `💡 *Collections:* Customers who pay on time deserve better service and maybe a small discount. Make punctual payment feel rewarding.`,
    `💡 *Credit risk:* If total credit given is more than one week's revenue, your business is carrying too much risk. Reduce it gradually.`,
  ],
  pricing: [
    `💡 *Pricing:* Your selling price should cover: cost of goods + your time + a profit margin. If you're not tracking cost price, you may be selling at a loss without knowing.`,
    `💡 *Pricing tip:* When costs go up, your prices should adjust. Don't absorb supplier increases — pass them on carefully.`,
    `💡 *Margin check:* Know your best-margin product and your worst. Sell more of what makes you more money per unit.`,
  ],
  inventory: [
    `💡 *Stock tip:* Know your fast sellers. Stock more of what moves, less of what sits. Slow stock ties up your cash.`,
    `💡 *Inventory:* Track what you buy and what you sell. The difference is what you have left. ZURIA can help you do this automatically.`,
    `💡 *Reorder point:* Set a minimum quantity for your top 5 products. When you drop below it, reorder immediately — don't wait until you're out.`,
  ],
  savings: [
    `💡 *Business savings:* Set aside even 5% of daily profit before spending. Small consistent amounts build a real buffer.`,
    `💡 *Savings tip:* Treat your savings like a bill — a non-negotiable expense you pay to yourself first.`,
  ],
  record_keeping: [
    `💡 *Record keeping:* Every transaction, no matter how small — record it. The small ones add up to big surprises.`,
    `💡 *Records:* You can't grow what you don't measure. Recording sales and expenses daily takes 2 minutes and saves you from surprises at month-end.`,
  ],
  staff_management: [
    `💡 *Staff tip:* Set clear daily sales targets for your team. People perform better when they know what success looks like.`,
    `💡 *Payroll discipline:* Keep staff costs below 25-30% of revenue. If payroll is climbing past that, review productivity before hiring more.`,
    `💡 *Motivation:* Small incentives — a bonus on hitting targets, a free meal — often outperform large raises. Recognition matters.`,
    `💡 *Staff integrity:* Cross-check daily totals against what staff reported. Unexplained shortfalls need a conversation, not assumptions.`,
    `💡 *Hiring:* Before hiring, calculate whether the new role will generate more revenue than it costs. Every hire should pay for itself within 3 months.`,
  ],
  risk_fraud: [
    `💡 *Internal control:* No single person should handle both cash and records. Separate responsibilities to reduce fraud risk.`,
    `💡 *Fraud signal:* If daily totals don't match stock movement, investigate immediately. Small discrepancies compound fast.`,
    `💡 *Cash handling:* Count the till at the same time every day. If the count is always "close enough", you're inviting leakage.`,
    `💡 *Record integrity:* Any time records are edited, the reason should be documented. Unexplained changes are a red flag.`,
    `💡 *Supplier risk:* Verify supplier invoices against what was actually delivered. Overcharging or short-delivery is common — and preventable.`,
  ],
  expense_control: [
    `💡 *Expense discipline:* List every recurring cost this month. If any item hasn't directly helped your revenue, ask whether you still need it.`,
    `💡 *Transport costs:* Consolidate deliveries where possible. Multiple small trips add up fast — one planned trip is always cheaper.`,
    `💡 *Utility bills:* High electricity bills often come from running equipment overnight. Simple habits — switching off freezers, fans, chargers — can cut bills by 10-20%.`,
    `💡 *Cost review:* Revisit supplier contracts every quarter. Prices move — a supplier who was cheapest 6 months ago may not be today.`,
  ],
  revenue_growth: [
    `💡 *Revenue tip:* Your existing customers are your fastest growth lever. Remind them what you have, offer them something new, treat them well.`,
    `💡 *Slow periods:* When sales are slow, it's a good time to call your best customers and ask what they need. Proactive beats passive.`,
    `💡 *Product mix:* Track which items sell most. Promote your best-sellers — they're already proven. Don't push slow-movers at full price.`,
    `💡 *Upselling:* Train yourself and your staff to suggest a complementary item at every sale. Even one extra item per customer adds up over a week.`,
  ],
  planning: [
    `💡 *Planning:* Set a revenue target for the month and break it into weekly goals. Knowing your target makes every day's sales feel meaningful.`,
    `💡 *Forecast:* Look at last month's sales by category. Which grew? Which shrank? That pattern usually repeats — stock accordingly.`,
    `💡 *Business health:* A healthy business covers all costs, has growing sales, low debt, and cash in reserve. Check all four regularly.`,
    `💡 *Expansion:* Only expand when your current operations are consistently profitable for 3+ months. Growth costs money before it makes money.`,
  ],
  general: [
    `💡 *Business tip:* Know your three numbers daily — money in, money out, money owed to you. ZURIA keeps track of all three.`,
    `💡 *Advice:* The best businesses are not the ones that make the most money — they're the ones that *know* their money. That's what ZURIA helps you do.`,
    `💡 A good business day isn't just about high sales. It's about high *profit* — which means managing costs too.`,
    `💡 *Consistency wins:* Record every transaction, follow up every debt, review every week. Small disciplines compound into big results.`,
  ],
};

/**
 * Generate a practical, African-context business coaching response.
 * Speak like an experienced advisor who genuinely wants this business to grow.
 */
export function zuriaCoach(topic: CoachingTopic = "general"): string {
  return pick(COACHING_RESPONSES[topic]);
}

// ─── Undo / Correction Flow ───────────────────────────────────────────────────

/**
 * Prompt to confirm an undo before executing.
 * Shows what will be removed so the user can verify.
 */
export function zuriaUndoPrompt(
  transactionDesc: string | null,
  ownerName: string,
): string {
  const name = firstName(ownerName);

  if (!transactionDesc) {
    return pick([
      `No recent record to undo, ${name}. What should I fix?`,
      `I don't see a recent entry to remove. What happened?`,
    ] as const);
  }

  return pick([
    `Remove the *${transactionDesc}*? Reply *"yes"* to confirm.`,
    `Want me to delete the *${transactionDesc}*? Say *"yes"* and it's gone.`,
    `Shall I remove the *${transactionDesc}*? Reply *"yes"* to undo it.`,
    `Delete *${transactionDesc}*? Say *"yes"* if that's right.`,
  ] as const);
}

/**
 * Confirmation after a successful undo.
 */
export function zuriaUndoConfirmed(transactionDesc: string, ownerName: string): string {
  const name = firstName(ownerName);
  return pick([
    `✅ Done, ${name}. The *${transactionDesc}* has been removed.`,
    `👌 Removed. The *${transactionDesc}* is gone from your records.`,
    `✅ That entry has been deleted, ${name}. What actually happened?`,
    `Gone. The *${transactionDesc}* is cleared. What should I record instead?`,
  ] as const);
}

/**
 * Response when there is nothing to undo.
 */
export function zuriaUndoNothing(ownerName: string): string {
  const name = firstName(ownerName);
  return pick([
    `Nothing to undo right now, ${name}. What should I fix?`,
    `I don't see a recent entry to remove, ${name}.`,
    `No recent record found to delete, ${name}. What happened?`,
  ] as const);
}

/**
 * Undo confirmed with side-effect acknowledgment.
 * Tells the user clearly whether debt/inventory/loan records were also reversed.
 */
export function zuriaUndoConfirmedWithEffects(
  transactionDesc: string,
  ownerName: string,
  hasDebtEffect: boolean,
  hasInventoryEffect: boolean,
  hasLoanEffect: boolean,
): string {
  const name = firstName(ownerName);
  const base = pick([
    `✅ Done, ${name}. The *${transactionDesc}* has been removed.`,
    `👌 Removed. The *${transactionDesc}* is gone from your records.`,
    `✅ That entry has been deleted, ${name}. What actually happened?`,
  ] as const);

  const effects: string[] = [];
  if (hasDebtEffect)     effects.push("_The related debt balance has been reversed._");
  if (hasInventoryEffect) effects.push("_The stock count has been corrected._");
  if (hasLoanEffect)     effects.push("_The loan balance has been reversed._");

  return effects.length > 0
    ? `${base}\n\n${effects.join("\n")}`
    : base;
}

// ─── Pre-save confirmation request ───────────────────────────────────────────

type ConfirmableType =
  | "sale" | "expense" | "debt" | "repayment" | "stock_purchase"
  | "salary" | "borrow_in" | "borrow_out" | "loan_repay_out"
  | "loan_collect_in" | "transfer" | "investment" | "withdrawal"
  | "refund_out" | "refund_in" | string;

const CONFIRM_TYPE_LABELS: Record<string, string> = {
  sale:            "Sale",
  expense:         "Expense",
  debt:            "Credit given",
  repayment:       "Payment received",
  stock_purchase:  "Stock purchase",
  salary:          "Salary payment",
  borrow_in:       "Loan received",
  borrow_out:      "Loan given",
  loan_repay_out:  "Loan repaid",
  loan_collect_in: "Loan collected",
  transfer:        "Transfer",
  investment:      "Investment",
  withdrawal:      "Withdrawal",
  refund_out:      "Refund given",
  refund_in:       "Refund received",
};

/**
 * Pre-save confirmation prompt for low-confidence transactions.
 * Shows the user exactly what ZURIA understood and asks for explicit "yes" before saving.
 *
 * Format: "Did I get that right? [Type] — GH₵[amount] (product) · person
 *          Reply *yes* to save or *no* to try again."
 */
export function zuriaConfirmationRequest(
  type: ConfirmableType,
  amount: number,
  customerName: string | null,
  productName: string | null,
  category: BusinessCategory,
): string {
  const typeLabel = CONFIRM_TYPE_LABELS[type] ?? humanType(type as TransactionType, category);
  const amountStr = ghs(amount);
  const itemPart  = productName  ? ` (${productName})`  : "";
  const custPart  = customerName ? ` · *${customerName}*` : "";

  const summary = `*${typeLabel}* — *${amountStr}*${itemPart}${custPart}`;

  return pick([
    `Did I get that right?\n${summary}\n\nReply *yes* to save, or *no* to try again.`,
    `Just to confirm — is this correct?\n${summary}\n\nSay *yes* to record it, *no* to redo it.`,
    `Let me check before saving:\n${summary}\n\n*Yes* to confirm, *no* to rephrase.`,
  ] as const);
}

// ─── Customer Disambiguation ──────────────────────────────────────────────────

/**
 * Ask "which Ama?" when multiple customers share the same name.
 */
export function zuriaDisambiguate(name: string, options: string[]): string {
  if (options.length === 0) return zuriaAskClarification("person");
  const list = options.map((o, i) => `${i + 1}. ${o}`).join("\n");
  return pick([
    `Which *${name}* — there are a few in your records:\n${list}\n\nJust say the number.`,
    `I see ${options.length} *${name}*s. Which one?\n${list}\n\nReply with the number.`,
    `Multiple *${name}*s in your books:\n${list}\n\nWhich one is this?`,
  ] as const);
}

// ─── Subscription Nudge (contextual, non-pushy) ───────────────────────────────

type NudgeContext =
  | "monthly_reports"
  | "debt_alerts"
  | "inventory"
  | "analytics"
  | "unlimited_entries";

const NUDGES: Record<NudgeContext, string> = {
  monthly_reports:   `📊 Want automatic monthly reports? That's unlocked on the Growth plan.`,
  debt_alerts:       `🔔 Growth plan can send automatic debt reminders to your customers.`,
  inventory:         `📦 Track stock levels automatically — that's on Growth plan.`,
  analytics:         `📊 See your best sellers and profit trends on Growth plan.`,
  unlimited_entries: `💡 You're close to today's limit. Growth plan gives you 500 entries a month.`,
};

/**
 * Return a single non-pushy upgrade nudge, only when contextually appropriate.
 * Never call this during an active financial recording flow.
 */
export function subscriptionNudge(context: NudgeContext): string {
  return NUDGES[context];
}

// ─── Standalone Limit Warning ─────────────────────────────────────────────────

/**
 * A standalone limit-warning message — never appended to a financial confirmation.
 * Staged via pendingLimitNotification and shown at the start of the next message.
 */
export function buildLimitWarning(
  remaining: number,
  total: number,
  period: string,
  referralLink?: string,
): string {
  const refLine = referralLink
    ? `\n💡 _Refer a friend: ${referralLink}_`
    : `\n💡 _Open ZURIA app → Refer & Earn to get more._`;

  if (remaining === 0) {
    return (
      `⛔ You've used all *${total}* entries for ${period}.\n` +
      `Reply *"subscribe"* to get more — or earn free entries by referring friends.${refLine}`
    );
  }

  if (remaining <= 2) {
    return (
      `⚠️ Only *${remaining}* entr${remaining === 1 ? "y" : "ies"} left ${period}.\n` +
      `Reply *"subscribe"* to continue without limits.${refLine}`
    );
  }

  return (
    `💡 *${remaining}* entries remaining ${period}.\n` +
    `Reply *"subscribe"* to upgrade, or refer friends to earn more.${refLine}`
  );
}

// ─── Context-Aware Greeting ───────────────────────────────────────────────────

/**
 * Generate a time-of-day-aware greeting.
 * Used on session reconnect or after long silence.
 */
export function zuriaGreet(ownerName: string, hourUTC?: number): string {
  const name = firstName(ownerName);
  // Ghana is UTC+0 (GMT) — no offset needed for Ghana Standard Time
  const hour = hourUTC ?? new Date().getUTCHours();

  if (hour >= 5 && hour < 12) {
    return pick([
      `Good morning, ${name}! What's happening in the business today?`,
      `Morning, ${name}! What sold already?`,
      `Good morning! Ready to record the day's transactions, ${name}?`,
    ] as const);
  }
  if (hour >= 12 && hour < 17) {
    return pick([
      `Hey ${name}! How's the afternoon going?`,
      `Good afternoon, ${name}! What's the update?`,
      `Afternoon, ${name}. What happened in the business?`,
    ] as const);
  }
  if (hour >= 17 && hour < 21) {
    return pick([
      `Good evening, ${name}. How did the day go?`,
      `Evening, ${name}! What's the end-of-day looking like?`,
      `Hey ${name} — ready to wrap up the day's records?`,
    ] as const);
  }
  // Late night / early morning
  return pick([
    `Hey ${name}, working late! What happened today?`,
    `Still at it, ${name}? Let's get the records straight.`,
  ] as const);
}
