import { format, subDays } from "date-fns";
import type { ChartPoint, DailySummary, Debt, InventoryItem, Loan, SmartNotification, Transaction } from "@/types/domain";
import { MONEY_IN_TYPES, MONEY_OUT_TYPES, OPERATING_COST_TYPES, REVENUE_TYPES } from "@/types/domain";
import { createId, formatMoney, todayKey } from "@/lib/utils";

const MONEY_IN_SET = new Set(MONEY_IN_TYPES);
const MONEY_OUT_SET = new Set(MONEY_OUT_TYPES);
const OPERATING_COST_SET = new Set(OPERATING_COST_TYPES);
const REVENUE_SET = new Set(REVENUE_TYPES);

// ─── Daily Summary ────────────────────────────────────────────────────────────

export function generateDailySummary(transactions: Transaction[], ownerName = "friend"): DailySummary {
  const today = todayKey();
  let businessId = "";
  let moneyIn = 0;
  let moneyOut = 0;
  let salesRevenue = 0;
  let operatingCosts = 0;
  let borrowingsIn = 0;
  let lendingsOut = 0;
  const productTotals = new Map<string, number>();

  for (const transaction of transactions) {
    if (!transaction.createdAt.startsWith(today)) continue;
    businessId ||= transaction.businessId;
    if (MONEY_IN_SET.has(transaction.type)) moneyIn += transaction.amount;
    if (MONEY_OUT_SET.has(transaction.type)) moneyOut += transaction.amount;
    if (REVENUE_SET.has(transaction.type)) {
      salesRevenue += transaction.amount;
      if (transaction.productName) {
        productTotals.set(transaction.productName, (productTotals.get(transaction.productName) ?? 0) + transaction.amount);
      }
    }
    if (OPERATING_COST_SET.has(transaction.type)) operatingCosts += transaction.amount;
    if (transaction.type === "borrow_in") borrowingsIn += transaction.amount;
    if (transaction.type === "borrow_out") lendingsOut += transaction.amount;
  }

  const estimatedProfit = salesRevenue - operatingCosts;
  const topProduct = getTopProduct(productTotals);

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
    businessId,
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
  let weeklyRevenue = 0;
  let weeklyExpenses = 0;
  const salesDayKeys = new Set<string>();
  for (const transaction of transactions) {
    if (new Date(transaction.createdAt) < sevenDaysAgo) continue;
    if (REVENUE_SET.has(transaction.type)) weeklyRevenue += transaction.amount;
    if (OPERATING_COST_SET.has(transaction.type)) weeklyExpenses += transaction.amount;
    if (transaction.type === "sale") salesDayKeys.add(transaction.createdAt.slice(0, 10));
  }

  const totalDebt      = debts.reduce((acc, d) => acc + d.outstandingAmount, 0);
  const totalLoansTaken = loans
    .filter((l) => l.direction === "taken" && l.status === "open")
    .reduce((acc, l) => acc + l.outstandingAmount, 0);
  const salesDays = salesDayKeys.size;

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
  const points = Array.from({ length: 7 }).map((_, index) => {
    const date = subDays(new Date(), 6 - index);
    return {
      key: todayKey(date),
      label: format(date, "EEE"),
      sales: 0,
      expenses: 0,
      net: 0,
      borrowings: 0,
    };
  });
  const byDate = new Map(points.map((point) => [point.key, point]));

  for (const transaction of transactions) {
    const point = byDate.get(transaction.createdAt.slice(0, 10));
    if (!point) continue;
    if (REVENUE_SET.has(transaction.type)) point.sales += transaction.amount;
    if (OPERATING_COST_SET.has(transaction.type)) point.expenses += transaction.amount;
    if (transaction.type === "borrow_in" || transaction.type === "borrow_out") point.borrowings += transaction.amount;
  }

  return points.map((point) => ({
    label: point.label,
    sales: point.sales,
    expenses: point.expenses,
    net: point.sales - point.expenses,
    borrowings: point.borrowings,
  }));
}

// ─── Dashboard Aggregations ───────────────────────────────────────────────────

