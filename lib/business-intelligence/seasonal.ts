/**
 * lib/business-intelligence/seasonal.ts
 *
 * Seasonal intelligence engine.
 * Detects revenue cycles, weekly patterns, and predictable business rhythms
 * from transaction history. Powers forecasting and anomaly detection.
 *
 * Server-only.
 */

import type { Transaction } from "@/types/domain";
import { REVENUE_TYPES } from "@/types/domain";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SeasonalPattern {
  dayOfWeekPeaks: Array<{ day: 0 | 1 | 2 | 3 | 4 | 5 | 6; avgRevenue: number; label: string }>; // sorted desc
  monthlyPattern: "steady" | "month_start_spike" | "month_end_spike" | "mid_month_peak";
  bestRevenueDay: string;   // e.g. "Friday"
  worstRevenueDay: string;  // e.g. "Tuesday"
  weeklyAvgRevenue: number;
  peakWeekMultiplier: number; // how much peak week exceeds average (1.0 = same)
  detectedAt: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DAY_LABELS: Record<0 | 1 | 2 | 3 | 4 | 5 | 6, string> = {
  0: "Sunday",
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function emptyPattern(): SeasonalPattern {
  return {
    dayOfWeekPeaks: [],
    monthlyPattern: "steady",
    bestRevenueDay: "Monday",
    worstRevenueDay: "Sunday",
    weeklyAvgRevenue: 0,
    peakWeekMultiplier: 1,
    detectedAt: new Date().toISOString(),
  };
}

// ─── analyzeSeasonalPatterns ──────────────────────────────────────────────────

/**
 * Analyse transaction history and return a SeasonalPattern.
 * Pure function — no async, no side effects.
 */
export function analyzeSeasonalPatterns(transactions: Transaction[]): SeasonalPattern {
  const revenue = transactions.filter((t) => REVENUE_TYPES.includes(t.type));

  if (revenue.length === 0) return emptyPattern();

  // ── Day-of-week revenue aggregation ────────────────────────────────────────
  const dayRevenue: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  const dayCount: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };

  for (const t of revenue) {
    const d = new Date(t.createdAt).getDay();
    dayRevenue[d] = (dayRevenue[d] ?? 0) + t.amount;
    dayCount[d] = (dayCount[d] ?? 0) + 1;
  }

  const dayOfWeekPeaks: Array<{ day: 0 | 1 | 2 | 3 | 4 | 5 | 6; avgRevenue: number; label: string }> = [];

  for (let d = 0; d <= 6; d++) {
    const count = dayCount[d] ?? 0;
    const avg = count > 0 ? (dayRevenue[d] ?? 0) / count : 0;
    dayOfWeekPeaks.push({
      day: d as 0 | 1 | 2 | 3 | 4 | 5 | 6,
      avgRevenue: Math.round(avg * 100) / 100,
      label: DAY_LABELS[d as 0 | 1 | 2 | 3 | 4 | 5 | 6],
    });
  }

  dayOfWeekPeaks.sort((a, b) => b.avgRevenue - a.avgRevenue);

  const bestRevenueDay = dayOfWeekPeaks[0]?.label ?? "Monday";
  const worstRevenueDay = dayOfWeekPeaks[dayOfWeekPeaks.length - 1]?.label ?? "Sunday";

  // ── Weekly average revenue ──────────────────────────────────────────────────
  // Group by ISO week and compute per-week totals
  const weekRevenue: Map<string, number> = new Map();

  for (const t of revenue) {
    const date = new Date(t.createdAt);
    const year = date.getFullYear();
    const startOfYear = new Date(year, 0, 1);
    const weekNum = Math.ceil(
      ((date.getTime() - startOfYear.getTime()) / 86400000 + startOfYear.getDay() + 1) / 7,
    );
    const weekKey = `${year}-W${weekNum}`;
    weekRevenue.set(weekKey, (weekRevenue.get(weekKey) ?? 0) + t.amount);
  }

  const weekTotals = Array.from(weekRevenue.values());
  const weeklyAvgRevenue =
    weekTotals.length > 0
      ? Math.round((weekTotals.reduce((a, b) => a + b, 0) / weekTotals.length) * 100) / 100
      : 0;

  const peakWeekTotal = weekTotals.length > 0 ? Math.max(...weekTotals) : 0;
  const peakWeekMultiplier =
    weeklyAvgRevenue > 0
      ? Math.round((peakWeekTotal / weeklyAvgRevenue) * 100) / 100
      : 1;

  // ── Monthly pattern detection ───────────────────────────────────────────────
  // Split month into thirds: days 1-10, 11-20, 21-31
  const monthRevenue = { early: 0, mid: 0, late: 0 };
  for (const t of revenue) {
    const dayOfMonth = new Date(t.createdAt).getDate();
    if (dayOfMonth <= 10) monthRevenue.early += t.amount;
    else if (dayOfMonth <= 20) monthRevenue.mid += t.amount;
    else monthRevenue.late += t.amount;
  }

  const { early, mid, late } = monthRevenue;
  const total = early + mid + late;

  let monthlyPattern: SeasonalPattern["monthlyPattern"] = "steady";
  if (total > 0) {
    const earlyShare = early / total;
    const midShare = mid / total;
    const lateShare = late / total;
    const threshold = 0.4;

    if (earlyShare >= threshold) monthlyPattern = "month_start_spike";
    else if (lateShare >= threshold) monthlyPattern = "month_end_spike";
    else if (midShare >= threshold) monthlyPattern = "mid_month_peak";
    else monthlyPattern = "steady";
  }

  return {
    dayOfWeekPeaks,
    monthlyPattern,
    bestRevenueDay,
    worstRevenueDay,
    weeklyAvgRevenue,
    peakWeekMultiplier,
    detectedAt: new Date().toISOString(),
  };
}

// ─── predictNextWeekRevenue ───────────────────────────────────────────────────

/**
 * Project next week's revenue based on seasonal pattern.
 * If today is among the top 2 revenue days, apply peak multiplier.
 */
export function predictNextWeekRevenue(
  pattern: SeasonalPattern,
  currentDayOfWeek: number,
): number {
  if (pattern.weeklyAvgRevenue === 0) return 0;

  const topDays = pattern.dayOfWeekPeaks.slice(0, 2).map((p) => p.day as number);
  const isCurrentPeakDay = topDays.includes(currentDayOfWeek);

  const multiplier = isCurrentPeakDay ? pattern.peakWeekMultiplier : 1;
  return Math.round(pattern.weeklyAvgRevenue * multiplier * 100) / 100;
}

// ─── isCurrentlyInSlowPeriod ──────────────────────────────────────────────────

/**
 * Returns true if today is among the bottom 2 revenue days of the week.
 */
export function isCurrentlyInSlowPeriod(pattern: SeasonalPattern): boolean {
  if (pattern.dayOfWeekPeaks.length < 2) return false;

  const today = new Date().getDay();
  const bottomDays = pattern.dayOfWeekPeaks.slice(-2).map((p) => p.day as number);
  return bottomDays.includes(today);
}
