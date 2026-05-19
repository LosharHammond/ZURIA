/**
 * lib/business-intelligence/trends.ts
 *
 * Business trend memory.
 * Computes directional momentum for key metrics across rolling time windows.
 * Powers early-warning systems and growth detection.
 *
 * Server-only.
 */

import type { Transaction, Debt } from "@/types/domain";
import { REVENUE_TYPES, OPERATING_COST_TYPES } from "@/types/domain";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TrendSignal {
  metric: string;
  direction: "improving" | "declining" | "stable" | "volatile";
  changePercent: number; // relative change vs previous period
  significance: "high" | "medium" | "low";
  periodDays: number;
  summary: string; // human-readable: "Revenue up 23% vs last week"
}

export interface BusinessTrends {
  revenue: TrendSignal;
  expenses: TrendSignal;
  profit: TrendSignal;
  debtExposure: TrendSignal;
  transactionVolume: TrendSignal;
  overallMomentum: "positive" | "neutral" | "negative";
  generatedAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sumByTypes(txns: Transaction[], types: readonly string[]): number {
  return txns.reduce(
    (acc, t) => (types.includes(t.type) ? acc + t.amount : acc),
    0,
  );
}

function formatPercent(value: number): string {
  const abs = Math.abs(Math.round(value));
  return `${abs}%`;
}

function buildSummary(
  metric: string,
  direction: TrendSignal["direction"],
  changePercent: number,
  periodDays: number,
): string {
  const period = periodDays === 15 ? "last 15 days" : `last ${periodDays} days`;
  const pct = formatPercent(changePercent);

  switch (direction) {
    case "improving":
      return `${metric} up ${pct} vs ${period}`;
    case "declining":
      return `${metric} down ${pct} vs ${period}`;
    case "volatile":
      return `${metric} is volatile — changed ${pct} vs ${period}`;
    case "stable":
      return `${metric} is stable vs ${period}`;
  }
}

// ─── computeTrend ─────────────────────────────────────────────────────────────

/**
 * Compute a directional trend signal comparing current vs previous period.
 * Pure function — no async, no side effects.
 */
export function computeTrend(
  current: number,
  previous: number,
  metric: string,
  periodDays: number,
): TrendSignal {
  const changePercent =
    ((current - previous) / Math.max(previous, 1)) * 100;

  let direction: TrendSignal["direction"];
  if (changePercent > 10) direction = "improving";
  else if (changePercent < -10) direction = "declining";
  else direction = "stable";

  let significance: TrendSignal["significance"];
  const absChange = Math.abs(changePercent);
  if (absChange > 25) significance = "high";
  else if (absChange > 10) significance = "medium";
  else significance = "low";

  return {
    metric,
    direction,
    changePercent: Math.round(changePercent * 10) / 10,
    significance,
    periodDays,
    summary: buildSummary(metric, direction, changePercent, periodDays),
  };
}

// ─── buildBusinessTrends ──────────────────────────────────────────────────────

/**
 * Build a full BusinessTrends object from transaction and debt data.
 * Splits the last 30 days into two 15-day halves.
 * Pure function — no async, no side effects.
 */
export function buildBusinessTrends(
  transactions: Transaction[],
  debts: Debt[],
): BusinessTrends {
  const now = Date.now();
  const cutoff30 = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
  const cutoff15 = new Date(now - 15 * 24 * 60 * 60 * 1000).toISOString();

  // Last 15 days = "current"; previous 15 days = "previous"
  const recent = transactions.filter((t) => t.createdAt >= cutoff15);
  const previous = transactions.filter(
    (t) => t.createdAt >= cutoff30 && t.createdAt < cutoff15,
  );

  // Revenue
  const currentRevenue = sumByTypes(recent, REVENUE_TYPES);
  const previousRevenue = sumByTypes(previous, REVENUE_TYPES);
  const revenueTrend = computeTrend(currentRevenue, previousRevenue, "Revenue", 15);

  // Expenses
  const currentExpenses = sumByTypes(recent, OPERATING_COST_TYPES);
  const previousExpenses = sumByTypes(previous, OPERATING_COST_TYPES);
  // For expenses: rising expenses = declining (worse), falling = improving
  const rawExpenseChange = ((currentExpenses - previousExpenses) / Math.max(previousExpenses, 1)) * 100;
  const expenseDirection: TrendSignal["direction"] =
    rawExpenseChange > 10 ? "declining" :
    rawExpenseChange < -10 ? "improving" :
    "stable";
  const expenseSignificance: TrendSignal["significance"] =
    Math.abs(rawExpenseChange) > 25 ? "high" :
    Math.abs(rawExpenseChange) > 10 ? "medium" :
    "low";
  const expensesTrend: TrendSignal = {
    metric: "Expenses",
    direction: expenseDirection,
    changePercent: Math.round(rawExpenseChange * 10) / 10,
    significance: expenseSignificance,
    periodDays: 15,
    summary: buildSummary("Expenses", expenseDirection, rawExpenseChange, 15),
  };

  // Profit
  const currentProfit = currentRevenue - currentExpenses;
  const previousProfit = previousRevenue - previousExpenses;
  const profitTrend = computeTrend(currentProfit, previousProfit, "Profit", 15);

  // Debt exposure: sum of outstanding amounts for open debts
  // We treat all open debts as current (debts don't have a date filter here),
  // and compare to a synthetic "previous" of 0 to detect if debt is growing.
  // A better approach: count debts created in each half.
  const recentDebtCreated = debts
    .filter((d) => d.createdAt >= cutoff15)
    .reduce((acc, d) => acc + d.originalAmount, 0);
  const previousDebtCreated = debts
    .filter((d) => d.createdAt >= cutoff30 && d.createdAt < cutoff15)
    .reduce((acc, d) => acc + d.originalAmount, 0);
  // For debt: increasing debt = declining
  const rawDebtChange =
    ((recentDebtCreated - previousDebtCreated) / Math.max(previousDebtCreated, 1)) * 100;
  const debtDirection: TrendSignal["direction"] =
    rawDebtChange > 10 ? "declining" :
    rawDebtChange < -10 ? "improving" :
    "stable";
  const debtSignificance: TrendSignal["significance"] =
    Math.abs(rawDebtChange) > 25 ? "high" :
    Math.abs(rawDebtChange) > 10 ? "medium" :
    "low";
  const debtExposureTrend: TrendSignal = {
    metric: "Debt Exposure",
    direction: debtDirection,
    changePercent: Math.round(rawDebtChange * 10) / 10,
    significance: debtSignificance,
    periodDays: 15,
    summary: buildSummary("Debt Exposure", debtDirection, rawDebtChange, 15),
  };

  // Transaction volume
  const currentVolume = recent.length;
  const previousVolume = previous.length;
  const volumeTrend = computeTrend(currentVolume, previousVolume, "Transaction Volume", 15);

  // Overall momentum: count improving vs declining signals
  const signals = [revenueTrend, expensesTrend, profitTrend, debtExposureTrend, volumeTrend];
  const improvingCount = signals.filter((s) => s.direction === "improving").length;
  const decliningCount = signals.filter((s) => s.direction === "declining").length;

  let overallMomentum: BusinessTrends["overallMomentum"];
  if (improvingCount >= 3) overallMomentum = "positive";
  else if (decliningCount >= 3) overallMomentum = "negative";
  else overallMomentum = "neutral";

  return {
    revenue: revenueTrend,
    expenses: expensesTrend,
    profit: profitTrend,
    debtExposure: debtExposureTrend,
    transactionVolume: volumeTrend,
    overallMomentum,
    generatedAt: new Date().toISOString(),
  };
}
