/**
 * lib/intelligence/business-dna.ts
 *
 * Business DNA Engine — the core of ZURIA's irreplaceability.
 *
 * Synthesizes ALL accumulated intelligence (operational rhythm, seasonal patterns,
 * BI trends, debt behavior, supplier cycles) into a set of human-readable,
 * conversational "DNA facts" about a specific business.
 *
 * These facts power:
 *   - Smart Recall: enriched transaction confirmations with memory context
 *   - Proactive Intelligence: self-initiated insights without user prompting
 *   - Business Timeline: contextual narrative events
 *   - Emotional Safety: business-grounded reassurance
 *
 * "You usually restock every 5 days, often on Fridays."
 * "Transport costs spike in the last week of each month."
 * "Customer debts take an average of 8 days to collect."
 * "Your best revenue day is Saturday — 34% above average."
 *
 * Over time, the DNA deepens. The longer a business uses ZURIA,
 * the more accurate and irreplaceable the DNA becomes.
 *
 * Server-only.
 */

import { getAdminDb } from "@/lib/firebase/admin";
import { collections } from "@/lib/firebase/collections";
import type { Transaction, Debt } from "@/types/domain";
import { REVENUE_TYPES, OPERATING_COST_TYPES } from "@/types/domain";
import { createLogger } from "@/lib/observability/logger";

const logger = createLogger("business-dna");

// ─── Types ────────────────────────────────────────────────────────────────────

export type DNAFactType =
  | "restock_rhythm"           // "You usually restock every ~5 days"
  | "expense_pattern"          // "Transport costs spike near month-end"
  | "debt_behavior"            // "Debts take ~8 days to collect on average"
  | "peak_day"                 // "Saturday is your best revenue day"
  | "slow_period"              // "Sales slow after the 20th of the month"
  | "supplier_cycle"           // "You buy from this supplier every 2 weeks"
  | "customer_pattern"         // "Ama buys more in month-end weeks"
  | "cash_pressure_period"     // "Cash is usually tightest on Mondays"
  | "seasonal_trend"           // "Sales drop 22% after school reopening"
  | "top_product_consistency"  // "Rice is sold on 11 of 14 active days"
  | "revenue_pattern"          // "Revenue is growing 8% week-on-week"
  | "expense_trend"            // "Expenses have been creeping up 3 months in a row"
  | "debt_risk_trend";         // "Customer debt is increasing faster than revenue"

export interface DNAFact {
  id: string;              // deterministic: `${businessId}_${type}_${key}`
  businessId: string;
  type: DNAFactType;
  category: "rhythm" | "supplier" | "customer" | "financial" | "seasonal" | "operational";
  /** Human-readable statement surfaced in responses */
  statement: string;
  /** Short version for inline use */
  shortStatement: string;
  confidence: number;      // 0–1 based on data volume and consistency
  supportingData: Record<string, unknown>;
  detectedAt: string;
  lastConfirmedAt: string;
  occurrences: number;     // how many times this pattern was confirmed
  active: boolean;
}

export interface BusinessDNAReport {
  businessId: string;
  userId: string;
  facts: DNAFact[];
  keyFacts: DNAFact[];     // top 3–5 most confident, most actionable facts
  generatedAt: string;
  dataWindowDays: number;
  transactionCount: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function makeId(businessId: string, type: DNAFactType, key: string): string {
  return `${businessId}_${type}_${key}`.replace(/\s+/g, "_").toLowerCase().slice(0, 120);
}

function pct(value: number): string {
  return `${Math.round(value)}%`;
}

function ghs(amount: number): string {
  return `GH₵${amount.toFixed(2)}`;
}

/** Average gap in days between sorted timestamps */
function avgGapDays(dates: Date[]): number | null {
  if (dates.length < 2) return null;
  const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime());
  let total = 0;
  for (let i = 1; i < sorted.length; i++) {
    total += (sorted[i]!.getTime() - sorted[i - 1]!.getTime()) / 86_400_000;
  }
  return Math.round((total / (sorted.length - 1)) * 10) / 10;
}

