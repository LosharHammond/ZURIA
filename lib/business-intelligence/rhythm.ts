/**
 * lib/business-intelligence/rhythm.ts
 *
 * Operational rhythm analysis.
 * Identifies a business's natural operating cadence — how frequently they
 * transact, restock, pay suppliers, and experience cash pressure.
 *
 * Server-only.
 */

import type { Transaction } from "@/types/domain";
import { OPERATING_COST_TYPES } from "@/types/domain";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OperationalRhythm {
  avgTransactionsPerDay: number;
  avgDaysBetweenRestocks: number | null; // null if no stock_purchase data
  avgDaysBetweenDebtCreation: number | null;
  peakHour: number | null; // 0-23, null if no timestamp data
  isHighVelocity: boolean; // >5 transactions/day
  isLowActivity: boolean;  // <1 transaction/day
  cashPressureCycle: "daily" | "weekly" | "monthly" | "irregular";
  restockCycle: "daily" | "weekly" | "biweekly" | "monthly" | "irregular" | null;
  operationalDiscipline: "high" | "medium" | "low"; // based on recording consistency
  analysisWindowDays: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Compute average gap in days between sorted timestamps. */
function avgGapDays(dates: Date[]): number | null {
  if (dates.length < 2) return null;
  const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime());
  let totalGap = 0;
  for (let i = 1; i < sorted.length; i++) {
    totalGap += (sorted[i]!.getTime() - sorted[i - 1]!.getTime()) / 86400000;
  }
  return Math.round((totalGap / (sorted.length - 1)) * 10) / 10;
}

/** Map an average gap in days to a named cycle. */
function gapToCycle(
  avgDays: number,
): "daily" | "weekly" | "biweekly" | "monthly" | "irregular" {
  if (avgDays <= 1.5) return "daily";
  if (avgDays <= 8) return "weekly";
  if (avgDays <= 18) return "biweekly";
  if (avgDays <= 35) return "monthly";
  return "irregular";
}

/** Map an average gap in days to a cash pressure cycle. */
function gapToCashCycle(
  avgDays: number,
): "daily" | "weekly" | "monthly" | "irregular" {
  if (avgDays <= 1.5) return "daily";
  if (avgDays <= 8) return "weekly";
  if (avgDays <= 35) return "monthly";
  return "irregular";
}

// ─── analyzeOperationalRhythm ─────────────────────────────────────────────────

/**
 * Analyse operational cadence from transaction history.
 * Pure function — no async, no side effects.
 */
export function analyzeOperationalRhythm(
  transactions: Transaction[],
): OperationalRhythm {
  if (transactions.length === 0) {
    return {
      avgTransactionsPerDay: 0,
      avgDaysBetweenRestocks: null,
      avgDaysBetweenDebtCreation: null,
      peakHour: null,
      isHighVelocity: false,
      isLowActivity: true,
      cashPressureCycle: "irregular",
      restockCycle: null,
      operationalDiscipline: "low",
      analysisWindowDays: 0,
    };
  }

  // ── Analysis window ─────────────────────────────────────────────────────────
  const dates = transactions.map((t) => new Date(t.createdAt));
  const oldest = new Date(Math.min(...dates.map((d) => d.getTime())));
  const newest = new Date(Math.max(...dates.map((d) => d.getTime())));
  const windowMs = newest.getTime() - oldest.getTime();
  const analysisWindowDays = Math.max(
    Math.ceil(windowMs / 86400000),
    1,
  );

  // ── Avg transactions per day ────────────────────────────────────────────────
  const avgTransactionsPerDay =
    Math.round((transactions.length / analysisWindowDays) * 100) / 100;

  // ── Restock gap ─────────────────────────────────────────────────────────────
  const restockDates = transactions
    .filter((t) => t.type === "stock_purchase")
    .map((t) => new Date(t.createdAt));

  const avgDaysBetweenRestocks = avgGapDays(restockDates);
  const restockCycle: OperationalRhythm["restockCycle"] =
    avgDaysBetweenRestocks !== null
      ? gapToCycle(avgDaysBetweenRestocks)
      : null;

  // ── Debt creation gap ───────────────────────────────────────────────────────
  const debtDates = transactions
    .filter((t) => t.type === "debt")
    .map((t) => new Date(t.createdAt));

  const avgDaysBetweenDebtCreation = avgGapDays(debtDates);

  // ── Peak hour detection ─────────────────────────────────────────────────────
  // Only meaningful if timestamps have time components (not just date)
  const hourCounts: Record<number, number> = {};
  let hasMeaningfulHours = false;

  for (const t of transactions) {
    const hour = new Date(t.createdAt).getHours();
    // If all hours are 0, timestamps are date-only — skip
    if (hour !== 0) hasMeaningfulHours = true;
    hourCounts[hour] = (hourCounts[hour] ?? 0) + 1;
  }

  let peakHour: number | null = null;
  if (hasMeaningfulHours) {
    const sorted = Object.entries(hourCounts).sort((a, b) => b[1] - a[1]);
    if (sorted.length > 0) {
      peakHour = Number(sorted[0]![0]);
    }
  }

  // ── Cash pressure cycle: from expense clustering ────────────────────────────
  const expenseDates = transactions
    .filter((t) => OPERATING_COST_TYPES.includes(t.type))
    .map((t) => new Date(t.createdAt));

  const avgExpenseGap = avgGapDays(expenseDates);
  const cashPressureCycle: OperationalRhythm["cashPressureCycle"] =
    avgExpenseGap !== null ? gapToCashCycle(avgExpenseGap) : "irregular";

  // ── Operational discipline: recording consistency ───────────────────────────
  // Count distinct calendar days with at least one record in the last 7 days
  const now = Date.now();
  const last7DaysCutoff = now - 7 * 24 * 60 * 60 * 1000;
  const recentDates = transactions
    .filter((t) => new Date(t.createdAt).getTime() >= last7DaysCutoff)
    .map((t) => new Date(t.createdAt).toDateString());
  const uniqueDaysLast7 = new Set(recentDates).size;

  let operationalDiscipline: OperationalRhythm["operationalDiscipline"];
  if (uniqueDaysLast7 >= 5) operationalDiscipline = "high";
  else if (uniqueDaysLast7 >= 3) operationalDiscipline = "medium";
  else operationalDiscipline = "low";

  return {
    avgTransactionsPerDay,
    avgDaysBetweenRestocks,
    avgDaysBetweenDebtCreation,
    peakHour,
    isHighVelocity: avgTransactionsPerDay > 5,
    isLowActivity: avgTransactionsPerDay < 1,
    cashPressureCycle,
    restockCycle,
    operationalDiscipline,
    analysisWindowDays,
  };
}
