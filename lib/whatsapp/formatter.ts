import type { BusinessCategory, Debt, InventoryItem, Loan, ParsedTransaction, Transaction } from "@/types/domain";
import { MONEY_IN_TYPES, MONEY_OUT_TYPES, REVENUE_TYPES, OPERATING_COST_TYPES, TRANSACTION_TYPE_LABELS } from "@/types/domain";
import { formatMoney } from "@/lib/utils";

const GHS = (n: number) => formatMoney(Math.abs(n));

const SUPPORT_WA = "https://wa.me/233242176603";

// ─── Business-type-aware labels ───────────────────────────────────────────────

type BusinessVoice = {
  saleLabel: string;
  productLabel: string;
  revenueSection: string;
  revenueIcon: string;
  bestLabel: string;
  profitLabel: string;
};

function getVoice(category: BusinessCategory): BusinessVoice {
  switch (category) {
    case "barber":
    case "salon":
      return { saleLabel: "You served a customer", productLabel: "Service", revenueSection: "Services today", revenueIcon: "✂️", bestLabel: "Top service", profitLabel: "Earnings" };
    case "food":
    case "restaurant":
      return { saleLabel: "You served a customer", productLabel: "Dish/Item", revenueSection: "Revenue today", revenueIcon: "🍽️", bestLabel: "Top item", profitLabel: "Earnings" };
    case "momo":
      return { saleLabel: "You processed a transaction", productLabel: "Type", revenueSection: "Transactions today", revenueIcon: "📱", bestLabel: "Top transaction", profitLabel: "Earnings" };
    default:
      return { saleLabel: "You sold something", productLabel: "Item", revenueSection: "Sales today", revenueIcon: "🏪", bestLabel: "Best seller", profitLabel: "Profit" };
  }
}

function txLabel(type: ParsedTransaction["type"], category: BusinessCategory): string {
  if (type === "sale") return getVoice(category).saleLabel;
  return TRANSACTION_TYPE_LABELS[type] ?? type;
}

// Signature line at bottom of outgoing messages
function sig(businessName: string) {
  return `_— ZURIA (${businessName})_`;
}

// ─── Transaction confirmed ────────────────────────────────────────────────────

export function fmtConfirm(
  parsed: ParsedTransaction,
  dailyTotal: { in: number; out: number },
  category: BusinessCategory = "provision",
  businessName = "Your Business"
): string {
  const voice = getVoice(category);
  const label = txLabel(parsed.type, category);
  const isIn = MONEY_IN_TYPES.includes(parsed.type);
  const isOut = MONEY_OUT_TYPES.includes(parsed.type);
  const arrow = isIn ? "💚" : isOut ? "🔴" : "🔄";

  const lines: string[] = [
    `${arrow} *Saved!* ${label}`,
    `Amount: *${GHS(parsed.amount)}*`,
  ];

  if (parsed.productName) lines.push(`${voice.productLabel}: ${parsed.productName}`);
  if (parsed.customerName) lines.push(`Customer: ${parsed.customerName}`);
  if (parsed.paymentMethod !== "unknown") lines.push(`Paid by: ${parsed.paymentMethod.toUpperCase()}`);

  lines.push("");
  lines.push(`📊 *Today so far:* In ${GHS(dailyTotal.in)} | Out ${GHS(dailyTotal.out)}`);

  const net = dailyTotal.in - dailyTotal.out;
  if (net > 0) lines.push(`✅ You are *+${GHS(net)}* ahead today`);
  else if (net < 0) lines.push(`⚠️ You are *${GHS(net)}* down today`);

  if (parsed.confidence < 0.55) {
    lines.push("", "⚠️ _I wasn't fully sure — please check if this is right._");
  }

  lines.push("", sig(businessName));
  return lines.join("\n");
}

// ─── Daily summary ────────────────────────────────────────────────────────────

