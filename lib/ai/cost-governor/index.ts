/**
 * lib/ai/cost-governor/index.ts
 *
 * AI Cost Governor — per-plan AI limits, dynamic model routing based on
 * subscription tier, profitability tracking, and abuse detection.
 *
 * Extends lib/ai/cost-governance.ts with plan-aware limits and routing.
 *
 * Server-only: firebase-admin.
 */

import { getAdminDb } from "@/lib/firebase/admin";
import { collections } from "@/lib/firebase/collections";
import {
  getDailyAISpend,
  COST_PER_1K_INPUT_TOKENS,
  COST_PER_1K_OUTPUT_TOKENS,
} from "../cost-governance";
import type { SubscriptionPlan } from "@/types/domain";

// ─── Per-plan AI budgets ──────────────────────────────────────────────────────

/**
 * Daily AI cost budget per plan (USD).
 *
 * Free users get minimal AI; Enterprise gets much higher.
 * These drive profitability: GHS 100/mo Enterprise ≈ ~$9 USD.
 * At $0.10/day budget, 30-day cost = $3 — safe margin.
 */
export const PLAN_DAILY_AI_BUDGET_USD: Record<SubscriptionPlan, number> = {
  free:       0.02,   // ~4-8 fast-model calls/day
  growth:     0.08,   // ~16-32 fast-model calls/day
  pro:        0.25,   // mix of fast + advanced
  enterprise: 0.50,   // full advanced model access
};

/**
 * Model tiers allowed per plan.
 *  - "fast"     = llama-3.1-8b-instant (cheap, good quality)
 *  - "advanced" = deepseek-r1-distill-llama-70b (expensive, best quality)
 *  - "guard"    = prompt-guard (minimal cost, safety)
 */
export const PLAN_ALLOWED_MODELS: Record<SubscriptionPlan, ("fast" | "advanced" | "guard")[]> = {
  free:       ["fast", "guard"],
  growth:     ["fast", "guard"],
  pro:        ["fast", "advanced", "guard"],
  enterprise: ["fast", "advanced", "guard"],
};

// ─── Types ────────────────────────────────────────────────────────────────────

export type ModelTier = "fast" | "advanced" | "guard";

export interface RoutingDecision {
  /** The model tier to use */
  model: ModelTier;
  /** Why this model was chosen */
  reason: string;
  /** If true, AI is disabled for this user right now */
  aiBlocked: boolean;
  /** Human-friendly message if blocked */
  blockMessage?: string;
}

export interface PlanAIStats {
  userId: string;
  plan: SubscriptionPlan;
  dailySpendUSD: number;
  dailyBudgetUSD: number;
  budgetUsedPct: number;
  isOverBudget: boolean;
  allowedModels: ModelTier[];
  estimatedCallsRemaining: number;
}

// ─── Budget Check ─────────────────────────────────────────────────────────────

/**
 * Check if a user's plan has AI budget remaining today.
 */
export async function checkAIBudget(
  userId: string,
  plan: SubscriptionPlan,
): Promise<{ allowed: boolean; spendUSD: number; budgetUSD: number }> {
  try {
    const spendUSD  = await getDailyAISpend(userId);
    const budgetUSD = PLAN_DAILY_AI_BUDGET_USD[plan];
    return { allowed: spendUSD < budgetUSD, spendUSD, budgetUSD };
  } catch {
    return { allowed: true, spendUSD: 0, budgetUSD: PLAN_DAILY_AI_BUDGET_USD[plan] };
  }
}

// ─── Dynamic Model Router ─────────────────────────────────────────────────────

/**
 * Decide which AI model to use based on:
 * 1. The user's subscription plan
 * 2. The required intelligence level (from confidence tier)
 * 3. Remaining daily budget
 *
 * Always degrades gracefully — never blocks a free user from their
 * entitled fast-model calls if budget is available.
 */
export async function routeAIModel(
  userId: string,
  plan: SubscriptionPlan,
  requestedTier: "fast" | "advanced" = "fast",
): Promise<RoutingDecision> {
  const allowed       = PLAN_ALLOWED_MODELS[plan];
  const budgetCheck   = await checkAIBudget(userId, plan);

  // Budget exhausted
  if (!budgetCheck.allowed) {
    return {
      model:      "fast",
      reason:     "Daily AI budget exhausted — degraded to fast model",
      aiBlocked:  false, // still respond, just with fast model
      blockMessage: undefined,
    };
  }

  // User wants advanced but plan doesn't allow it — route to fast
  if (requestedTier === "advanced" && !allowed.includes("advanced")) {
    return {
      model:  "fast",
      reason: `Plan "${plan}" does not include advanced model — using fast`,
      aiBlocked: false,
    };
  }

  return {
    model:     requestedTier,
    reason:    `Plan "${plan}" — using ${requestedTier} model within budget`,
    aiBlocked: false,
  };
}