/** Most common day-of-week (0=Sun…6=Sat) in a date array */
function mostCommonDayOfWeek(dates: Date[]): number | null {
  if (dates.length === 0) return null;
  const counts: Record<number, number> = {};
  for (const d of dates) {
    const dow = d.getDay();
    counts[dow] = (counts[dow] ?? 0) + 1;
  }
  return Number(
    Object.entries(counts).sort((a, b) => b[1] - a[1])[0]![0],
  );
}

/** Revenue by day-of-week: returns [0..6] → avg revenue */
function avgRevenueByDow(transactions: Transaction[]): Record<number, number> {
  const totals: Record<number, number> = {};
  const counts: Record<number, number> = {};
  for (const t of transactions) {
    if (!REVENUE_TYPES.includes(t.type)) continue;
    const dow = new Date(t.createdAt).getDay();
    totals[dow] = (totals[dow] ?? 0) + t.amount;
    counts[dow] = (counts[dow] ?? 0) + 1;
  }
  const result: Record<number, number> = {};
  for (let d = 0; d < 7; d++) {
    result[d] = counts[d] ? (totals[d] ?? 0) / counts[d] : 0;
  }
  return result;
}

/** Sum transaction amounts for a type set */
function sumByTypes(txns: Transaction[], types: readonly string[]): number {
  return txns.reduce((acc, t) => (types.includes(t.type) ? acc + t.amount : acc), 0);
}

/** Split month into thirds: 1–10, 11–20, 21–31 */
function monthThird(date: Date): "early" | "mid" | "late" {
  const d = date.getDate();
  if (d <= 10) return "early";
  if (d <= 20) return "mid";
  return "late";
}

// ─── Individual fact builders ─────────────────────────────────────────────────

function buildRestockRhythmFact(
  businessId: string,
  transactions: Transaction[],
  now: string,
): DNAFact | null {
  const restocks = transactions
    .filter((t) => t.type === "stock_purchase")
    .map((t) => new Date(t.createdAt));

  if (restocks.length < 3) return null;

  const avgDays = avgGapDays(restocks);
  if (avgDays === null) return null;

  const commonDay = mostCommonDayOfWeek(restocks);
  const dayName = commonDay !== null ? DAY_NAMES[commonDay] : null;

  // Only emit if there's a meaningful pattern (avg < 21 days = not monthly+)
  if (avgDays > 21) return null;

  const cycleLabel =
    avgDays <= 2 ? "daily" :
    avgDays <= 5 ? "every few days" :
    avgDays <= 10 ? "weekly" :
    "every two weeks";

  const dayClue = dayName
    ? `, often on ${dayName}s`
    : "";

  const confidence = Math.min(0.95, 0.5 + restocks.length * 0.05);

  return {
    id:           makeId(businessId, "restock_rhythm", "primary"),
    businessId,
    type:         "restock_rhythm",
    category:     "operational",
    statement:    `You usually restock ${cycleLabel} (every ~${avgDays} days${dayClue}).`,
    shortStatement: `Restocks ~${avgDays} day gaps${dayName ? `, usually ${dayName}` : ""}.`,
    confidence,
    supportingData: { avgDays, commonDayOfWeek: commonDay, sampleCount: restocks.length },
    detectedAt:    now,
    lastConfirmedAt: now,
    occurrences:   restocks.length,
    active: true,
  };
}

