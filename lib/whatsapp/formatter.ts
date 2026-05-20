import type { BusinessCategory, Debt, InventoryItem, Loan, ParsedTransaction, SubscriptionPlan, Transaction } from "@/types/domain";
import { MONEY_IN_TYPES, MONEY_OUT_TYPES, REVENUE_TYPES, OPERATING_COST_TYPES, TRANSACTION_TYPE_LABELS, SUBSCRIPTION_TIERS } from "@/types/domain";
import { formatMoney } from "@/lib/utils";
import { APP_URL, SUPPORT_WA_LINK } from "@/lib/config";

// ─── Subscription config (derived from SUBSCRIPTION_TIERS — single source of truth) ─
const SUPPORT_WA = SUPPORT_WA_LINK;
const SUB_PLANS = {
  growth:     { label: SUBSCRIPTION_TIERS.growth.brand,      price: SUBSCRIPTION_TIERS.growth.priceGHS,      monthlyPrice: SUBSCRIPTION_TIERS.growth.annualPriceGHS      ?? 250  },
  pro:        { label: SUBSCRIPTION_TIERS.pro.brand,         price: SUBSCRIPTION_TIERS.pro.priceGHS,         monthlyPrice: SUBSCRIPTION_TIERS.pro.annualPriceGHS         ?? 700  },
  enterprise: { label: SUBSCRIPTION_TIERS.enterprise.brand,  price: SUBSCRIPTION_TIERS.enterprise.priceGHS,  monthlyPrice: SUBSCRIPTION_TIERS.enterprise.annualPriceGHS  ?? 2000 },
};

const GHS = (n: number) => formatMoney(Math.abs(n));

// Referral constants — kept in sync with referral-service.ts and welcome/route.ts
const REFERRAL_REWARD_GHS = 0.50;
const WITHDRAWAL_THRESHOLD_GHS = 5.00;   // 10 referrals
const MILESTONE_REFERRALS = 30;           // 30 referrals this month → Growth unlock
const MILESTONE_BALANCE_GHS = 15.00;     // 30 × 0.50

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

// ─── Daily summary (alias kept for backwards-compat — delegates to fmtEndOfDayReport) ─

// ─── Debt list ────────────────────────────────────────────────────────────────

