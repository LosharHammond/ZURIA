import { format, subDays } from "date-fns";
import type { ChartPoint, DailySummary, Debt, InventoryItem, Loan, SmartNotification, Transaction } from "@/types/domain";
import { MONEY_IN_TYPES, MONEY_OUT_TYPES, OPERATING_COST_TYPES, REVENUE_TYPES } from "@/types/domain";
import { createId, formatMoney, todayKey } from "@/lib/utils";

// ─── Daily Summary ────────────────────────────────────────────────────────────

export function generateDailySummary(transactions: Transaction[], ownerName = "friend"): DailySummary {
  const today = todayKey();
  const todays = transactions.filter((t) => t.createdAt.startsWith(today));

  const moneyIn = sum(todays.filter((t) => MONEY_IN_TYPES.includes(t.type)));
  const moneyOut = sum(todays.filter((t) => MONEY_OUT_TYPES.includes(t.type)));
  const salesRevenue = sum(todays.filter((t) => REVENUE_TYPES.includes(t.type)));
  const operatingCosts = sum(todays.filter((t) => OPERATING_COST_TYPES.includes(t.type)));
  const borrowingsIn = sum(todays.filter((t) => t.type === "borrow_in"));
  const lendingsOut = sum(todays.filter((t) => t.type === "borrow_out"));
  const estimatedProfit = salesRevenue - operatingCosts;
  const topProduct = getTopProduct(todays);

  let warning: string | undefined;
  if (operatingCosts > salesRevenue * 0.75 && operatingCosts > 0 && salesRevenue > 0) {
    warning = "⚠️ Your bills and costs are too high compared to your sales today. Check your spending.";
  } else if (borrowingsIn > salesRevenue * 0.5 && borrowingsIn > 0) {
    warning = "⚠️ You borrowed more than you sold today. Remember to plan when to pay it back.";
  } else if (lendingsOut > moneyIn * 0.4 && lendingsOut > 0) {
    warning = "⚠️ A big chunk of today's money was given out as a loan. Make sure to track it.";
  }

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const netCash = moneyIn - moneyOut;
  const profitLine = estimatedProfit > 0
    ? `✅ From selling you made ${formatMoney(estimatedProfit)} profit.`
    : estimatedProfit < 0
    ? `⚠️ Your costs (${formatMoney(operatingCosts)}) are more than your sales (${formatMoney(salesRevenue)}) — that is a loss of ${formatMoney(Math.abs(estimatedProfit))}.`
    : salesRevenue > 0
    ? `🔄 You broke even today — sales equal costs.`
    : `No sales or costs recorded yet today.`;

  const cashLine = netCash !== estimatedProfit && (moneyIn > 0 || moneyOut > 0)
    ? `Cash in hand today: ${netCash >= 0 ? "+" : ""}${formatMoney(netCash)}.`
    : "";

  const generatedText = [
    `${greeting} ${ownerName} 👋`,
    salesRevenue > 0 ? `Sales: ${formatMoney(salesRevenue)}.` : "",
    operatingCosts > 0 ? `Costs: ${formatMoney(operatingCosts)}.` : "",
    profitLine,
    cashLine,
    topProduct ? `🏆 Best seller: ${topProduct}.` : "",
    borrowingsIn > 0 ? `🤝 You borrowed: ${formatMoney(borrowingsIn)}.` : "",
    warning ?? "",
  ].filter(Boolean).join(" ");

  return {
    id: `${today}_summary`,
    businessId: todays[0]?.businessId ?? "",
    date: today,
    moneyIn,
    moneyOut,
    salesRevenue,
    operatingCosts,
    borrowingsIn,
    lendingsOut,
    estimatedProfit,
    currency: "GHS, Cedis",
    topProduct,
    warning,
    generatedText,
    createdAt: new Date().toISOString(),
    syncStatus: "pending",
  };
}

// ─── Health Score ─────────────────────────────────────────────────────────────

export interface HealthScoreBreakdown {
  /** Final 0-100 composite score */
  score: number;
  /** 0-30: how many of last 7 days had at least one sale */
  consistency: number;
  consistencyMax: 30;
  /** 0-30: net profit margin on last 7 days of sales */
  margin: number;
  marginMax: 30;
  /** 0-20 penalty: customer debt vs weekly revenue */
  debtPenalty: number;
  debtPenaltyMax: 20;
  /** 0-12 penalty: loans taken vs weekly revenue */
  loanPenalty: number;
  loanPenaltyMax: 12;
  /** Raw inputs for AI-style narrative */
  weeklyRevenue: number;
  weeklyExpenses: number;
  salesDays: number;
  totalDebt: number;
  totalLoansTaken: number;
}