function buildPeakDayFact(
  businessId: string,
  transactions: Transaction[],
  now: string,
): DNAFact | null {
  if (transactions.length < 14) return null;

  const byDow = avgRevenueByDow(transactions);
  const sorted = Object.entries(byDow)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);

  if (sorted.length < 3) return null;

  const [bestDow, bestRevenue] = sorted[0]!;
  const [, worstRevenue] = sorted[sorted.length - 1]!;

  if (worstRevenue === 0) return null;
  const uplift = ((bestRevenue - worstRevenue) / worstRevenue) * 100;

  if (uplift < 20) return null; // not meaningful enough

  const dayName = DAY_NAMES[Number(bestDow)];
  const confidence = Math.min(0.92, 0.6 + (uplift / 200));

  return {
    id:           makeId(businessId, "peak_day", bestDow),
    businessId,
    type:         "peak_day",
    category:     "seasonal",
    statement:    `${dayName} is your best revenue day — ${pct(uplift)} above your weakest day.`,
    shortStatement: `Peak day: ${dayName} (+${pct(uplift)}).`,
    confidence,
    supportingData: { bestDayOfWeek: Number(bestDow), bestDayName: dayName, upliftPct: uplift, avgRevenue: bestRevenue },
    detectedAt:    now,
    lastConfirmedAt: now,
    occurrences:   transactions.filter((t) => new Date(t.createdAt).getDay() === Number(bestDow)).length,
    active: true,
  };
}

function buildSlowPeriodFact(
  businessId: string,
  transactions: Transaction[],
  now: string,
): DNAFact | null {
  if (transactions.length < 20) return null;

  // Check month-third revenue distribution
  const thirdRevenue: Record<"early" | "mid" | "late", number> = { early: 0, mid: 0, late: 0 };
  const thirdCount: Record<"early" | "mid" | "late", number> = { early: 0, mid: 0, late: 0 };

  for (const t of transactions) {
    if (!REVENUE_TYPES.includes(t.type)) continue;
    const third = monthThird(new Date(t.createdAt));
    thirdRevenue[third] += t.amount;
    thirdCount[third]++;
  }

  const totals = Object.values(thirdRevenue).reduce((a, b) => a + b, 0);
  if (totals === 0) return null;

  const shares = {
    early: thirdRevenue.early / totals,
    mid:   thirdRevenue.mid   / totals,
    late:  thirdRevenue.late  / totals,
  };

  // Find the slow period: the third with < 25% of revenue when others are higher
  const slowThird = (Object.entries(shares) as Array<["early" | "mid" | "late", number]>)
    .filter(([, s]) => s < 0.25)
    .sort((a, b) => a[1] - b[1])[0];

  if (!slowThird) return null;

  const [period, share] = slowThird;
  const periodLabel =
    period === "early" ? "the first 10 days of the month" :
    period === "mid" ?   "the middle of the month (11th–20th)" :
    "the last week of the month";

  const confidence = Math.min(0.88, 0.55 + (0.25 - share) * 2);

  return {
    id:           makeId(businessId, "slow_period", period),
    businessId,
    type:         "slow_period",
    category:     "seasonal",
    statement:    `Sales tend to slow down during ${periodLabel} (${pct(share * 100)} of monthly revenue).`,
    shortStatement: `Slow period: ${periodLabel}.`,
    confidence,
    supportingData: { slowPeriod: period, revenueShare: share, thirdRevenue },
    detectedAt:    now,
    lastConfirmedAt: now,
    occurrences:   thirdCount[period],
    active: true,
  };
}

function buildDebtBehaviorFact(
  businessId: string,
  transactions: Transaction[],
  debts: Debt[],
  now: string,
): DNAFact | null {
  // Calculate average days-to-repayment from paired debt / repayment transactions
  const paidDebts = debts.filter((d) => d.status === "paid" && d.createdAt && d.lastActivityAt);

  if (paidDebts.length < 3) return null;

  const gaps = paidDebts.map((d) => {
    const created = new Date(d.createdAt).getTime();
    const paid    = new Date(d.lastActivityAt).getTime();
    return (paid - created) / 86_400_000;
  });

  const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const roundedAvg = Math.round(avg);

  if (roundedAvg <= 0 || roundedAvg > 180) return null; // sanity check

  const behavior =
    roundedAvg <= 3  ? "very quickly (within 3 days)" :
    roundedAvg <= 7  ? "within a week" :
    roundedAvg <= 14 ? "within two weeks" :
    roundedAvg <= 30 ? "within a month" :
    `in about ${roundedAvg} days on average`;

  const openDebts = debts.filter((d) => d.status === "open");
  const overdueCount = openDebts.filter((d) => {
    const age = (Date.now() - new Date(d.createdAt).getTime()) / 86_400_000;
    return age > roundedAvg * 1.5;
  }).length;

  const overdueNote = overdueCount > 0
    ? ` Currently, ${overdueCount} debt${overdueCount !== 1 ? "s are" : " is"} overdue by this measure.`
    : "";

  const confidence = Math.min(0.90, 0.55 + paidDebts.length * 0.04);

  return {
    id:           makeId(businessId, "debt_behavior", "avg_repayment"),
    businessId,
    type:         "debt_behavior",
    category:     "customer",
    statement:    `Your customers typically repay ${behavior}.${overdueNote}`,
    shortStatement: `Avg debt repayment: ~${roundedAvg} days.`,
    confidence,
    supportingData: { avgDaysToRepay: roundedAvg, sampleCount: paidDebts.length, overdueCount },
    detectedAt:    now,
    lastConfirmedAt: now,
    occurrences:   paidDebts.length,
    active: true,
  };
}