export function fmtDebts(debts: Debt[], businessName = "Your Business"): string {
  const open = debts.filter((d) => d.outstandingAmount > 0);
  if (!open.length) {
    return ["✅ *Nobody owes you anything right now!*", "", "You are clear. 🎉 Well done!", "", sig(businessName)].join("\n");
  }

  const now = Date.now();
  const DAY_MS = 86_400_000;

  const total = open.reduce((acc, d) => acc + d.outstandingAmount, 0);
  const lines = [`💰 *People who owe you (${open.length}):*`, ""];

  // Sort: oldest debts first so overdue items surface at the top
  const sorted = [...open].sort((a, b) => {
    const dateA = new Date(a.createdAt ?? 0).getTime();
    const dateB = new Date(b.createdAt ?? 0).getTime();
    return dateA - dateB;
  });

  const overdue30: string[] = [];
  const overdue7: string[] = [];

  sorted.slice(0, 10).forEach((d, i) => {
    const ageDays = d.createdAt
      ? Math.floor((now - new Date(d.createdAt).getTime()) / DAY_MS)
      : 0;

    let ageSuffix = "";
    if (ageDays >= 30) {
      ageSuffix = ` 🚨 _${ageDays}d overdue_`;
      if (d.customerName) overdue30.push(d.customerName);
    } else if (ageDays >= 7) {
      ageSuffix = ` ⚠️ _${ageDays}d_`;
      if (d.customerName) overdue7.push(d.customerName);
    }

    lines.push(`${i + 1}. ${d.customerName ?? "Unknown"} — *${GHS(d.outstandingAmount)}*${ageSuffix}`);
  });

  if (open.length > 10) lines.push(`_...and ${open.length - 10} more_`);
  lines.push("", `*Total owed to you: ${GHS(total)}*`);

  if (overdue30.length) {
    lines.push("", `🚨 *Very overdue (30+ days):* ${overdue30.join(", ")}`, `_Consider sending a firm reminder or visiting them in person._`);
  } else if (overdue7.length) {
    lines.push("", `⚠️ *Overdue (7+ days):* ${overdue7.join(", ")}`, `_Time to follow up — send a gentle reminder._`);
  }

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

export function fmtHelp(
  ownerName: string,
  category: BusinessCategory = "provision",
  businessName = "Your Business",
  plan: SubscriptionPlan = "free"
): string {
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

  const canMonthly = plan === "growth" || plan === "pro" || plan === "enterprise";
  const canFull    = plan === "pro" || plan === "enterprise";

  const planBadge =
    plan === "free"       ? "🆓 Starter Ledger — Free (15 entries/day)"
    : plan === "growth"   ? "🟢 ZURIA Growth — GHS 25/month"
    : plan === "pro"      ? "🔵 ZURIA Pro — GHS 70/month"
    : "🟣 ZURIA Enterprise — GHS 200/month";

  const reportLines = [
    '📊 "balance" or "summary" — End-of-day report',
    '📅 "weekly report" — This week\'s performance',
    canMonthly ? '📆 "monthly report" — Full monthly analysis' : '_"monthly report" — available on Growth & above_',
    canFull    ? '🏛️ "full dashboard" — Advanced analytics & AI insights' : null,
  ].filter(Boolean) as string[];

  return [
    `👋 Hi *${firstName}*! I am *ZURIA*, your AI Business Assistant for *${businessName}*.`,
    "",
    `Your plan: *${planBadge}*`,
    "",
    "Just tell me what happened — I do the rest! 😊",
    "",
    "*Recording your business:*",
    ...examples,
    '💳 Got paid: "Ama paid me 100" or "Kofi paid 50 momo"',
    "",
    "*Check how your business is doing:*",
    ...reportLines,
    '💰 "who owes me" — See all debts',
    '🤝 "loans" — See all loans',
    '📦 "stock" — See your goods',
    '🔒 "lock" — Lock your account',
    "",
    plan === "free" ? "*Want unlimited messages + more features?*" : "*Subscription commands:*",
    plan === "free" ? 'Reply *"subscribe"* to see plans (from GHS 25/month)' : 'Reply *"subscribe"* to renew or upgrade your plan',
    "",
    "*Need human help?*",
    `📞 Message us directly: ${SUPPORT_WA}`,
    "We reply Monday – Saturday, 8am – 8pm 🇬🇭",
    "",
    // Sandbox notice — shown ONLY in sandbox/dev mode, never in production.
    // Set WHATSAPP_SANDBOX=true in .env.local to enable during testing.
    ...(process.env.WHATSAPP_SANDBOX === "true" ? [
      "━━━━━━━━━━━━━━━━━━━",
      "📱 *WhatsApp Sandbox reminder*",
      "━━━━━━━━━━━━━━━━━━━",
      "",
      "You are using the *Twilio sandbox* (testing mode).",
      "Sandbox sessions expire every *72 hours*.",
      "To rejoin, send exactly: *join contrast-pull*",
      "",
      "For a better experience with *no expiry*, use Telegram:",
      "👉 https://t.me/ZuriaBot",
      "",
    ] : []),
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
    "I'm your *AI Business Assistant* — available 24/7 on WhatsApp and Telegram.",
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
    "📱 *WhatsApp Sandbox Note*",
    "━━━━━━━━━━━━━━━━━━━",
    "",
    "⚠️ You are using the *WhatsApp Sandbox* (testing mode).",
    "Your sandbox session expires every *72 hours*.",
    "To reconnect, send: *join contrast-pull*",
    "",
    "For a smoother experience with no expiry, switch to Telegram:",
    "👉 https://t.me/ZuriaBot",
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
    "2️⃣ Set your 4-digit PIN during setup",
    "3️⃣ Come back here and start recording!",
    "",
    "━━━━━━━━━━━━━━━━━━━",
    "📱 *WhatsApp Sandbox Users*",
    "━━━━━━━━━━━━━━━━━━━",
    "",
    "You are on the *WhatsApp Sandbox* (testing mode).",
    "Your session expires every *72 hours* — to rejoin, send:",
    "*join contrast-pull*",
    "",
    "Or use *Telegram* for a seamless experience (no expiry):",
    "👉 https://t.me/ZuriaBot",
    "",
    "_ZURIA — AI Business Assistant with WhatsApp + Telegram integration. It remembers everything so you don't have to. 😊_",
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

// ─── LIMITED INTELLIGENCE MODE notice ────────────────────────────────────────
// Appended to responses when no AI provider is configured / reachable.
// The rule-based engine still works fully — this is informational only.

export function fmtLimitedIntelligenceMode(): string {
  return [
    "",
    "━━━━━━━━━━━━━━━━━━━━━━━━",
    "🔧 _ZURIA is operating in Limited Intelligence Mode right now._",
    "_Basic features (recording, reports, balance) still work perfectly._",
    "_Full AI insights will resume shortly. 🙏_",
  ].join("\n");
}

// ─── Subscription plans overview (user typed "subscribe" / "upgrade") ────────

export function fmtSubscribePlans(
  currentPlan: SubscriptionPlan = "free",
  businessName = "Your Business"
): string {
  const currentLabel =
    currentPlan === "free"       ? "Starter Ledger — Free (15 entries/day)"
    : currentPlan === "growth"   ? "ZURIA Growth — GHS 25/month"
    : currentPlan === "pro"      ? "ZURIA Pro — GHS 70/month"
    : "ZURIA Enterprise — GHS 200/month";

  return [
    `🧠 *ZURIA — AI Memory System for Your Business*`,
    `_Your current plan: ${currentLabel}_`,
    "",
    "━━━━━━━━━━━━━━━━━━━━━━━━",
    `🟢 *ZURIA Growth — GHS ${SUB_PLANS.growth.price}/month*`,
    `   _(or GHS ${SUB_PLANS.growth.monthlyPrice}/year — 2 months free!)_`,
    "   ✅ 500 AI entries per month",
    "   ✅ Monthly profit reports",
    "   ✅ AI-generated sales insights in local language",
    "   ✅ Auto debt reminders via WhatsApp",
    "   ✅ Inventory tracking & restock predictions",
    "   ✅ Customer debt summaries",
    "   ✅ Export to PDF/Excel",
    "",
    `🔵 *ZURIA Pro — GHS ${SUB_PLANS.pro.price}/month*`,
    `   _(or GHS ${SUB_PLANS.pro.monthlyPrice}/year — 2 months free!)_`,
    "   ✅ Unlimited AI entries",
    "   ✅ AI cash-flow forecasting & profit leakage detection",
    "   ✅ Predictive business health scoring",
    "   ✅ Staff accounts & employee permissions",
    "   ✅ Customer loyalty tracking",
    "   ✅ Auto-generated invoices",
    "   ✅ AI business coach (on-demand advice)",
    "   ✅ Advanced analytics (profit trends, expense heatmaps)",
    "",
    `🟣 *ZURIA Enterprise — GHS ${SUB_PLANS.enterprise.price}/month*`,
    `   _(or GHS ${SUB_PLANS.enterprise.monthlyPrice}/year — 2 months free!)_`,
    "   ✅ Everything in Pro",
    "   ✅ Multi-branch management & dashboards",
    "   ✅ Executive KPI & AI growth forecasting",
    "   ✅ Business valuation estimates",
    "   ✅ Supplier & purchase order management",
    "   ✅ Ask AI anything: \"Why are profits down?\"",
    "   ✅ POS, MoMo & bank integrations",
    "   ✅ Dedicated support & onboarding",
    "━━━━━━━━━━━━━━━━━━━━━━━━",
    "",
    "💳 *How to pay — fully automatic:*",
    "",
    "1️⃣  Reply *\"subscribe\"* → ZURIA sends you a secure payment link",
    "2️⃣  Tap the link → Paystack checkout opens in your browser",
    "3️⃣  Choose how to pay:",
    "     📱 MoMo — MTN, Telecel, AirtelTigo, or Vodafone",
    "     💳 Bank card — Visa or Mastercard",
    "     🏦 Bank transfer",
    "4️⃣  Complete payment → ✅ *Your plan activates instantly*",
    "",
    "_No codes to dial. No waiting. No manual steps. Fully automatic._",
    "",
    `🌐 Or pay directly on the ZURIA website:`,
    `${APP_URL}/subscription`,
    "",
    "📱 *WhatsApp Sandbox users:* session expires every 72h.",
    "   Rejoin: *join contrast-pull* | Or use Telegram (no expiry): https://t.me/ZuriaBot",
    "",
    "━━━━━━━━━━━━━━━━━━━━━━━━",
    "🎁 *Want Growth for FREE? — Refer & Earn*",
    `Earn *GHS ${REFERRAL_REWARD_GHS.toFixed(2)}* for every friend who joins ZURIA.`,
    "",
    `💵 *Goal 1:* Refer 10 friends → earn *GHS ${WITHDRAWAL_THRESHOLD_GHS.toFixed(2)}* → withdraw cash to your MoMo`,
    `🚀 *Goal 2:* Refer ${MILESTONE_REFERRALS} friends this month → earn *GHS ${MILESTONE_BALANCE_GHS.toFixed(2)}* + unlock *Growth features FREE* until end of month!`,
    "",
    "Open ZURIA app → Refer & Earn → copy your personal referral link.",
    "━━━━━━━━━━━━━━━━━━━━━━━━",
    "",
    `Questions? ${SUPPORT_WA}`,
    `_— ZURIA (${businessName})_`,
  ].join("\n");
}

// ─── Subscription required (free daily limit hit) ────────────────────────────

export function fmtSubscriptionRequired(
  limit: number,
  businessName = "Your Business",
  referralLink?: string,
  period: "daily" | "monthly" = "daily"
): string {
  const resetNote = period === "monthly"
    ? "_Resets on the 1st of next month. 📅_"
    : "_Resets at midnight tonight. 🌙_";
  const periodLabel = period === "daily" ? "today" : "this month";
  return [
    `🧠 *You've reached ${periodLabel}'s smart entry limit (${limit} AI entries/${period === "daily" ? "day" : "month"}).*`,
    "",
    resetNote,
    "",
    "You can still: reply *\"balance\"* · *\"weekly report\"* · *\"debts\"* · *\"subscribe\"*",
    "",
    "━━━━━━━━━━━━━━━━━━━━━━━━",
    "💡 *Upgrade to never hit a wall:*",
    "",
    "━━━━━━━━━━━━━━━━━━━━━━━━",
    `🟢 *ZURIA Growth — GHS ${SUB_PLANS.growth.price}/month*`,
    "   ✅ 500 AI entries per month",
    "   ✅ Monthly profit reports",
    "   ✅ AI sales insights in local language",
    "   ✅ Auto debt reminders & inventory tracking",
    "",
    `🔵 *ZURIA Pro — GHS ${SUB_PLANS.pro.price}/month*`,
    "   ✅ Unlimited AI entries",
    "   ✅ AI forecasting & profit leakage detection",
    "   ✅ Staff accounts & advanced analytics",
    "   ✅ AI business coach",
    "",
    `🟣 *ZURIA Enterprise — GHS ${SUB_PLANS.enterprise.price}/month*`,
    "   ✅ Multi-branch, supplier management",
    "   ✅ Executive dashboards & AI queries",
    "   ✅ Dedicated support & integrations",
    "━━━━━━━━━━━━━━━━━━━━━━━━",
    "",
    "💳 *Your options right now:*",
    `1️⃣  Reply *"subscribe"* → upgrade instantly via Paystack (MoMo, card, bank)`,
    `2️⃣  Reply *"balance"* or *"weekly report"* → still works for free 📊`,
    `3️⃣  Reply *"referrals"* → refer friends & earn Growth for FREE 🎁`,
    "",
    `🌐 Or upgrade directly: ${APP_URL}/subscription`,
    "",
    "📱 *WhatsApp Sandbox:* session expired? Send *join contrast-pull* to rejoin.",
    "   Or switch to Telegram (no expiry): https://t.me/ZuriaBot",
    "",
    period === "monthly"
      ? `Prefer to wait? Your ${limit} entries reset on the 1st of next month.`
      : `Prefer to wait? Come back tomorrow — your ${limit} free entries reset at midnight.`,
    "",
    "━━━━━━━━━━━━━━━━━━━━━━━━",
    "🤝 *Earn Growth for FREE — Refer & Earn!*",
    `Earn *GHS ${REFERRAL_REWARD_GHS.toFixed(2)}* for every friend who joins ZURIA.`,
    "",
    `💵 10 referrals = GHS ${WITHDRAWAL_THRESHOLD_GHS.toFixed(2)} → *withdraw cash to your MoMo*`,
    `🚀 ${MILESTONE_REFERRALS} referrals this month = GHS ${MILESTONE_BALANCE_GHS.toFixed(2)} + *Growth features FREE!*`,
    "",
    ...(referralLink
      ? [`Your referral link 👇`, referralLink]
      : ["Open ZURIA app → Refer & Earn → copy your personal link."]),
    "━━━━━━━━━━━━━━━━━━━━━━━━",
    "",
    `Questions? ${SUPPORT_WA}`,
    `_— ZURIA (${businessName})_`,
  ].join("\n");
}

// ─── Subscription payment received (user replied PAID) ────────────────────────

export function fmtPaymentReceived(
  plan: string,
  businessName = "Your Business"
): string {
  return [
    `✅ *Thanks — we've received your payment notification.*`,
    "",
    `Plan: *${plan}*`,
    "",
    "If you paid via Paystack, your plan activates *automatically* — open the ZURIA app or refresh this chat to confirm.",
    "If it hasn't updated yet, our team will check and activate within *1 hour*. 😊",
    "",
    `💡 _Next time, reply *"subscribe"* to get a direct Paystack link — payment and activation happen instantly with no waiting._`,
    "",
    `Questions? ${SUPPORT_WA}`,
    "",
    `_— ZURIA (${businessName})_`,
  ].join("\n");
}

// ─── Subscription activated (sent when admin activates) ───────────────────────

export function fmtSubscriptionActivated(
  plan: SubscriptionPlan,
  expiresAt: string,
  businessName = "Your Business"
): string {
  const planInfo = SUB_PLANS[plan as keyof typeof SUB_PLANS];
  const expDate = new Date(expiresAt).toLocaleDateString("en-GH", { day: "numeric", month: "long", year: "numeric" });
  const tipLines =
    plan === "growth"
      ? ['📅 Try: *"monthly report"* — your full month\'s profit & expense analysis',
         '📦 Try: *"stock"* — your inventory with restock predictions']
      : plan === "pro"
      ? ['📊 Try: *"full dashboard"* — advanced analytics & AI business health',
         '📅 Try: *"monthly report"* — profit trends, expense heatmaps & more']
      : plan === "enterprise"
      ? ['🏛️ Try: *"full dashboard"* — executive KPIs & multi-branch overview',
         '🤖 Ask me anything: *"Why are my profits down?"*']
      : [];

  return [
    `🎉 *You are now on ${planInfo?.label ?? plan}!*`,
    "",
    `Valid until: *${expDate}*`,
    "",
    "Your business memory just got a major upgrade. 🚀",
    "",
    ...tipLines,
    "",
    "_Thank you for investing in your business. ZURIA is with you! 💙_",
    "",
    `_— ZURIA (${businessName})_`,
  ].filter((l, i, arr) => !(l === "" && arr[i - 1] === "")).join("\n");
}

// ─── End-of-day report (free + all paid tiers) ───────────────────────────────
// Strictly today's transactions only — never mixes other days

export function fmtEndOfDayReport(
  allTransactions: Transaction[],
  ownerName: string,
  category: BusinessCategory = "provision",
  businessName = "Your Business",
  referralLink?: string,
  referralBalance = 0,
  monthlyReferrals = 0,
  openDebtCount = 0,
  openDebtTotal = 0
): string {
  const voice = getVoice(category);
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const todays = allTransactions.filter((t) => t.createdAt.startsWith(today));
  const firstName = ownerName.split(" ")[0];
  const dateStr = now.toLocaleDateString("en-GH", {
    weekday: "long", day: "numeric", month: "long",
  });

  // Yesterday for comparison
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);
  const yesterdays = allTransactions.filter((t) => t.createdAt.startsWith(yesterdayStr));
  const yesterdayRevenue = sum(yesterdays.filter((t) => REVENUE_TYPES.includes(t.type)));

  const header = `📊 *End-of-Day Report — ${dateStr}*`;

  if (todays.length === 0) {
    return [
      header,
      `_For: ${businessName}_`,
      "",
      "No transactions recorded today. 😊",
      "",
      "Start recording to see your end-of-day report.",
      "",
      sig(businessName),
    ].join("\n");
  }

  const moneyIn        = sum(todays.filter((t) => MONEY_IN_TYPES.includes(t.type)));
  const moneyOut       = sum(todays.filter((t) => MONEY_OUT_TYPES.includes(t.type)));
  const salesRevenue   = sum(todays.filter((t) => REVENUE_TYPES.includes(t.type)));
  const operatingCosts = sum(todays.filter((t) => OPERATING_COST_TYPES.includes(t.type)));
  const tradingProfit  = salesRevenue - operatingCosts;
  const netCash        = moneyIn - moneyOut;
  const txCount        = todays.length;

  const lines = [
    header,
    `_For: ${businessName}_`,
    "",
    `📅 *${dateStr}*`,
    `📝 Total entries recorded: *${txCount}*`,
    "",
    `${voice.revenueIcon} *${voice.revenueSection}:*     ${GHS(salesRevenue)}`,
    operatingCosts > 0 ? `🔴 *Total costs:*              ${GHS(operatingCosts)}` : null,
    `─────────────────`,
  ].filter(Boolean) as string[];

  if (tradingProfit > 0) {
    lines.push(`✅ *${voice.profitLabel}: +${GHS(tradingProfit)}* 🎉`);
    if (salesRevenue > 0) {
      const margin = Math.round((tradingProfit / salesRevenue) * 100);
      lines.push(`📊 _Profit margin: ${margin}%_`);
    }
  } else if (tradingProfit < 0) {
    lines.push(`📉 *Loss: -${GHS(Math.abs(tradingProfit))}* — costs exceed revenue`);
  } else {
    lines.push(`🔄 *Break even* — revenue matched costs`);
  }

  // vs Yesterday
  if (yesterdayRevenue > 0 && salesRevenue > 0) {
    const diff = salesRevenue - yesterdayRevenue;
    const pct = Math.abs(Math.round((diff / yesterdayRevenue) * 100));
    const vsYest = diff > 0
      ? `📈 _${pct}% more than yesterday (${GHS(yesterdayRevenue)})_`
      : diff < 0
      ? `📉 _${pct}% less than yesterday (${GHS(yesterdayRevenue)})_`
      : `↔️ _Same as yesterday (${GHS(yesterdayRevenue)})_`;
    lines.push(vsYest);
  }

  const financingIn  = moneyIn - salesRevenue;
  const financingOut = moneyOut - operatingCosts;
  if (financingIn > 0 || financingOut > 0) {
    lines.push("", "💼 *Other money today:*");
    if (financingIn > 0)  lines.push(`   💳 Loans/investments in: +${GHS(financingIn)}`);
    if (financingOut > 0) lines.push(`   💸 Loans/withdrawals out: -${GHS(financingOut)}`);
    lines.push("");
    lines.push(netCash > 0 ? `💰 *Net cash today: +${GHS(netCash)}*` : `📉 *Net cash today: -${GHS(Math.abs(netCash))}*`);
  }

  const topProduct = getTopProduct(todays);
  if (topProduct) lines.push("", `🏆 *${voice.bestLabel}: ${topProduct}*`);

  // Top customer today
  const topCustomerToday = getTopCustomer(todays);
  if (topCustomerToday) lines.push(`👤 *Top customer: ${topCustomerToday[0]}* (${GHS(topCustomerToday[1])})`);

  // Cost breakdown for today (only when there are 2+ cost types)
  if (operatingCosts > 0) {
    const todayCostBreakdown: Record<string, number> = {};
    todays.filter((t) => OPERATING_COST_TYPES.includes(t.type)).forEach((t) => {
      const label = TRANSACTION_TYPE_LABELS[t.type] ?? t.type;
      todayCostBreakdown[label] = (todayCostBreakdown[label] ?? 0) + t.amount;
    });
    const costEntries = Object.entries(todayCostBreakdown).sort(([, a], [, b]) => b - a);
    if (costEntries.length > 1) {
      lines.push("", "🔍 *Costs today:*");
      costEntries.slice(0, 4).forEach(([label, amt]) => lines.push(`   • ${label}: ${GHS(amt)}`));
    }
  }

  // ── Debt reminder ─────────────────────────────────────────────────────────
  if (openDebtCount > 0) {
    lines.push(
      "",
      `📋 *${openDebtCount} customer${openDebtCount !== 1 ? "s" : ""} owe${openDebtCount === 1 ? "s" : ""} you ${GHS(openDebtTotal)}* — type _"who owes me"_ to see the list.`
    );
  }

  // ── Smart referral tip based on current balance/progress ────────────────
  const referralTip = buildReferralTip(referralBalance, monthlyReferrals, referralLink, "short");

  lines.push(
    "",
    tradingProfit > 0
      ? `_Well done today, ${firstName}! 💪 See you tomorrow!_`
      : tradingProfit < 0
      ? `_Keep going ${firstName} — tomorrow is a new day! 💙_`
      : `_Solid day, ${firstName}! Every record counts. 😊_`,
    "",
    referralTip,
    "",
    sig(businessName)
  );

  return lines.join("\n");
}

// ─── Weekly report (Small, Medium, Large tiers) ───────────────────────────────

export function fmtWeeklyReport(
  allTransactions: Transaction[],
  ownerName: string,
  category: BusinessCategory = "provision",
  businessName = "Your Business",
  referralLink?: string,
  referralBalance = 0,
  monthlyReferrals = 0,
  openDebtCount = 0,
  openDebtTotal = 0,
  overdueDebt7Count = 0,   // debts older than 7 days
  overdueDebt30Count = 0   // debts older than 30 days
): string {
  const voice = getVoice(category);
  const firstName = ownerName.split(" ")[0];

  // Compute the start of the current week (Monday)
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon...
  const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - daysFromMonday);
  weekStart.setHours(0, 0, 0, 0);
  const weekStartStr = weekStart.toISOString().slice(0, 10);

  // Last week window for trend comparison
  const lastWeekStart = new Date(weekStart);
  lastWeekStart.setDate(lastWeekStart.getDate() - 7);
  const lastWeekStartStr = lastWeekStart.toISOString().slice(0, 10);
  const lastWeek = allTransactions.filter(
    (t) => t.createdAt.slice(0, 10) >= lastWeekStartStr && t.createdAt.slice(0, 10) < weekStartStr
  );
  const lastWeekRevenue = sum(lastWeek.filter((t) => REVENUE_TYPES.includes(t.type)));
  const lastWeekCosts   = sum(lastWeek.filter((t) => OPERATING_COST_TYPES.includes(t.type)));
  const lastWeekProfit  = lastWeekRevenue - lastWeekCosts;

  const weekly = allTransactions.filter((t) => t.createdAt.slice(0, 10) >= weekStartStr);
  const weekRangeLabel = weekStart.toLocaleDateString("en-GH", { day: "numeric", month: "short" }) +
    " – " + now.toLocaleDateString("en-GH", { day: "numeric", month: "short", year: "numeric" });

  const header = `📊 *Weekly Report — ${weekRangeLabel}*`;

  if (weekly.length === 0) {
    return [
      header,
      `_For: ${businessName}_`,
      "",
      `No transactions recorded this week yet, ${firstName}.`,
      "",
      "Record your first entry today and ZURIA will track the whole week for you.",
      "_Just send something like \"Sold rice 120\" and I'll do the rest! 💪_",
      "",
      sig(businessName),
    ].join("\n");
  }

  const moneyIn        = sum(weekly.filter((t) => MONEY_IN_TYPES.includes(t.type)));
  const moneyOut       = sum(weekly.filter((t) => MONEY_OUT_TYPES.includes(t.type)));
  const salesRevenue   = sum(weekly.filter((t) => REVENUE_TYPES.includes(t.type)));
  const operatingCosts = sum(weekly.filter((t) => OPERATING_COST_TYPES.includes(t.type)));
  const tradingProfit  = salesRevenue - operatingCosts;
  const netCash        = moneyIn - moneyOut;

  // Breakdown by day
  const byDay = new Map<string, { in: number; out: number; profit: number }>();
  for (let d = new Date(weekStart); d <= now; d.setDate(d.getDate() + 1)) {
    const dayStr = d.toISOString().slice(0, 10);
    const dayTxns = weekly.filter((t) => t.createdAt.startsWith(dayStr));
    const dayIn = sum(dayTxns.filter((t) => REVENUE_TYPES.includes(t.type)));
    const dayOut = sum(dayTxns.filter((t) => OPERATING_COST_TYPES.includes(t.type)));
    byDay.set(dayStr, { in: dayIn, out: dayOut, profit: dayIn - dayOut });
  }

  // Best day of the week
  const bestDayEntry = Array.from(byDay.entries())
    .filter(([, v]) => v.in > 0)
    .sort(([, a], [, b]) => b.in - a.in)[0];

  const weekMarginLine = (tradingProfit > 0 && salesRevenue > 0)
    ? `📊 _Profit margin this week: ${Math.round((tradingProfit / salesRevenue) * 100)}%_`
    : null;

  const lines = [
    header,
    `_For: ${businessName}_`,
    "",
    `${voice.revenueIcon} *Total ${voice.revenueSection}:*   ${GHS(salesRevenue)}`,
    operatingCosts > 0 ? `🔴 *Total costs:*              ${GHS(operatingCosts)}` : null,
    `─────────────────`,
    tradingProfit > 0 ? `✅ *Weekly ${voice.profitLabel}: +${GHS(tradingProfit)}* 🎉`
      : tradingProfit < 0 ? `📉 *Weekly Loss: -${GHS(Math.abs(tradingProfit))}*`
      : `🔄 *Break even this week*`,
    weekMarginLine,
  ].filter(Boolean) as string[];

  // vs Last week trend
  if (lastWeekRevenue > 0 && salesRevenue > 0) {
    const revDiff = salesRevenue - lastWeekRevenue;
    const revPct  = Math.abs(Math.round((revDiff / lastWeekRevenue) * 100));
    lines.push(
      revDiff > 0
        ? `📈 _Revenue up ${revPct}% vs last week (${GHS(lastWeekRevenue)})_`
        : revDiff < 0
        ? `📉 _Revenue down ${revPct}% vs last week (${GHS(lastWeekRevenue)})_`
        : `↔️ _Same revenue as last week_`
    );
  }
  if (lastWeekProfit !== 0 && tradingProfit !== 0) {
    const profDiff = tradingProfit - lastWeekProfit;
    const profPct  = Math.abs(Math.round((profDiff / Math.abs(lastWeekProfit)) * 100));
    lines.push(
      profDiff > 0
        ? `📈 _Profit up ${profPct}% vs last week_`
        : `📉 _Profit down ${profPct}% vs last week_`
    );
  }

  if (moneyIn !== salesRevenue || moneyOut !== operatingCosts) {
    lines.push("", "💼 *Total cash movement:*");
    lines.push(`   💚 All money in:  +${GHS(moneyIn)}`);
    lines.push(`   🔴 All money out: -${GHS(moneyOut)}`);
    lines.push(netCash >= 0 ? `   💰 Net: +${GHS(netCash)}` : `   📉 Net: -${GHS(Math.abs(netCash))}`);
  }

  lines.push("", "📅 *Daily breakdown:*");
  byDay.forEach((v, dateStr) => {
    const label = new Date(dateStr + "T00:00:00").toLocaleDateString("en-GH", { weekday: "short", day: "numeric" });
    if (v.in === 0 && v.out === 0) {
      lines.push(`   ${label}: — (no records)`);
    } else {
      const sign = v.profit >= 0 ? "+" : "-";
      lines.push(`   ${label}: ${GHS(v.in)} in | ${GHS(v.out)} out | ${sign}${GHS(Math.abs(v.profit))}`);
    }
  });

  // Best day callout
  if (bestDayEntry) {
    const [bestDayStr] = bestDayEntry;
    const bestLabel = new Date(bestDayStr + "T00:00:00").toLocaleDateString("en-GH", { weekday: "long" });
    lines.push("", `🏅 *Best day this week: ${bestLabel}* (${GHS(bestDayEntry[1].in)})`);
  }

  const topProduct = getTopProduct(weekly);
  if (topProduct) lines.push(`🏆 *${voice.bestLabel} this week: ${topProduct}*`);

  // Weekly cost breakdown (only when there are 2+ types)
  if (operatingCosts > 0) {
    const weekCostBreakdown: Record<string, number> = {};
    weekly.filter((t) => OPERATING_COST_TYPES.includes(t.type)).forEach((t) => {
      const label = TRANSACTION_TYPE_LABELS[t.type] ?? t.type;
      weekCostBreakdown[label] = (weekCostBreakdown[label] ?? 0) + t.amount;
    });
    const costEntries = Object.entries(weekCostBreakdown).sort(([, a], [, b]) => b - a);
    if (costEntries.length > 1) {
      lines.push("", "🔍 *Cost breakdown this week:*");
      costEntries.slice(0, 5).forEach(([label, amt]) => lines.push(`   • ${label}: ${GHS(amt)}`));
    }
    // AI cost efficiency tip
    if (tradingProfit < 0 && costEntries[0]) {
      lines.push("", `💡 _Biggest cost: "${costEntries[0][0]}" (${GHS(costEntries[0][1])}). Reducing this could flip your week!_`);
    }
  }

  // ── Overdue debt summary ─────────────────────────────────────────────────
  if (overdueDebt30Count > 0) {
    lines.push(
      "",
      `🚨 *${overdueDebt30Count} debt${overdueDebt30Count !== 1 ? "s" : ""} are 30+ days overdue!* Type _"who owes me"_ to follow up.`
    );
  } else if (overdueDebt7Count > 0) {
    lines.push(
      "",
      `⚠️ *${overdueDebt7Count} debt${overdueDebt7Count !== 1 ? "s" : ""} unpaid for 7+ days.* Type _"who owes me"_ to see the list.`
    );
  } else if (openDebtCount > 0) {
    lines.push(
      "",
      `📋 *${openDebtCount} customer${openDebtCount !== 1 ? "s" : ""} owe${openDebtCount === 1 ? "s" : ""} you ${GHS(openDebtTotal)} total.* Type _"who owes me"_ to review.`
    );
  }

  // Trend note
  const txCount = weekly.length;
  const referralTip = buildReferralTip(referralBalance, monthlyReferrals, referralLink, "medium");

  lines.push(
    "",
    `📝 Total entries this week: *${txCount}*`,
    "",
    tradingProfit > 0
      ? `_Great week, ${firstName}! You are making profit — keep that energy going! 💪_`
      : tradingProfit < 0
      ? `_This week's costs were higher than your sales, ${firstName}. Don't be discouraged — review your spending and come back stronger next week! 💙_`
      : `_You broke even this week, ${firstName}. That means your money is working — now let's push a little harder and get into profit next week! 🚀_`,
    "",
    referralTip,
    "",
    sig(businessName)
  );

  return lines.join("\n");
}

// ─── Monthly report (Medium, Large tiers) ────────────────────────────────────

export function fmtMonthlyReport(
  allTransactions: Transaction[],
  ownerName: string,
  category: BusinessCategory = "provision",
  businessName = "Your Business",
  referralLink?: string,
  referralBalance = 0,
  monthlyReferrals = 0,
  openDebtCount = 0,
  openDebtTotal = 0,
  overdueDebt7Count = 0,
  overdueDebt30Count = 0
): string {
  const voice = getVoice(category);
  const firstName = ownerName.split(" ")[0];
  const now = new Date();
  const thisMonth = now.toISOString().slice(0, 7); // "YYYY-MM"
  const monthLabel = now.toLocaleDateString("en-GH", { month: "long", year: "numeric" });

  const monthly = allTransactions.filter((t) => t.createdAt.startsWith(thisMonth));

  const header = `📊 *Monthly Report — ${monthLabel}*`;

  if (monthly.length === 0) {
    return [
      header,
      `_For: ${businessName}_`,
      "",
      `No transactions recorded for ${monthLabel} yet, ${firstName}.`,
      "",
      "Start recording today and ZURIA will build your full monthly report automatically.",
      '_Just send something like "Sold rice 120" or "Paid ECG 80" — I\'ll handle the rest! 😊_',
      "",
      sig(businessName),
    ].join("\n");
  }

  const moneyIn        = sum(monthly.filter((t) => MONEY_IN_TYPES.includes(t.type)));
  const moneyOut       = sum(monthly.filter((t) => MONEY_OUT_TYPES.includes(t.type)));
  const salesRevenue   = sum(monthly.filter((t) => REVENUE_TYPES.includes(t.type)));
  const operatingCosts = sum(monthly.filter((t) => OPERATING_COST_TYPES.includes(t.type)));
  const tradingProfit  = salesRevenue - operatingCosts;
  const netCash        = moneyIn - moneyOut;

  // Previous month data for comparison
  const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonth = prevMonthDate.toISOString().slice(0, 7);
  const prevMonthly = allTransactions.filter((t) => t.createdAt.startsWith(prevMonth));
  const prevRevenue = sum(prevMonthly.filter((t) => REVENUE_TYPES.includes(t.type)));
  const prevCosts   = sum(prevMonthly.filter((t) => OPERATING_COST_TYPES.includes(t.type)));
  const prevProfit  = prevRevenue - prevCosts;
  const prevMargin  = prevRevenue > 0 ? Math.round((prevProfit / prevRevenue) * 100) : null;
  const thisMargin  = salesRevenue > 0 ? Math.round((tradingProfit / salesRevenue) * 100) : null;

  // Active trading days & average daily revenue
  const activeDaysSet = new Set(monthly.map((t) => t.createdAt.slice(0, 10)));
  const activeDays = activeDaysSet.size;
  const avgDailyRevenue = activeDays > 0 ? salesRevenue / activeDays : 0;

  // Top customer this month
  const monthCustomerMap = new Map<string, number>();
  monthly.filter((t) => REVENUE_TYPES.includes(t.type) && t.customerName).forEach((t) => {
    monthCustomerMap.set(t.customerName!, (monthCustomerMap.get(t.customerName!) ?? 0) + t.amount);
  });
  const topMonthCustomer = Array.from(monthCustomerMap.entries()).sort(([, a], [, b]) => b - a)[0] as [string, number] | undefined;

  // Category breakdown for costs
  const costBreakdown: Record<string, number> = {};
  monthly.filter((t) => OPERATING_COST_TYPES.includes(t.type)).forEach((t) => {
    const label = TRANSACTION_TYPE_LABELS[t.type] ?? t.type;
    costBreakdown[label] = (costBreakdown[label] ?? 0) + t.amount;
  });

  // Weekly sub-totals within the month
  const weeklyTotals: { label: string; revenue: number; costs: number }[] = [];
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const weeksInMonth = Math.ceil(daysInMonth / 7);
  for (let w = 0; w < weeksInMonth; w++) {
    const startDay = w * 7 + 1;
    const endDay = Math.min((w + 1) * 7, now.getDate());
    if (startDay > now.getDate()) break;
    const startStr = `${thisMonth}-${String(startDay).padStart(2, "0")}`;
    const endStr = `${thisMonth}-${String(endDay).padStart(2, "0")}`;
    const wTxns = monthly.filter((t) => t.createdAt.slice(0, 10) >= startStr && t.createdAt.slice(0, 10) <= endStr);
    weeklyTotals.push({
      label: `Week ${w + 1} (${startDay}–${endDay})`,
      revenue: sum(wTxns.filter((t) => REVENUE_TYPES.includes(t.type))),
      costs: sum(wTxns.filter((t) => OPERATING_COST_TYPES.includes(t.type))),
    });
  }

  const lines = [
    header,
    `_For: ${businessName}_`,
    "",
    "━━━━━━━━━━━━━━━━━━━",
    "💼 *Income Statement*",
    "━━━━━━━━━━━━━━━━━━━",
    `${voice.revenueIcon} *${voice.revenueSection}:*     ${GHS(salesRevenue)}`,
    prevRevenue > 0 && salesRevenue > 0
      ? (salesRevenue >= prevRevenue
          ? `   📈 _Up ${Math.round(((salesRevenue - prevRevenue) / prevRevenue) * 100)}% vs last month (${GHS(prevRevenue)})_`
          : `   📉 _Down ${Math.round(((prevRevenue - salesRevenue) / prevRevenue) * 100)}% vs last month (${GHS(prevRevenue)})_`)
      : null,
    operatingCosts > 0 ? `🔴 *Operating costs:*         ${GHS(operatingCosts)}` : null,
    `─────────────────`,
    tradingProfit > 0 ? `✅ *${voice.profitLabel}: +${GHS(tradingProfit)}*`
      : tradingProfit < 0 ? `📉 *Loss: -${GHS(Math.abs(tradingProfit))}*`
      : `🔄 *Break even*`,
    thisMargin !== null
      ? (prevMargin !== null
          ? `📊 _Profit margin: ${thisMargin}% ${thisMargin >= prevMargin ? `▲` : `▼`} (was ${prevMargin}% last month)_`
          : `📊 _Profit margin: ${thisMargin}%_`)
      : null,
  ].filter(Boolean) as string[];

  if (moneyIn !== salesRevenue || moneyOut !== operatingCosts) {
    lines.push("", "━━━━━━━━━━━━━━━━━━━", "💰 *Cash Flow*", "━━━━━━━━━━━━━━━━━━━");
    lines.push(`💚 Total money in:  ${GHS(moneyIn)}`);
    lines.push(`🔴 Total money out: ${GHS(moneyOut)}`);
    lines.push(`─────────────────`);
    lines.push(netCash >= 0 ? `💰 *Net cash: +${GHS(netCash)}*` : `📉 *Net cash: -${GHS(Math.abs(netCash))}*`);
  }

  if (Object.keys(costBreakdown).length > 1) {
    lines.push("", "━━━━━━━━━━━━━━━━━━━", "🔍 *Cost Breakdown*", "━━━━━━━━━━━━━━━━━━━");
    Object.entries(costBreakdown)
      .sort(([, a], [, b]) => b - a)
      .forEach(([label, amt]) => lines.push(`   • ${label}: ${GHS(amt)}`));
  }

  if (weeklyTotals.length > 1) {
    lines.push("", "━━━━━━━━━━━━━━━━━━━", "📅 *Weekly Breakdown*", "━━━━━━━━━━━━━━━━━━━");
    weeklyTotals.forEach((w) => {
      const profit = w.revenue - w.costs;
      lines.push(`${w.label}:`);
      lines.push(`   Revenue: ${GHS(w.revenue)} | Costs: ${GHS(w.costs)} | Net: ${profit >= 0 ? "+" : "-"}${GHS(Math.abs(profit))}`);
    });
  }

  const topProduct = getTopProduct(monthly);
  if (topProduct) lines.push("", `🏆 *${voice.bestLabel} this month: ${topProduct}*`);
  if (topMonthCustomer) lines.push(`👑 *Top customer: ${topMonthCustomer[0]}* (${GHS(topMonthCustomer[1])})`);

  // Activity stats
  lines.push(
    "",
    "━━━━━━━━━━━━━━━━━━━",
    "📆 *Activity Stats*",
    "━━━━━━━━━━━━━━━━━━━",
    `📝 Total entries: *${monthly.length}*`,
    `🗓️ Trading days:  *${activeDays}* day${activeDays !== 1 ? "s" : ""}`,
  );
  if (avgDailyRevenue > 0) lines.push(`📊 Avg daily ${voice.revenueSection.toLowerCase()}: *${GHS(avgDailyRevenue)}*`);

  // Business health score (0-100) based on profit margin
  let healthScore = 50;
  if (salesRevenue > 0) {
    const margin = (tradingProfit / salesRevenue) * 100;
    healthScore = Math.min(100, Math.max(0, Math.round(50 + margin * 0.5)));
  }
  const healthEmoji = healthScore >= 70 ? "🟢" : healthScore >= 40 ? "🟡" : "🔴";
  const healthLabel = healthScore >= 70 ? "Healthy" : healthScore >= 40 ? "Moderate" : "Needs attention";

  lines.push(
    "",
    "━━━━━━━━━━━━━━━━━━━",
    `${healthEmoji} *Business Health: ${healthScore}/100 — ${healthLabel}*`,
    "━━━━━━━━━━━━━━━━━━━"
  );

  // AI advisor tip — context-aware based on profitability
  if (tradingProfit < 0) {
    const worstCostEntry = Object.entries(costBreakdown).sort(([,a],[,b]) => b - a)[0];
    lines.push(
      "",
      "━━━━━━━━━━━━━━━━━━━",
      "🧠 *Your Business Advisor Says*",
      "━━━━━━━━━━━━━━━━━━━",
      worstCostEntry
        ? `💡 _${firstName}, your biggest cost this month is "${worstCostEntry[0]}" at ${GHS(worstCostEntry[1])}. That's eating into your earnings. Try to reduce it next month — even a small cut there will make a big difference to your pocket._`
        : `💡 _${firstName}, your costs have overtaken your sales this month. Sit down and go through every expense — cut anything that isn't making you money. Every cedi counts!_`
    );
  } else if (salesRevenue > 0 && tradingProfit / salesRevenue < 0.10) {
    lines.push(
      "",
      "━━━━━━━━━━━━━━━━━━━",
      "🧠 *Your Business Advisor Says*",
      "━━━━━━━━━━━━━━━━━━━",
      `💡 _${firstName}, a ${Math.round((tradingProfit/salesRevenue)*100)}% margin means you are working hard but keeping little. Consider raising your prices by 5–10% or renegotiating with your suppliers. Small price changes add up fast._`
    );
  } else if (salesRevenue > 0 && tradingProfit / salesRevenue < 0.25) {
    lines.push(
      "",
      "━━━━━━━━━━━━━━━━━━━",
      "🧠 *Your Business Advisor Says*",
      "━━━━━━━━━━━━━━━━━━━",
      `💡 _Good going, ${firstName}! A ${Math.round((tradingProfit/salesRevenue)*100)}% margin is decent — but there's room to grow. Push your best-selling product harder and follow up on any unpaid debts. Those two actions alone can move your margin up._`
    );
  } else if (tradingProfit > 0) {
    lines.push(
      "",
      "━━━━━━━━━━━━━━━━━━━",
      "🧠 *Your Business Advisor Says*",
      "━━━━━━━━━━━━━━━━━━━",
      `💡 _Excellent work, ${firstName}! A ${Math.round((tradingProfit/salesRevenue)*100)}% profit margin is strong. Consider putting ${GHS(tradingProfit * 0.2)} back into restocking your top items — businesses that reinvest consistently are the ones that grow. You're doing this right! 🇬🇭_`
    );
  }

  // ── Overdue debt summary ─────────────────────────────────────────────────
  if (overdueDebt30Count > 0) {
    lines.push(
      "",
      "━━━━━━━━━━━━━━━━━━━",
      `🚨 *Overdue debts: ${overdueDebt30Count} customer${overdueDebt30Count !== 1 ? "s" : ""} owe${overdueDebt30Count === 1 ? "s" : ""} you for 30+ days*`,
      `_Type "who owes me" to review and chase them up. Old debts can become bad debts!_`,
      "━━━━━━━━━━━━━━━━━━━"
    );
  } else if (overdueDebt7Count > 0) {
    lines.push(
      "",
      `⚠️ *${overdueDebt7Count} debt${overdueDebt7Count !== 1 ? "s" : ""} unpaid for 7+ days* — type _"who owes me"_ to follow up.`
    );
  } else if (openDebtCount > 0) {
    lines.push(
      "",
      `📋 *Outstanding debts: ${openDebtCount} customer${openDebtCount !== 1 ? "s" : ""}, ${GHS(openDebtTotal)} total* — type _"who owes me"_ to review.`
    );
  }

  const referralSection = buildReferralTip(referralBalance, monthlyReferrals, referralLink, "full");

  lines.push(
    "",
    tradingProfit > 0
      ? `_Excellent month, ${firstName}! 🎉 ZURIA is proud of you! Keep growing!_`
      : `_Every month is a chance to improve, ${firstName}. I'm tracking everything for you. 💙_`,
    "",
    referralSection,
    "",
    sig(businessName)
  );

  return lines.join("\n");
}

// ─── Large-tier: Full financial dashboard ────────────────────────────────────

export function fmtFullDashboard(
  allTransactions: Transaction[],
  ownerName: string,
  category: BusinessCategory = "provision",
  businessName = "Your Business",
  plan: SubscriptionPlan = "pro"
): string {
  const voice = getVoice(category);
  const firstName = ownerName.split(" ")[0];
  const now = new Date();
  const thisMonth = now.toISOString().slice(0, 7);
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 7);

  const thisMonthTxns = allTransactions.filter((t) => t.createdAt.startsWith(thisMonth));
  const lastMonthTxns = allTransactions.filter((t) => t.createdAt.startsWith(lastMonth));

  const thisRevenue = sum(thisMonthTxns.filter((t) => REVENUE_TYPES.includes(t.type)));
  const lastRevenue = sum(lastMonthTxns.filter((t) => REVENUE_TYPES.includes(t.type)));
  const thisCosts   = sum(thisMonthTxns.filter((t) => OPERATING_COST_TYPES.includes(t.type)));
  const thisProfit  = thisRevenue - thisCosts;
  const lastCosts   = sum(lastMonthTxns.filter((t) => OPERATING_COST_TYPES.includes(t.type)));
  const lastProfit  = lastRevenue - lastCosts;

  const revTrend = lastRevenue > 0
    ? ((thisRevenue - lastRevenue) / lastRevenue * 100).toFixed(1)
    : null;
  const profitTrend = lastProfit !== 0
    ? ((thisProfit - lastProfit) / Math.abs(lastProfit) * 100).toFixed(1)
    : null;

  // Profit margin
  const thisProfitMargin = thisRevenue > 0 ? Math.round((thisProfit / thisRevenue) * 100) : null;
  const lastProfitMargin = lastRevenue > 0 ? Math.round((lastProfit / lastRevenue) * 100) : null;

  // Active trading days & cash runway
  const activeDaysSet = new Set(thisMonthTxns.map((t) => t.createdAt.slice(0, 10)));
  const activeDays = activeDaysSet.size;
  const avgDailyCosts = activeDays > 0 ? thisCosts / activeDays : 0;
  // Runway: how many days of costs are covered by this month's profit?
  const runwayDays = avgDailyCosts > 0 && thisProfit > 0
    ? Math.floor(thisProfit / avgDailyCosts)
    : null;

  // Top product this month
  const thisMonthTopProduct = getTopProduct(thisMonthTxns);

  // Customer loyalty (top buyers by amount)
  const customerMap = new Map<string, number>();
  allTransactions.filter((t) => REVENUE_TYPES.includes(t.type) && t.customerName).forEach((t) => {
    customerMap.set(t.customerName!, (customerMap.get(t.customerName!) ?? 0) + t.amount);
  });
  const topCustomers = Array.from(customerMap.entries())
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);

  const monthLabel = now.toLocaleDateString("en-GH", { month: "long", year: "numeric" });
  const header = `📊 *Full Business Dashboard — ${monthLabel}*`;

  const lines = [
    header,
    `_For: ${businessName} | ${plan === "enterprise" ? "ZURIA Enterprise" : "ZURIA Pro"}_`,
    "",
    "━━━━━━━━━━━━━━━━━━━",
    "📈 *This Month vs Last Month*",
    "━━━━━━━━━━━━━━━━━━━",
    `${voice.revenueIcon} Revenue:  ${GHS(thisRevenue)}${revTrend ? ` (${Number(revTrend) >= 0 ? "▲" : "▼"}${Math.abs(Number(revTrend))}% vs last month)` : ""}`,
    `🔴 Costs:    ${GHS(thisCosts)}`,
    `─────────────────`,
    thisProfit >= 0
      ? `✅ Profit:  +${GHS(thisProfit)}${profitTrend ? ` (${Number(profitTrend) >= 0 ? "▲" : "▼"}${Math.abs(Number(profitTrend))}%)` : ""}`
      : `📉 Loss:   -${GHS(Math.abs(thisProfit))}`,
    thisProfitMargin !== null
      ? `📊 _Margin: ${thisProfitMargin}%${lastProfitMargin !== null ? ` (was ${lastProfitMargin}% last month)` : ""}_`
      : null,
    thisMonthTopProduct ? `🏆 _Top product: ${thisMonthTopProduct}_` : null,
    runwayDays !== null && runwayDays > 0
      ? `🏃 _Profit runway: ~${runwayDays} days of costs covered by this month's profit_`
      : null,
  ].filter(Boolean) as string[];

  if (topCustomers.length > 0) {
    lines.push("", "━━━━━━━━━━━━━━━━━━━", "👑 *Top Customers (All Time)*", "━━━━━━━━━━━━━━━━━━━");
    topCustomers.forEach(([name, total], i) => {
      lines.push(`${i + 1}. ${name} — ${GHS(total)}`);
    });
  }

  const allRevenue  = sum(allTransactions.filter((t) => REVENUE_TYPES.includes(t.type)));
  const allCosts    = sum(allTransactions.filter((t) => OPERATING_COST_TYPES.includes(t.type)));
  const allProfit   = allRevenue - allCosts;
  const allMoneyIn  = sum(allTransactions.filter((t) => MONEY_IN_TYPES.includes(t.type)));
  const allMoneyOut = sum(allTransactions.filter((t) => MONEY_OUT_TYPES.includes(t.type)));
  const allMargin   = allRevenue > 0 ? Math.round((allProfit / allRevenue) * 100) : null;

  // Profit velocity — is momentum accelerating or decelerating?
  const velocitySign = thisProfit > lastProfit ? "▲" : thisProfit < lastProfit ? "▼" : "↔️";
  const velocityNote = (thisRevenue > 0 && lastRevenue > 0)
    ? `${velocitySign} Profit velocity: ${thisProfit > lastProfit ? "accelerating" : thisProfit < lastProfit ? "decelerating" : "stable"} vs last month`
    : null;

  const allTimeLines: (string | null)[] = [
    "", "━━━━━━━━━━━━━━━━━━━", "🏛️ *All-Time Business Totals*", "━━━━━━━━━━━━━━━━━━━",
    `💰 Total revenue:   ${GHS(allRevenue)}`,
    `🔴 Total costs:     ${GHS(allCosts)}`,
    `─────────────────`,
    allProfit >= 0 ? `✅ All-time profit: +${GHS(allProfit)}` : `📉 All-time loss: -${GHS(Math.abs(allProfit))}`,
    allMargin !== null ? `📊 _Overall margin: ${allMargin}%_` : null,
    velocityNote ? `📈 _${velocityNote}_` : null,
    ``,
    `💼 All money received: ${GHS(allMoneyIn)}`,
    `💸 All money paid out: ${GHS(allMoneyOut)}`,
    `📝 Total transactions: ${allTransactions.length}`,
    "",
    "━━━━━━━━━━━━━━━━━━━",
    `_${firstName}, every number in this report represents hard work you put into your business. ZURIA is here to make sure that work pays off. Keep building! 💙_`,
    `_Questions or need advice? ${SUPPORT_WA}_`,
    "",
    sig(businessName),
  ];
  lines.push(...(allTimeLines.filter(Boolean) as string[]));

  return lines.join("\n");
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Builds a context-aware referral tip for the bottom of WhatsApp reports.
 *
 * mode:
 *  "short"  — one-liner (end-of-day)
 *  "medium" — two lines (weekly)
 *  "full"   — full section with separator (monthly)
 */