export function computeHealthScoreBreakdown(
  transactions: Transaction[],
  debts: Debt[],
  loans: Loan[] = []
): HealthScoreBreakdown {
  const sevenDaysAgo = subDays(new Date(), 7);
  const recent = transactions.filter((t) => new Date(t.createdAt) >= sevenDaysAgo);

  const weeklyRevenue  = sum(recent.filter((t) => REVENUE_TYPES.includes(t.type)));
  const weeklyExpenses = sum(recent.filter((t) => OPERATING_COST_TYPES.includes(t.type)));
  const totalDebt      = debts.reduce((acc, d) => acc + d.outstandingAmount, 0);
  const totalLoansTaken = loans
    .filter((l) => l.direction === "taken" && l.status === "open")
    .reduce((acc, l) => acc + l.outstandingAmount, 0);

  const salesDays = new Set(
    recent.filter((t) => t.type === "sale").map((t) => t.createdAt.slice(0, 10))
  ).size;

  const consistency  = Math.min(30, salesDays * (30 / 7));
  const margin       = weeklyRevenue > 0
    ? Math.max(0, Math.min(30, ((weeklyRevenue - weeklyExpenses) / weeklyRevenue) * 30))
    : 8;
  const debtPenalty  = weeklyRevenue > 0
    ? Math.min(20, (totalDebt / Math.max(weeklyRevenue, 1)) * 20)
    : totalDebt > 0 ? 15 : 0;
  const loanPenalty  = weeklyRevenue > 0
    ? Math.min(12, (totalLoansTaken / Math.max(weeklyRevenue, 1)) * 12)
    : totalLoansTaken > 0 ? 8 : 0;

  const score = Math.round(Math.max(10, Math.min(98, 8 + consistency + margin - debtPenalty - loanPenalty)));

  return {
    score,
    consistency:    Math.round(consistency),
    consistencyMax: 30,
    margin:         Math.round(margin),
    marginMax:      30,
    debtPenalty:    Math.round(debtPenalty),
    debtPenaltyMax: 20,
    loanPenalty:    Math.round(loanPenalty),
    loanPenaltyMax: 12,
    weeklyRevenue,
    weeklyExpenses,
    salesDays,
    totalDebt,
    totalLoansTaken,
  };
}

export function computeHealthScore(
  transactions: Transaction[],
  debts: Debt[],
  loans: Loan[] = []
): number {
  return computeHealthScoreBreakdown(transactions, debts, loans).score;
}

// ─── Chart Data ───────────────────────────────────────────────────────────────

export function buildChartData(transactions: Transaction[]): ChartPoint[] {
  return Array.from({ length: 7 }).map((_, index) => {
    const date = subDays(new Date(), 6 - index);
    const key = todayKey(date);
    const daily = transactions.filter((t) => t.createdAt.startsWith(key));
    const sales = sum(daily.filter((t) => REVENUE_TYPES.includes(t.type)));
    const expenses = sum(daily.filter((t) => OPERATING_COST_TYPES.includes(t.type)));
    const borrowings = sum(daily.filter((t) => t.type === "borrow_in" || t.type === "borrow_out"));
    return {
      label: format(date, "EEE"),
      sales,
      expenses,
      net: sales - expenses,
      borrowings,
    };
  });
}

// ─── Dashboard Aggregations ───────────────────────────────────────────────────