export function aggregateTodayBreakdown(transactions: Transaction[]) {
  const today = todayKey();
  const breakdown = {
    moneyIn: 0,
    moneyOut: 0,
    salesToday: 0,
    repayments: 0,
    expensesToday: 0,
    stockCosts: 0,
    salaryCosts: 0,
    taxCosts: 0,
    fixedCosts: 0,
    borrowingsIn: 0,
    borrowingsOut: 0,
    loanRepaymentsOut: 0,
    loanCollectionsIn: 0,
    investmentsIn: 0,
    withdrawalsOut: 0,
    refundsIn: 0,
    refundsOut: 0,
  };

  for (const transaction of transactions) {
    if (!transaction.createdAt.startsWith(today)) continue;
    if (MONEY_IN_SET.has(transaction.type)) breakdown.moneyIn += transaction.amount;
    if (MONEY_OUT_SET.has(transaction.type)) breakdown.moneyOut += transaction.amount;
    if (transaction.type === "sale") breakdown.salesToday += transaction.amount;
    if (transaction.type === "repayment") breakdown.repayments += transaction.amount;
    if (transaction.type === "expense") breakdown.expensesToday += transaction.amount;
    if (transaction.type === "stock_purchase") breakdown.stockCosts += transaction.amount;
    if (transaction.type === "salary") breakdown.salaryCosts += transaction.amount;
    if (transaction.type === "tax") breakdown.taxCosts += transaction.amount;
    if (transaction.type === "cost") breakdown.fixedCosts += transaction.amount;
    if (transaction.type === "borrow_in") breakdown.borrowingsIn += transaction.amount;
    if (transaction.type === "borrow_out") breakdown.borrowingsOut += transaction.amount;
    if (transaction.type === "loan_repay_out") breakdown.loanRepaymentsOut += transaction.amount;
    if (transaction.type === "loan_collect_in") breakdown.loanCollectionsIn += transaction.amount;
    if (transaction.type === "investment") breakdown.investmentsIn += transaction.amount;
    if (transaction.type === "withdrawal") breakdown.withdrawalsOut += transaction.amount;
    if (transaction.type === "refund_in") breakdown.refundsIn += transaction.amount;
    if (transaction.type === "refund_out") breakdown.refundsOut += transaction.amount;
  }

  return breakdown;
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
  const today = todayKey();
  let todaySalesCount = 0;
  let todayOperatingCosts = 0;
  let todaySalesRevenue = 0;
  for (const transaction of params.transactions) {
    if (!transaction.createdAt.startsWith(today)) continue;
    if (transaction.type === "sale") todaySalesCount += 1;
    if (OPERATING_COST_SET.has(transaction.type)) todayOperatingCosts += transaction.amount;
    if (REVENUE_SET.has(transaction.type)) todaySalesRevenue += transaction.amount;
  }

  const openDebts = params.debts.filter((d) => d.status === "open" && d.outstandingAmount > 0);
  const openLoansGiven = (params.loans ?? []).filter((l) => l.direction === "given" && l.status === "open");
  const openLoansTaken = (params.loans ?? []).filter((l) => l.direction === "taken" && l.status === "open");
  const lowStock = params.inventory.filter((item) => item.quantity != null && item.quantity <= item.lowStockThreshold);

  if (todaySalesCount === 0) {
    notifications.push(makeNote(params.businessId, "sales_nudge", "Nothing recorded yet today", "Write what happened in your shop today — even one entry helps ZURIA track your business better. It only takes a few seconds! 😊", "info", now));
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

  // Sort: warnings first, then info — so the most urgent items surface at the top
  const severityOrder: Record<SmartNotification["severity"], number> = { warning: 0, info: 1, success: 2 };
  notifications.sort((a, b) => (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9));

  return notifications;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getTopProduct(productTotals: Map<string, number>): string | undefined {
  let topProduct: string | undefined;
  let topAmount = 0;
  for (const [product, amount] of productTotals) {
    if (amount > topAmount) {
      topAmount = amount;
      topProduct = product;
    }
  }
  return topProduct;
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