export function fmtSummary(
  transactions: Transaction[],
  ownerName: string,
  category: BusinessCategory = "provision",
  businessName = "Your Business"
): string {
  const voice = getVoice(category);
  const today = new Date().toISOString().slice(0, 10);
  const todays = transactions.filter((t) => t.createdAt.startsWith(today));
  const firstName = ownerName.split(" ")[0];
  const dateStr = new Date().toLocaleDateString("en-GH", { weekday: "short", day: "numeric", month: "short" });

  if (todays.length === 0) {
    return [
      `📊 *${businessName} — ${dateStr}*`,
      "",
      "Nothing recorded yet today. 😊",
      "",
      "Tell me what happened:",
      category === "barber" || category === "salon"
        ? '• "Cut hair 15" or "Shaved 20"'
        : category === "food" || category === "restaurant"
        ? '• "Served rice 10" or "Sold 5 plates 50"'
        : category === "momo"
        ? '• "Sent 200 momo" or "Received 100"'
        : '• "Sold rice 120" or "Bought stock 200"',
      '• "balance" — to see today\'s report',
      "",
      `_I'm right here whenever you're ready, ${firstName}! 😊_`,
      "",
      sig(businessName),
    ].join("\n");
  }

  const moneyIn        = sum(todays.filter((t) => MONEY_IN_TYPES.includes(t.type)));
  const moneyOut       = sum(todays.filter((t) => MONEY_OUT_TYPES.includes(t.type)));
  const salesRevenue   = sum(todays.filter((t) => REVENUE_TYPES.includes(t.type)));
  const operatingCosts = sum(todays.filter((t) => OPERATING_COST_TYPES.includes(t.type)));

  const tradingProfit = salesRevenue - operatingCosts;
  const financingIn   = moneyIn - salesRevenue;
  const financingOut  = moneyOut - operatingCosts;
  const netCash       = moneyIn - moneyOut;

  const lines = [`📊 *${businessName} — ${dateStr}*`, ""];

  lines.push(`${voice.revenueIcon} *${voice.revenueSection}:*   ${GHS(salesRevenue)}`);
  if (operatingCosts > 0) lines.push(`🔴 *Costs today:*           ${GHS(operatingCosts)}`);
  lines.push(`─────────────────`);

  if (salesRevenue === 0 && operatingCosts === 0) {
    lines.push(`🔄 No ${voice.revenueSection.toLowerCase()} or costs yet.`);
  } else if (tradingProfit > 0) {
    lines.push(`✅ *${voice.profitLabel}:  +${GHS(tradingProfit)}* 🎉`);
  } else if (tradingProfit < 0) {
    lines.push(`📉 *Loss:  -${GHS(tradingProfit)}* — costs are more than ${voice.revenueSection.toLowerCase()}.`);
  } else {
    lines.push(`🔄 *Break even* — you made back exactly what you spent.`);
  }

  if (financingIn > 0 || financingOut > 0) {
    lines.push("", "💼 *Other money today:*");
    if (financingIn > 0)  lines.push(`  💳 Received (loans/other): +${GHS(financingIn)}`);
    if (financingOut > 0) lines.push(`  💸 Paid out (loans/other):  -${GHS(financingOut)}`);
    lines.push("");
    if (netCash > 0)      lines.push(`💰 *Cash in hand today: +${GHS(netCash)}*`);
    else if (netCash < 0) lines.push(`📉 *Cash today: -${GHS(netCash)}* _(more left than came in)_`);
    else                  lines.push(`🔄 *Cash in = Cash out.*`);
  }

  const topProduct = getTopProduct(todays);
  if (topProduct) lines.push("", `🏆 *${voice.bestLabel}: ${topProduct}*`);

  lines.push("");
  if (tradingProfit > 0)      lines.push(`_Good work today, ${firstName}! 💪 Keep recording so I can help you grow._`);
  else if (tradingProfit < 0) lines.push(`_Don't worry ${firstName} — every day is a chance to do better. I'm with you! 💙_`);
  else                        lines.push(`_Keep going ${firstName}! Every sale counts. I'm tracking it all for you! 😊_`);

  lines.push("", sig(businessName));
  return lines.join("\n");
}

// ─── Debt list ────────────────────────────────────────────────────────────────

export function fmtDebts(debts: Debt[], businessName = "Your Business"): string {
  const open = debts.filter((d) => d.outstandingAmount > 0);
  if (!open.length) {
    return ["✅ *Nobody owes you anything right now!*", "", "You are clear. 🎉 Well done!", "", sig(businessName)].join("\n");
  }

  const total = open.reduce((acc, d) => acc + d.outstandingAmount, 0);
  const lines = [`💰 *People who owe you (${open.length}):*`, ""];

  open.slice(0, 10).forEach((d, i) => {
    lines.push(`${i + 1}. ${d.customerName ?? "Unknown"} — *${GHS(d.outstandingAmount)}*`);
  });

  if (open.length > 10) lines.push(`_...and ${open.length - 10} more_`);
  lines.push("", `*Total owed to you: ${GHS(total)}*`);
  lines.push("", '_Say their name and amount to record a payment, e.g. "Ama paid 50"_');
  lines.push("", sig(businessName));
  return lines.join("\n");
}

// ─── Loan list ────────────────────────────────────────────────────────────────