function buildExpensePatternFact(
  businessId: string,
  transactions: Transaction[],
  now: string,
): DNAFact | null {
  // Check if a specific expense type (transport, salary, etc.) spikes in a month-third
  const expenseByTypeAndThird: Record<string, Record<"early" | "mid" | "late", number>> = {};

  for (const t of transactions) {
    if (!OPERATING_COST_TYPES.includes(t.type)) continue;
    const third = monthThird(new Date(t.createdAt));
    if (!expenseByTypeAndThird[t.type]) {
      expenseByTypeAndThird[t.type] = { early: 0, mid: 0, late: 0 };
    }
    expenseByTypeAndThird[t.type]![third] += t.amount;
  }

  let strongestType = "";
  let strongestThird: "early" | "mid" | "late" = "late";
  let strongestRatio = 0;

  for (const [type, byThird] of Object.entries(expenseByTypeAndThird)) {
    const total = Object.values(byThird).reduce((a, b) => a + b, 0);
    if (total < 100) continue; // not enough data

    for (const [third, amount] of Object.entries(byThird) as Array<["early" | "mid" | "late", number]>) {
      const ratio = amount / total;
      if (ratio > 0.5 && ratio > strongestRatio) {
        strongestRatio = ratio;
        strongestType = type;
        strongestThird = third;
      }
    }
  }

  if (!strongestType || strongestRatio < 0.5) return null;

  const typeLabel =
    strongestType === "expense"  ? "General expenses" :
    strongestType === "cost"     ? "Business costs" :
    strongestType === "salary"   ? "Salary payments" :
    strongestType === "tax"      ? "Tax/levy payments" :
    `${strongestType} expenses`;

  const periodLabel =
    strongestThird === "early" ? "early in the month (1st–10th)" :
    strongestThird === "mid"   ? "mid-month (11th–20th)" :
    "late in the month (after the 20th)";

  const confidence = Math.min(0.85, 0.55 + strongestRatio * 0.5);

  return {
    id:           makeId(businessId, "expense_pattern", `${strongestType}_${strongestThird}`),
    businessId,
    type:         "expense_pattern",
    category:     "financial",
    statement:    `${typeLabel} tend to concentrate ${periodLabel} — ${pct(strongestRatio * 100)} of the monthly total.`,
    shortStatement: `${typeLabel} peak ${periodLabel}.`,
    confidence,
    supportingData: { expenseType: strongestType, concentrationPeriod: strongestThird, concentrationRatio: strongestRatio },
    detectedAt:    now,
    lastConfirmedAt: now,
    occurrences:   transactions.filter((t) => t.type === strongestType).length,
    active: true,
  };
}