// ─── Usage Analytics ──────────────────────────────────────────────────────────

/**
 * Get AI usage statistics for a user today.
 */
export async function getPlanAIStats(
  userId: string,
  plan: SubscriptionPlan,
): Promise<PlanAIStats> {
  const dailySpendUSD  = await getDailyAISpend(userId);
  const dailyBudgetUSD = PLAN_DAILY_AI_BUDGET_USD[plan];
  const budgetUsedPct  = Math.min(100, (dailySpendUSD / dailyBudgetUSD) * 100);
  const isOverBudget   = dailySpendUSD >= dailyBudgetUSD;
  const allowedModels  = PLAN_ALLOWED_MODELS[plan];

  // Estimate calls remaining (using fast model cost as baseline)
  const fastCallCost    = ((150 / 1_000) * COST_PER_1K_INPUT_TOKENS.fast) +
                          ((200 / 1_000) * COST_PER_1K_OUTPUT_TOKENS.fast);
  const remaining       = dailyBudgetUSD - dailySpendUSD;
  const callsRemaining  = fastCallCost > 0 ? Math.floor(remaining / fastCallCost) : 0;

  return {
    userId,
    plan,
    dailySpendUSD,
    dailyBudgetUSD,
    budgetUsedPct,
    isOverBudget,
    allowedModels,
    estimatedCallsRemaining: Math.max(0, callsRemaining),
  };
}

// ─── Abuse Detection ──────────────────────────────────────────────────────────

/**
 * Check for AI abuse signals — unusually high call rates that
 * suggest automation or prompt injection attacks.
 *
 * Returns true if the user appears to be abusing AI calls.
 * Fails open (returns false) on errors.
 */
export async function detectAIAbuse(userId: string): Promise<boolean> {
  try {
    const db   = getAdminDb();
    const now  = new Date();
    const hour = new Date(now.getTime() - 60 * 60 * 1_000).toISOString();

    const snap = await db
      .collection(collections.aiUsageLogs)
      .where("userId", "==", userId)
      .where("timestamp", ">=", hour)
      .get();

    // More than 100 AI calls in the last hour is suspicious
    return snap.size > 100;
  } catch {
    return false;
  }
}

// ─── Platform-wide cost summary ───────────────────────────────────────────────

export interface PlatformCostSummary {
  today:     { totalUSD: number; callCount: number };
  thisWeek:  { totalUSD: number; callCount: number };
  thisMonth: { totalUSD: number; callCount: number };
  byModel:   Record<string, { callCount: number; totalUSD: number }>;
  byPlan:    Record<string, { callCount: number; totalUSD: number }>;
  generatedAt: string;
}

/**
 * Get platform-wide AI cost summary for admin dashboard.
 * Never throws.
 */
export async function getPlatformCostSummary(): Promise<PlatformCostSummary> {
  const empty: PlatformCostSummary = {
    today:      { totalUSD: 0, callCount: 0 },
    thisWeek:   { totalUSD: 0, callCount: 0 },
    thisMonth:  { totalUSD: 0, callCount: 0 },
    byModel:    {},
    byPlan:     {},
    generatedAt: new Date().toISOString(),
  };

  try {
    const db    = getAdminDb();
    const now   = new Date();

    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

    const snap = await db
      .collection(collections.aiUsageLogs)
      .where("timestamp", ">=", monthStart)
      .orderBy("timestamp", "desc")
      .limit(10_000)
      .get();

    const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
    const weekStart  = new Date(now.getTime() - 7 * 86_400_000).toISOString();

    const summary = { ...empty, generatedAt: new Date().toISOString() };

    for (const doc of snap.docs) {
      const d    = doc.data() as { timestamp: string; estimatedCostUSD?: number; model?: string; routingPath?: string };
      const cost = d.estimatedCostUSD ?? 0;
      const model = d.model ?? "unknown";

      summary.thisMonth.totalUSD   += cost;
      summary.thisMonth.callCount  += 1;

      if (d.timestamp >= todayStart) {
        summary.today.totalUSD  += cost;
        summary.today.callCount += 1;
      }
      if (d.timestamp >= weekStart) {
        summary.thisWeek.totalUSD  += cost;
        summary.thisWeek.callCount += 1;
      }

      summary.byModel[model] ??= { callCount: 0, totalUSD: 0 };
      summary.byModel[model].callCount++;
      summary.byModel[model].totalUSD += cost;
    }

    return summary;
  } catch {
    return empty;
  }
}