export function fmtLoans(loans: Loan[], businessName = "Your Business"): string {
  const open = loans.filter((l) => l.status === "open");
  if (!open.length) {
    return ["✅ *No open loans right now.*", "", "You are all clear! 🎉", "", sig(businessName)].join("\n");
  }

  const taken = open.filter((l) => l.direction === "taken");
  const given = open.filter((l) => l.direction === "given");
  const lines: string[] = [];

  if (taken.length) {
    const total = taken.reduce((acc, l) => acc + l.outstandingAmount, 0);
    lines.push(`🔴 *You still owe (${taken.length} loan${taken.length > 1 ? "s" : ""}):*`);
    taken.forEach((l) => lines.push(`  • ${l.counterpartyName ?? "Unknown"} — ${GHS(l.outstandingAmount)}`));
    lines.push(`  _Total you owe: ${GHS(total)}_`, "");
  }

  if (given.length) {
    const total = given.reduce((acc, l) => acc + l.outstandingAmount, 0);
    lines.push(`💚 *They owe you back (${given.length} loan${given.length > 1 ? "s" : ""}):*`);
    given.forEach((l) => lines.push(`  • ${l.counterpartyName ?? "Unknown"} — ${GHS(l.outstandingAmount)}`));
    lines.push(`  _Total owed to you: ${GHS(total)}_`);
  }

  lines.push("", sig(businessName));
  return lines.join("\n").trim();
}

// ─── Inventory list ───────────────────────────────────────────────────────────

export function fmtStock(inventory: InventoryItem[], businessName = "Your Business"): string {
  if (!inventory.length) {
    return [
      "📦 *No stock recorded yet.*",
      "",
      'Record a purchase with a quantity to start tracking, e.g. "Bought 10 bags rice 500"',
      "",
      sig(businessName),
    ].join("\n");
  }

  const lines = [`📦 *Your Stock (${inventory.length} item${inventory.length > 1 ? "s" : ""}):*`, ""];
  const low: string[] = [];

  inventory.slice(0, 15).forEach((item) => {
    const isLow = item.quantity != null && item.quantity <= item.lowStockThreshold;
    lines.push(`• ${item.productName}: *${item.quantity ?? "?"}*${isLow ? " ⚠️" : ""}`);
    if (isLow && item.productName) low.push(item.productName);
  });

  if (inventory.length > 15) lines.push(`_...and ${inventory.length - 15} more_`);
  if (low.length) lines.push("", `⚠️ *Running low — restock soon:* ${low.join(", ")}`);
  lines.push("", sig(businessName));
  return lines.join("\n");
}

// ─── Help message ─────────────────────────────────────────────────────────────

export function fmtHelp(ownerName: string, category: BusinessCategory = "provision", businessName = "Your Business"): string {
  const firstName = ownerName.split(" ")[0];

  const examples =
    category === "barber" || category === "salon"
      ? [
          '💇 Services: "Cut hair 15" or "Shaved Kofi 20"',
          '🧾 Credit: "Ama owes me 50" or "Kofi no pay yet"',
          '💸 Costs: "Bought clippers 200" or "Paid rent 300"',
          '👷 Salaries: "Paid Adjoa 400"',
        ]
      : category === "food" || category === "restaurant"
      ? [
          '🍽️ Sales: "Served 5 plates rice 50" or "Sold fufu 10"',
          '🧾 Credit: "Ama owes me 30" or "Kojo took food credit"',
          '💸 Costs: "Bought tomatoes 80" or "Paid gas 50"',
          '👷 Salaries: "Paid Adjoa 400"',
        ]
      : category === "momo"
      ? [
          '📱 Transactions: "Sent 200 momo" or "Received 100"',
          '💸 Costs: "Paid float charges 5" or "Bought data 20"',
          '🧾 Credit: "Ama owes me 50"',
        ]
      : [
          '💰 Sales: "Sold rice 120" or "Sold 3 bags sugar 60"',
          '🧾 Credit: "Ama owes me 200" or "Kofi took 3 boxes credit"',
          '💸 Costs: "Paid ECG 50" or "Bought stock 800"',
          '👷 Salaries: "Paid Adjoa 400"',
          '🤝 Loans: "Borrowed 500 from bank" or "Gave Kojo 200 loan"',
        ];

  return [
    `👋 Hi *${firstName}*! I am *ZURIA (${businessName})*, your personal business helper.`,
    "",
    "Just tell me what happened — I do the rest! 😊",
    "",
    "*Recording your business:*",
    ...examples,
    '💳 Got paid: "Ama paid me 100" or "Kofi paid 50 momo"',
    "",
    "*Check how your business is doing:*",
    '📊 "balance" or "summary" — Today\'s full report',
    '💰 "who owes me" — See all debts',
    '🤝 "loans" — See all loans',
    '📦 "stock" — See your goods',
    '🔒 "lock" — Lock your account',
    "",
    "*Need human help?*",
    `📞 Message us directly: ${SUPPORT_WA}`,
    "We reply Monday – Saturday, 8am – 8pm 🇬🇭",
    "",
    "_Just type naturally — I will understand! 🙂_",
    "",
    sig(businessName),
  ].join("\n");
}