function buildTopProductConsistencyFact(
  businessId: string,
  transactions: Transaction[],
  now: string,
): DNAFact | null {
  if (transactions.length < 10) return null;

  // Find product sold on the most distinct days
  const productDays: Record<string, Set<string>> = {};
  const activeDayKeys = new Set<string>();

  for (const t of transactions) {
    if (!REVENUE_TYPES.includes(t.type) || !t.productName) continue;
    const dayKey = t.createdAt.slice(0, 10);
    activeDayKeys.add(dayKey);
    if (!productDays[t.productName]) productDays[t.productName] = new Set();
    productDays[t.productName]!.add(dayKey);
  }

  if (activeDayKeys.size < 5) return null;

  const sorted = Object.entries(productDays)
    .map(([name, days]) => ({ name, daysActive: days.size, totalDays: activeDayKeys.size }))
    .filter((p) => p.daysActive >= 4)
    .sort((a, b) => b.daysActive - a.daysActive);

  if (sorted.length === 0) return null;

  const top = sorted[0]!;
  const consistency = top.daysActive / top.totalDays;

  if (consistency < 0.4) return null; // not consistent enough

  const consistencyLabel =
    consistency >= 0.85 ? "almost every day" :
    consistency >= 0.65 ? "most days" :
    "regularly";

  const confidence = Math.min(0.88, 0.55 + consistency * 0.4);

  return {
    id:           makeId(businessId, "top_product_consistency", top.name),
    businessId,
    type:         "top_product_consistency",
    category:     "operational",
    statement:    `"${top.name}" is your most consistent product — sold on ${top.daysActive} of ${top.totalDays} active days (${consistencyLabel}).`,
    shortStatement: `${top.name}: your most consistent seller (${pct(consistency * 100)} of days).`,
    confidence,
    supportingData: { productName: top.name, daysActive: top.daysActive, totalActiveDays: top.totalDays, consistencyRatio: consistency },
    detectedAt:    now,
    lastConfirmedAt: now,
    occurrences:   top.daysActive,
    active: true,
  };
}

function buildRevenueTrendFact(
  businessId: string,
  transactions: Transaction[],
  now: string,
): DNAFact | null {
  // Compare last 7 days vs prior 7 days vs prior 14–21 days (3-week trend)
  const nowTs = Date.now();
  const w0Start = nowTs - 7  * 86_400_000;
  const w1Start = nowTs - 14 * 86_400_000;
  const w2Start = nowTs - 21 * 86_400_000;

  const w0Rev = sumByTypes(transactions.filter((t) => new Date(t.createdAt).getTime() >= w0Start), REVENUE_TYPES);
  const w1Rev = sumByTypes(transactions.filter((t) => {
    const ts = new Date(t.createdAt).getTime();
    return ts >= w1Start && ts < w0Start;
  }), REVENUE_TYPES);
  const w2Rev = sumByTypes(transactions.filter((t) => {
    const ts = new Date(t.createdAt).getTime();
    return ts >= w2Start && ts < w1Start;
  }), REVENUE_TYPES);

  if (w0Rev === 0 || w1Rev === 0 || w2Rev === 0) return null;

  const growthW1 = (w0Rev - w1Rev) / w1Rev;
  const growthW2 = (w1Rev - w2Rev) / w2Rev;

  const bothGrowing   = growthW1 > 0.10 && growthW2 > 0.05;
  const bothDeclining = growthW1 < -0.10 && growthW2 < -0.05;

  if (!bothGrowing && !bothDeclining) return null;

  const direction = bothGrowing ? "growing" : "declining";
  const avgGrowth = (Math.abs(growthW1) + Math.abs(growthW2)) / 2 * 100;

  const statement = bothGrowing
    ? `Revenue has been growing consistently — up ${pct(growthW1 * 100)} this week vs last week, and up ${pct(growthW2 * 100)} the week before. Momentum is building.`
    : `Revenue has been declining for 2+ weeks — down ${pct(Math.abs(growthW1) * 100)} this week vs last. This needs attention.`;

  const confidence = Math.min(0.85, 0.60 + avgGrowth / 200);

  return {
    id:           makeId(businessId, "revenue_pattern", direction),
    businessId,
    type:         "revenue_pattern",
    category:     "financial",
    statement,
    shortStatement: `Revenue ${direction}: ${direction === "growing" ? "+" : "-"}${pct(Math.abs(growthW1 * 100))} this week.`,
    confidence,
    supportingData: { direction, growthW0vsW1: growthW1, growthW1vsW2: growthW2, w0Rev, w1Rev, w2Rev },
    detectedAt:    now,
    lastConfirmedAt: now,
    occurrences:   3,
    active: true,
  };
}