function buildReferralTip(
  balance: number,
  monthlyReferrals: number,
  referralLink: string | undefined,
  mode: "short" | "medium" | "full"
): string {
  const canWithdraw = balance >= WITHDRAWAL_THRESHOLD_GHS;
  const hitMilestone = balance >= MILESTONE_BALANCE_GHS || monthlyReferrals >= MILESTONE_REFERRALS;
  const remaining30 = Math.max(0, MILESTONE_REFERRALS - monthlyReferrals);
  const remainingCash = parseFloat((WITHDRAWAL_THRESHOLD_GHS - balance).toFixed(2));
  const referralsToWithdraw = Math.max(0, Math.ceil(remainingCash / REFERRAL_REWARD_GHS));

  const linkLine = referralLink
    ? `Your link: ${referralLink}`
    : `Open ZURIA app → Refer & Earn → copy your link.`;

  if (mode === "short") {
    if (hitMilestone) {
      return `🏆 _You've hit the GHS ${MILESTONE_BALANCE_GHS.toFixed(2)} milestone! Growth features unlocked — well done!_`;
    }
    if (canWithdraw) {
      return `💰 _You can withdraw GHS ${balance.toFixed(2)} now, OR refer ${remaining30} more this month for GHS ${MILESTONE_BALANCE_GHS.toFixed(2)} + Growth FREE!_`;
    }
    return `💡 _Refer ${referralsToWithdraw} more friend${referralsToWithdraw !== 1 ? "s" : ""} to reach GHS ${WITHDRAWAL_THRESHOLD_GHS.toFixed(2)} cash out. 30 this month = Growth FREE! ${referralLink ?? ""}`.trim() + `_`;
  }

  if (mode === "medium") {
    if (hitMilestone) {
      return [
        `🏆 *Referral milestone reached!* GHS ${balance.toFixed(2)} earned this month.`,
        `Growth features unlocked — keep sharing! ${referralLink ?? ""}`,
      ].join("\n").trim();
    }
    if (canWithdraw) {
      return [
        `💰 _Earn more: ${remaining30} referrals left to unlock Growth FREE + earn GHS ${MILESTONE_BALANCE_GHS.toFixed(2)}._`,
        referralLink ? referralLink : `Open ZURIA app → Refer & Earn.`,
      ].join("\n");
    }
    return [
      `💡 _Refer friends → earn GHS ${REFERRAL_REWARD_GHS.toFixed(2)}/each. ${referralsToWithdraw} more = withdraw cash. ${MILESTONE_REFERRALS} this month = Growth FREE!_`,
      referralLink ? referralLink : `Open ZURIA app → Refer & Earn.`,
    ].join("\n");
  }

  // mode === "full" — monthly report section
  const lines: string[] = [
    "━━━━━━━━━━━━━━━━━━━",
    "🤝 *Refer & Earn*",
    "━━━━━━━━━━━━━━━━━━━",
    `Earn *GHS ${REFERRAL_REWARD_GHS.toFixed(2)}* for every business owner you refer to ZURIA.`,
    "",
    `💵 *Path 1:* Refer 10 friends → *GHS ${WITHDRAWAL_THRESHOLD_GHS.toFixed(2)}* → withdraw cash to MoMo`,
    `🚀 *Path 2:* Refer ${MILESTONE_REFERRALS} this month → *GHS ${MILESTONE_BALANCE_GHS.toFixed(2)}* + *Growth features FREE* until month end!`,
    "",
  ];

  if (hitMilestone) {
    lines.push(
      `🏆 *You've already hit the GHS ${MILESTONE_BALANCE_GHS.toFixed(2)} milestone this month!*`,
      `Open ZURIA app → Refer & Earn → Withdraw to get your cash. 🎊`
    );
  } else if (canWithdraw) {
    lines.push(
      `✅ *You can withdraw GHS ${balance.toFixed(2)} now* — or hold for ${remaining30} more referrals`,
      `to unlock Growth FREE + earn GHS ${MILESTONE_BALANCE_GHS.toFixed(2)} total!`
    );
  } else {
    lines.push(`Progress this month: *${monthlyReferrals}/${MILESTONE_REFERRALS}* referrals | *GHS ${balance.toFixed(2)}* earned`);
    if (referralsToWithdraw > 0) lines.push(`_${referralsToWithdraw} more referral${referralsToWithdraw !== 1 ? "s" : ""} = GHS ${WITHDRAWAL_THRESHOLD_GHS.toFixed(2)} cash out_`);
    if (remaining30 > 0) lines.push(`_${remaining30} more this month = GHS ${MILESTONE_BALANCE_GHS.toFixed(2)} + Growth FREE!_`);
  }

  lines.push("", linkLine);
  return lines.join("\n");
}

