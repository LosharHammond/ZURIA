/**
 * lib/risk/index.ts
 *
 * Financial Risk Engine.
 *
 * Computes a comprehensive financial risk score for a business based on:
 *   - Debt behavior and repayment history
 *   - Revenue consistency and growth trend
 *   - Inventory turnover
 *   - Expense volatility
 *   - Operational discipline
 *   - Cash flow stability
 *
 * This score enables future embedded finance, lending, supplier trust,
 * and credit intelligence — a VERY strategic asset.
 *
 * Server-only.
 */

import { getAdminDb } from "@/lib/firebase/admin";
import type { Transaction, Debt } from "@/types/domain";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RiskScore {
  businessId: string;
  overallScore: number;       // 0–100 (higher = safer, like a credit score)
  riskLevel: "very_low" | "low" | "medium" | "high" | "very_high";
  components: {
    debtBehavior: number;          // 0–20
    revenueConsistency: number;    // 0–20
    expenseVolatility: number;     // 0–20
    operationalDiscipline: number; // 0–20
    cashFlowStability: number;     // 0–20
  };
  flags: RiskFlag[];
  lendingEligible: boolean;        // score >= 60 and no critical flags
  supplierTrustScore: number;      // 0–100 for supplier trust
  generatedAt: string;
}

export interface RiskFlag {
  code: string;         // e.g. "HIGH_DEBT_RATIO", "REVENUE_DECLINING"
  severity: "critical" | "warning" | "info";
  description: string;
  metric?: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const REVENUE_TYPES = ["sale", "repayment"] as const;
const EXPENSE_TYPES = ["expense", "cost", "salary", "tax"] as const;

function toDateKey(isoTs: string): string {
  return isoTs.slice(0, 10);
}

function uniqueDaysWithActivity(transactions: Transaction[], types: string[]): Set<string> {
  const days = new Set<string>();
  for (const t of transactions) {
    if (types.includes(t.type)) {
      days.add(toDateKey(t.createdAt));
    }
  }
  return days;
}

function sumByTypes(txns: Transaction[], types: readonly string[]): number {
  return txns.reduce((acc, t) => (types.includes(t.type) ? acc + t.amount : acc), 0);
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}

// ─── computeRiskScore ─────────────────────────────────────────────────────────

export function computeRiskScore(params: {
  businessId: string;
  transactions: Transaction[];
  debts: Debt[];
  avgDailyRevenue: number;
  avgDailyExpenses: number;
  cashFlowPattern: string;
  activeDebtCount: number;
  totalDebtOutstanding: number;
}): RiskScore {
  const {
    businessId,
    transactions,
    debts: _debts,
    avgDailyRevenue,
    avgDailyExpenses,
    cashFlowPattern,
    activeDebtCount,
    totalDebtOutstanding,
  } = params;

  const now = new Date().toISOString();
  const weeklyRevenue = avgDailyRevenue * 7;

  // ── debtBehavior (0–20) ───────────────────────────────────────────────────
  let debtBehavior = 20;
  const debtRatio = weeklyRevenue > 0 ? totalDebtOutstanding / weeklyRevenue : 0;
  if (debtRatio > 4) debtBehavior -= 10;
  else if (debtRatio > 2) debtBehavior -= 5;
  if (activeDebtCount > 15) debtBehavior -= 5;
  else if (activeDebtCount > 8) debtBehavior -= 3;
  if (activeDebtCount === 0) debtBehavior = Math.min(20, debtBehavior + 2);
  debtBehavior = Math.max(0, debtBehavior);

  // ── revenueConsistency (0–20) ─────────────────────────────────────────────
  const cutoff14 = daysAgo(14);
  const last14Txns = transactions.filter((t) => t.createdAt >= cutoff14);
  const activeDaysIn14 = uniqueDaysWithActivity(last14Txns, [...REVENUE_TYPES]).size;
  let revenueConsistency: number;
  if (activeDaysIn14 >= 8) revenueConsistency = 20;
  else if (activeDaysIn14 >= 5) revenueConsistency = 15;
  else if (activeDaysIn14 >= 3) revenueConsistency = 10;
  else if (activeDaysIn14 >= 1) revenueConsistency = 5;
  else revenueConsistency = 0;

  // ── expenseVolatility (0–20) ──────────────────────────────────────────────
  let expenseVolatility = 20;
  const expenseRatio =
    avgDailyRevenue > 0 ? avgDailyExpenses / avgDailyRevenue : 1;
  if (expenseRatio > 0.9) expenseVolatility -= 15;
  else if (expenseRatio > 0.75) expenseVolatility -= 8;
  else if (expenseRatio > 0.6) expenseVolatility -= 3;
  expenseVolatility = Math.max(0, expenseVolatility);

  // ── operationalDiscipline (0–20) ──────────────────────────────────────────
  const cutoff7 = daysAgo(7);
  const last7Txns = transactions.filter((t) => t.createdAt >= cutoff7);
  const recordingDays = new Set(last7Txns.map((t) => toDateKey(t.createdAt))).size;
  let operationalDiscipline: number;
  if (recordingDays >= 6) operationalDiscipline = 20;
  else if (recordingDays >= 4) operationalDiscipline = 15;
  else if (recordingDays >= 2) operationalDiscipline = 10;
  else operationalDiscipline = 5;

  // ── cashFlowStability (0–20) ──────────────────────────────────────────────
  let cashFlowStability: number;
  if (cashFlowPattern === "stable" || cashFlowPattern === "growing") cashFlowStability = 20;
  else if (cashFlowPattern === "volatile") cashFlowStability = 10;
  else cashFlowStability = 5; // declining or unknown

  // ── overallScore ──────────────────────────────────────────────────────────
  const overallScore =
    debtBehavior +
    revenueConsistency +
    expenseVolatility +
    operationalDiscipline +
    cashFlowStability;

  // ── riskLevel ─────────────────────────────────────────────────────────────
  let riskLevel: RiskScore["riskLevel"];
  if (overallScore >= 80) riskLevel = "very_low";
  else if (overallScore >= 65) riskLevel = "low";
  else if (overallScore >= 45) riskLevel = "medium";
  else if (overallScore >= 25) riskLevel = "high";
  else riskLevel = "very_high";

  // ── flags ─────────────────────────────────────────────────────────────────
  const flags: RiskFlag[] = [];

  // Critical flags
  if (weeklyRevenue > 0 && debtRatio > 3) {
    flags.push({
      code: "HIGH_DEBT_RATIO",
      severity: "critical",
      description: `Total outstanding debt is ${debtRatio.toFixed(1)}x your weekly revenue`,
      metric: debtRatio,
    });
  }

  if (cashFlowPattern === "declining" && revenueConsistency < 10) {
    flags.push({
      code: "REVENUE_DECLINING",
      severity: "critical",
      description: "Revenue is declining and activity is irregular — high risk signal",
    });
  }

  // Warning flags
  if (expenseRatio > 0.75) {
    flags.push({
      code: "HIGH_EXPENSE_RATIO",
      severity: "warning",
      description: `Expenses are ${Math.round(expenseRatio * 100)}% of revenue — leaving very thin margins`,
      metric: expenseRatio,
    });
  }

  if (activeDebtCount > 10) {
    flags.push({
      code: "MANY_DEBTORS",
      severity: "warning",
      description: `${activeDebtCount} customers currently owe you money — debt concentration risk`,
      metric: activeDebtCount,
    });
  }

  // ── lendingEligible ───────────────────────────────────────────────────────
  const hasCriticalFlag = flags.some((f) => f.severity === "critical");
  const lendingEligible = overallScore >= 60 && !hasCriticalFlag;

  // ── supplierTrustScore ────────────────────────────────────────────────────
  const isPositiveCashFlow =
    cashFlowPattern === "stable" || cashFlowPattern === "growing";
  const supplierTrustScore = isPositiveCashFlow
    ? Math.min(100, overallScore + 10)
    : Math.max(0, overallScore - 10);

  return {
    businessId,
    overallScore,
    riskLevel,
    components: {
      debtBehavior,
      revenueConsistency,
      expenseVolatility,
      operationalDiscipline,
      cashFlowStability,
    },
    flags,
    lendingEligible,
    supplierTrustScore,
    generatedAt: now,
  };
}

// ─── Default medium-risk score ────────────────────────────────────────────────

function defaultRiskScore(businessId: string): RiskScore {
  const now = new Date().toISOString();
  return {
    businessId,
    overallScore: 50,
    riskLevel: "medium",
    components: {
      debtBehavior: 10,
      revenueConsistency: 10,
      expenseVolatility: 10,
      operationalDiscipline: 10,
      cashFlowStability: 10,
    },
    flags: [],
    lendingEligible: false,
    supplierTrustScore: 50,
    generatedAt: now,
  };
}

// ─── getOrRefreshRiskScore ────────────────────────────────────────────────────

const RISK_SCORES_COLLECTION = "risk_scores";
const TTL_MS = 2 * 60 * 60 * 1000; // 2-hour cache

/**
 * Reads from Firestore "risk_scores" collection with a 2-hour TTL.
 * If stale or missing: calls computeRiskScore, saves fire-and-forget, returns fresh score.
 * Returns a medium-risk default score on any error.
 */
export async function getOrRefreshRiskScore(
  _userId: string,
  businessId: string,
  params: Omit<Parameters<typeof computeRiskScore>[0], "businessId">,
): Promise<RiskScore> {
  try {
    const db = getAdminDb();
    const docRef = db.collection(RISK_SCORES_COLLECTION).doc(businessId);
    const snap = await docRef.get();

    if (snap.exists) {
      const cached = snap.data() as RiskScore;
      const age = Date.now() - new Date(cached.generatedAt).getTime();
      if (age < TTL_MS) return cached;
    }

    const fresh = computeRiskScore({ ...params, businessId });

    // fire-and-forget
    docRef.set(fresh, { merge: true }).catch(() => undefined);

    return fresh;
  } catch {
    return defaultRiskScore(businessId);
  }
}

// ─── Re-export all types ──────────────────────────────────────────────────────

export type { Transaction, Debt };