function buildDebtRiskTrendFact(
  businessId: string,
  transactions: Transaction[],
  debts: Debt[],
  now: string,
): DNAFact | null {
  const openDebts = debts.filter((d) => d.status === "open");
  if (openDebts.length < 3) return null;

  const totalOutstanding = openDebts.reduce((acc, d) => acc + d.outstandingAmount, 0);

  // Compare debt creation rate to revenue over the last 30 days
  const cutoff30 = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const recent = transactions.filter((t) => t.createdAt >= cutoff30);
  const recentRevenue = sumByTypes(recent, REVENUE_TYPES);
  const recentDebtCreated = sumByTypes(recent.filter((t) => t.type === "debt"), ["debt"]);
  const recentRepayments = sumByTypes(recent.filter((t) => t.type === "repayment"), ["repayment"]);

  if (recentRevenue === 0) return null;

  const debtGrowthRate = (recentDebtCreated - recentRepayments) / recentRevenue;

  if (debtGrowthRate < 0.15) return null; // debt is under control

  const riskLabel =
    debtGrowthRate > 0.5  ? "significantly faster" :
    debtGrowthRate > 0.25 ? "noticeably faster" :
    "slightly faster";

  const statement = `Customer debt is growing ${riskLabel} than revenue. ${ghs(totalOutstanding)} outstanding across ${openDebts.length} customers — ${ghs(recentDebtCreated)} created vs ${ghs(recentRepayments)} collected in 30 days.`;

  const confidence = Math.min(0.88, 0.60 + debtGrowthRate * 0.3);

  return {
    id:           makeId(businessId, "debt_risk_trend", "growing"),
    businessId,
    type:         "debt_risk_trend",
    category:     "financial",
    statement,
    shortStatement: `Debt growing faster than revenue (${ghs(totalOutstanding)} outstanding).`,
    confidence,
    supportingData: { debtGrowthRate, totalOutstanding, openDebtCount: openDebts.length, recentDebtCreated, recentRepayments },
    detectedAt:    now,
    lastConfirmedAt: now,
    occurrences:   openDebts.length,
    active: true,
  };
}

// ─── Main builder ─────────────────────────────────────────────────────────────

/**
 * Build a BusinessDNAReport from raw transaction and debt data.
 * Pure computation — no Firestore reads. Always returns a report.
 */
export function buildBusinessDNA(
  userId: string,
  businessId: string,
  transactions: Transaction[],
  debts: Debt[],
): BusinessDNAReport {
  const now = new Date().toISOString();
  const facts: DNAFact[] = [];

  const builders = [
    () => buildRestockRhythmFact(businessId, transactions, now),
    () => buildPeakDayFact(businessId, transactions, now),
    () => buildSlowPeriodFact(businessId, transactions, now),
    () => buildDebtBehaviorFact(businessId, transactions, debts, now),
    () => buildExpensePatternFact(businessId, transactions, now),
    () => buildTopProductConsistencyFact(businessId, transactions, now),
    () => buildRevenueTrendFact(businessId, transactions, now),
    () => buildDebtRiskTrendFact(businessId, transactions, debts, now),
  ];

  for (const build of builders) {
    try {
      const fact = build();
      if (fact) facts.push(fact);
    } catch { /* skip failed fact builders */ }
  }

  // Key facts: top 5 by confidence, prioritizing financial and operational
  const priorityOrder: DNAFact["category"][] = [
    "financial", "operational", "rhythm", "seasonal", "customer", "supplier",
  ];

  const keyFacts = [...facts]
    .sort((a, b) => {
      const catA = priorityOrder.indexOf(a.category);
      const catB = priorityOrder.indexOf(b.category);
      if (catA !== catB) return catA - catB;
      return b.confidence - a.confidence;
    })
    .slice(0, 5);

  const oldestTxn = transactions.length > 0
    ? transactions.reduce((oldest, t) => t.createdAt < oldest ? t.createdAt : oldest, transactions[0]!.createdAt)
    : now;
  const dataWindowDays = Math.ceil((Date.now() - new Date(oldestTxn).getTime()) / 86_400_000);

  return {
    businessId,
    userId,
    facts,
    keyFacts,
    generatedAt: now,
    dataWindowDays,
    transactionCount: transactions.length,
  };
}