// ─── Referral status (user typed "referral" / "my link" / "earnings") ────────

export function fmtReferralStatus(
  ownerName: string,
  businessName = "Your Business",
  referralCode = "",
  referralBalance = 0,
  referralCount = 0,
  monthlyReferrals = 0,
  referralLink?: string,
  pendingWithdrawal = false
): string {
  const firstName = ownerName.split(" ")[0];
  const canWithdraw = referralBalance >= WITHDRAWAL_THRESHOLD_GHS;
  const hitMilestone = referralBalance >= MILESTONE_BALANCE_GHS || monthlyReferrals >= MILESTONE_REFERRALS;
  const remaining30 = Math.max(0, MILESTONE_REFERRALS - monthlyReferrals);
  const referralsToWithdraw = Math.max(0, Math.ceil((WITHDRAWAL_THRESHOLD_GHS - referralBalance) / REFERRAL_REWARD_GHS));
  const link = referralLink ?? (referralCode ? `Your referral link: open ZURIA app → Refer & Earn` : undefined);

  const lines: string[] = [
    `💰 *Refer & Earn — ${firstName}*`,
    "",
    `📊 *Your earnings summary:*`,
    `   💵 Balance:       *GHS ${referralBalance.toFixed(2)}*`,
    `   👥 All-time:      *${referralCount} friend${referralCount !== 1 ? "s" : ""} joined*`,
    `   📅 This month:    *${monthlyReferrals}/${MILESTONE_REFERRALS} referrals*`,
    "",
    "━━━━━━━━━━━━━━━━━━━",
    "🎯 *Two ways to win:*",
    "━━━━━━━━━━━━━━━━━━━",
    `💵 *Path 1:* Reach GHS ${WITHDRAWAL_THRESHOLD_GHS.toFixed(2)} → withdraw cash to MoMo`,
    `🚀 *Path 2:* ${MILESTONE_REFERRALS} referrals this month → GHS ${MILESTONE_BALANCE_GHS.toFixed(2)} + Growth FREE!`,
    "",
  ];

  // Status & call to action
  if (hitMilestone) {
    lines.push(
      `🏆 *Milestone reached! You've earned GHS ${referralBalance.toFixed(2)} this month!*`,
      `Open ZURIA app → Refer & Earn → Withdraw to get your cash. 🎊`
    );
  } else if (pendingWithdrawal) {
    lines.push(`⏳ *You have a pending withdrawal request.* We'll process it soon!`);
  } else if (canWithdraw) {
    lines.push(
      `✅ *You can withdraw GHS ${referralBalance.toFixed(2)} now!*`,
      ``,
      `💡 Or hold on — refer ${remaining30} more this month to unlock`,
      `   GHS ${MILESTONE_BALANCE_GHS.toFixed(2)} total + *Growth features FREE!* 🚀`,
      ``,
      `Open ZURIA app → Refer & Earn → tap Withdraw.`
    );
  } else {
    lines.push(
      `_${referralsToWithdraw} more referral${referralsToWithdraw !== 1 ? "s" : ""} → reach GHS ${WITHDRAWAL_THRESHOLD_GHS.toFixed(2)} (cash out)_`,
      `_${remaining30} more this month → GHS ${MILESTONE_BALANCE_GHS.toFixed(2)} + Growth FREE!_`
    );
  }

  lines.push(
    "",
    "━━━━━━━━━━━━━━━━━━━",
    `Earn *GHS ${REFERRAL_REWARD_GHS.toFixed(2)}* for every business owner who joins via your link.`,
    "",
    link ? `🔗 *Your link:* ${link}` : `Open ZURIA app → Refer & Earn → copy your referral link.`,
    "",
    sig(businessName)
  );

  return lines.join("\n");
}

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

function getTopCustomer(transactions: Transaction[]): [string, number] | undefined {
  const counts = new Map<string, number>();
  transactions.forEach((t) => {
    if (t.customerName && REVENUE_TYPES.includes(t.type)) {
      counts.set(t.customerName, (counts.get(t.customerName) ?? 0) + t.amount);
    }
  });
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0] as [string, number] | undefined;
}