// ─── Welcome message (sent after account creation) ───────────────────────────

export function fmtWelcome(ownerName: string, businessName: string, category: BusinessCategory = "provision"): string {
  const firstName = ownerName.split(" ")[0];
  const voiceEmoji =
    category === "barber" || category === "salon" ? "✂️"
    : category === "food" || category === "restaurant" ? "🍽️"
    : category === "momo" ? "📱"
    : "🏪";

  const example1 =
    category === "barber" || category === "salon" ? '"Cut hair 15"'
    : category === "food" || category === "restaurant" ? '"Served 5 plates 50"'
    : category === "momo" ? '"Sent 200 momo"'
    : '"Sold rice 120"';

  return [
    `🎉 *Welcome to ZURIA, ${firstName}!*`,
    "",
    `Congratulations on setting up *${businessName}* ${voiceEmoji}`,
    "",
    "I'm your personal business helper — available 24/7, right here on WhatsApp.",
    "I remember *everything* for you, so you never lose track again! 💪",
    "",
    "━━━━━━━━━━━━━━━━━━━",
    "✨ *Here's what I can do for you:*",
    "━━━━━━━━━━━━━━━━━━━",
    "",
    `${voiceEmoji} *Record sales:* ${example1}`,
    '🧾 *Track debts:* "Ama owes me 200"',
    '💸 *Log expenses:* "Paid ECG 80"',
    '📊 *Check summary:* "balance"',
    '📦 *Check stock:* "stock"',
    '💰 *See debtors:* "who owes me"',
    "",
    "━━━━━━━━━━━━━━━━━━━",
    "🔐 *Your account is protected*",
    "━━━━━━━━━━━━━━━━━━━",
    "",
    "You set a 4-digit PIN during registration.",
    "Type it anytime I ask to unlock your account.",
    "_Keep it safe — don't share it with anyone!_ 🙏",
    "",
    "━━━━━━━━━━━━━━━━━━━",
    "🆘 *Need help?*",
    "━━━━━━━━━━━━━━━━━━━",
    "",
    `Just type *"help"* anytime for a full guide.`,
    `Or reach us directly: ${SUPPORT_WA}`,
    "",
    `_You're all set, ${firstName}! Start with your first record now — I'm ready! 🚀_`,
    "",
    sig(businessName),
  ].join("\n");
}

// ─── Not found ────────────────────────────────────────────────────────────────

export function fmtNotFound(category: BusinessCategory = "provision", businessName = "Your Business"): string {
  const example =
    category === "barber" || category === "salon" ? '"Cut hair 15"'
    : category === "food" || category === "restaurant" ? '"Served 5 plates 50"'
    : category === "momo" ? '"Sent 200 momo"'
    : '"Sold rice 120"';

  return [
    "🤔 *I didn't catch that.* No problem — try something like:",
    `• ${example}`,
    '• "Ama owes me 200"',
    '• "balance" (to see today\'s report)',
    '• "who owes me"',
    '• "help" (for full guide)',
    "",
    "_I'm always here for you! 😊_",
    "",
    sig(businessName),
  ].join("\n");
}

// ─── Unregistered user ────────────────────────────────────────────────────────

export function fmtUnregistered(): string {
  return [
    `👋 *Hello! Welcome to ZURIA.*`,
    "",
    "This number is not registered yet.",
    "",
    "To use ZURIA on WhatsApp:",
    "1️⃣ Create your free account at the ZURIA app",
    "2️⃣ Set your 4-digit WhatsApp PIN during setup",
    "3️⃣ Come back here and start recording!",
    "",
    "_ZURIA is your free business helper — it remembers everything for you. 😊_",
    "",
    `Need help getting started? ${SUPPORT_WA}`,
  ].join("\n");
}

// ─── System error fallback (always reply, even when something breaks) ─────────

export function fmtSystemError(): string {
  return [
    "⚠️ *ZURIA is having a small hiccup right now.*",
    "",
    "Don't worry — your message was received.",
    "Please try again in a moment. 🙏",
    "",
    `If this keeps happening, message us directly: ${SUPPORT_WA}`,
    "We'll sort it out for you! 💙",
  ].join("\n");
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sum(items: Transaction[]): number {
  return items.reduce((acc, t) => acc + t.amount, 0);
}

function getTopProduct(transactions: Transaction[]): string | undefined {
  const counts = new Map<string, number>();
  transactions.forEach((t) => {
    if (t.productName && REVENUE_TYPES.includes(t.type)) {
      counts.set(t.productName, (counts.get(t.productName) ?? 0) + t.amount);
    }
  });
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];
}