// ─── Firestore persistence ────────────────────────────────────────────────────

const CACHE_TTL_MS = 20 * 60 * 60 * 1000; // 20 hours

/**
 * Retrieve cached DNA or build fresh if stale/missing.
 * Never throws — returns empty report on error.
 */
export async function getOrRefreshBusinessDNA(
  userId: string,
  businessId: string,
): Promise<BusinessDNAReport> {
  const db = getAdminDb();

  // 1. Try cache
  try {
    const snap = await db.collection(collections.businessDna).doc(businessId).get();
    if (snap.exists) {
      const cached = snap.data() as BusinessDNAReport;
      const age = Date.now() - new Date(cached.generatedAt).getTime();
      if (age < CACHE_TTL_MS) return cached;
    }
  } catch { /* fall through */ }

  // 2. Fetch raw data
  const [txnSnap, debtSnap] = await Promise.allSettled([
    db.collection(collections.transactions)
      .where("businessId", "==", businessId)
      .where("createdAt", ">=", new Date(Date.now() - 90 * 86_400_000).toISOString())
      .orderBy("createdAt", "desc")
      .limit(500)
      .get(),
    db.collection(collections.debts)
      .where("businessId", "==", businessId)
      .get(),
  ]);

  const transactions = txnSnap.status === "fulfilled"
    ? txnSnap.value.docs.map((d) => d.data() as Transaction)
    : [];

  const debts = debtSnap.status === "fulfilled"
    ? debtSnap.value.docs.map((d) => d.data() as Debt)
    : [];

  // 3. Build DNA
  const report = buildBusinessDNA(userId, businessId, transactions, debts);

  // 4. Persist (fire-and-forget)
  db.collection(collections.businessDna)
    .doc(businessId)
    .set(report, { merge: false })
    .catch((err) => logger.warn("Failed to persist business DNA", { businessId, error: String(err) }));

  return report;
}

// ─── Response helpers ─────────────────────────────────────────────────────────

/**
 * Returns up to 2 contextually relevant DNA facts for a given transaction type.
 * Used to enrich transaction confirmations with memory context.
 */
export function getRelevantDNAFacts(
  dna: BusinessDNAReport,
  txType: string,
  productName?: string | null,
): DNAFact[] {
  const relevant: DNAFact[] = [];

  for (const fact of dna.facts) {
    if (relevant.length >= 2) break;

    switch (txType) {
      case "stock_purchase":
        if (fact.type === "restock_rhythm") relevant.push(fact);
        break;
      case "debt":
        if (fact.type === "debt_behavior" || fact.type === "debt_risk_trend") relevant.push(fact);
        break;
      case "repayment":
        if (fact.type === "debt_behavior") relevant.push(fact);
        break;
      case "sale":
        if (productName && fact.type === "top_product_consistency" &&
            fact.supportingData["productName"] === productName) {
          relevant.push(fact);
        }
        if (fact.type === "peak_day") relevant.push(fact);
        break;
      case "expense":
      case "cost":
        if (fact.type === "expense_pattern" || fact.type === "expense_trend") relevant.push(fact);
        break;
    }
  }

  return relevant;
}

/**
 * Format DNA facts as a compact memory note appended to a transaction response.
 * Returns null if no relevant facts or confidence is too low.
 */
export function formatDNAMemoryNote(facts: DNAFact[]): string | null {
  const highConfidence = facts.filter((f) => f.confidence >= 0.65);
  if (highConfidence.length === 0) return null;

  const lines = highConfidence.map((f) => `_🧠 ${f.shortStatement}_`);
  return lines.join("\n");
}