export function aggregateTodayBreakdown(transactions: Transaction[]) {
  const today = todayKey();
  const todays = transactions.filter((t) => t.createdAt.startsWith(today));

  return {
    moneyIn: sum(todays.filter((t) => MONEY_IN_TYPES.includes(t.type))),
    moneyOut: sum(todays.filter((t) => MONEY_OUT_TYPES.includes(t.type))),
    salesToday: sum(todays.filter((t) => t.type === "sale")),
    repayments: sum(todays.filter((t) => t.type === "repayment")),
    expensesToday: sum(todays.filter((t) => t.type === "expense")),
    stockCosts: sum(todays.filter((t) => t.type === "stock_purchase")),
    salaryCosts: sum(todays.filter((t) => t.type === "salary")),
    taxCosts: sum(todays.filter((t) => t.type === "tax")),
    fixedCosts: sum(todays.filter((t) => t.type === "cost")),
    borrowingsIn: sum(todays.filter((t) => t.type === "borrow_in")),
    borrowingsOut: sum(todays.filter((t) => t.type === "borrow_out")),
    loanRepaymentsOut: sum(todays.filter((t) => t.type === "loan_repay_out")),
    loanCollectionsIn: sum(todays.filter((t) => t.type === "loan_collect_in")),
    investmentsIn: sum(todays.filter((t) => t.type === "investment")),
    withdrawalsOut: sum(todays.filter((t) => t.type === "withdrawal")),
    refundsIn: sum(todays.filter((t) => t.type === "refund_in")),
    refundsOut: sum(todays.filter((t) => t.type === "refund_out")),
  };
}

// ─── Smart Notifications ──────────────────────────────────────────────────────

export function generateNotifications(params: {
  businessId: string;
  transactions: Transaction[];
  debts: Debt[];
  inventory: InventoryItem[];
  loans?: Loan[];
}): SmartNotification[] {
  const now = new Date().toISOString();
  const notifications: SmartNotification[] = [];
  const todayTxns = params.transactions.filter((t) => t.createdAt.startsWith(todayKey()));

  const todaySalesCount = todayTxns.filter((t) => t.type === "sale").length;
  const todayOperatingCosts = sum(todayTxns.filter((t) => OPERATING_COST_TYPES.includes(t.type)));
  const todaySalesRevenue = sum(todayTxns.filter((t) => REVENUE_TYPES.includes(t.type)));

  const openDebts = params.debts.filter((d) => d.status === "open" && d.outstandingAmount > 0);
  const openLoansGiven = (params.loans ?? []).filter((l) => l.direction === "given" && l.status === "open");
  const openLoansTaken = (params.loans ?? []).filter((l) => l.direction === "taken" && l.status === "open");
  const lowStock = params.inventory.filter((item) => item.quantity != null && item.quantity <= item.lowStockThreshold);

  if (todaySalesCount === 0) {
    notifications.push(makeNote(params.businessId, "sales_nudge", "Nothing recorded yet today", "Write what happened in your shop today — it only takes a few seconds.", "info", now));
  }

  if (openDebts.length) {
    const names = openDebts.slice(0, 2).map((d) => d.customerName).filter(Boolean).join(", ");
    notifications.push(makeNote(params.businessId, "debt_reminder", "Customers still owe you money", `${names}${openDebts.length > 2 ? ` and ${openDebts.length - 2} more people` : ""} have not finished paying. Remember to follow up.`, "warning", now));
  }

  if (openLoansGiven.length) {
    const total = openLoansGiven.reduce((acc, l) => acc + l.outstandingAmount, 0);
    notifications.push(makeNote(params.businessId, "loan_due", "People you gave loans still owe you", `${formatMoney(total)} has not come back yet. Go and remind them.`, "warning", now));
  }

  if (openLoansTaken.length) {
    const total = openLoansTaken.reduce((acc, l) => acc + l.outstandingAmount, 0);
    notifications.push(makeNote(params.businessId, "loan_due", "You still owe a loan", `You need to pay back ${formatMoney(total)} across ${openLoansTaken.length} loan${openLoansTaken.length > 1 ? "s" : ""}. Plan how you will pay.`, "warning", now));
  }

  if (todayOperatingCosts > todaySalesRevenue * 0.75 && todayOperatingCosts > 0 && todaySalesRevenue > 0) {
    notifications.push(makeNote(params.businessId, "expense_warning", "You are spending a lot today", "Your bills and costs are too high compared to what you sold. Check your spending.", "warning", now));
  }

  if (lowStock.length) {
    const names = lowStock.slice(0, 2).map((i) => i.productName).filter(Boolean).join(", ");
    notifications.push(makeNote(params.businessId, "low_stock", "Some goods are running low", `${names}${lowStock.length > 2 ? ` and ${lowStock.length - 2} more` : ""} — time to restock before you run out.`, "warning", now));
  }

  return notifications;
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

function makeNote(
  businessId: string,
  kind: SmartNotification["kind"],
  title: string,
  message: string,
  severity: SmartNotification["severity"],
  createdAt: string
): SmartNotification {
  return { id: createId("note"), businessId, kind, title, message, severity, read: false, createdAt, syncStatus: "pending" };
}
