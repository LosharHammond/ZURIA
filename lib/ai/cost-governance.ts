// FILE: lib/ai/cost-governance.ts
// Server-only — AI usage metering and budget control.

import { getAdminDb } from "@/lib/firebase/admin";
import { createLogger } from "@/lib/observability/logger";

const logger = createLogger("ai:cost-governance");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AIUsageRecord {
  id: string;
  userId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** Rough USD estimate */
  estimatedCostUSD: number;
  latencyMs: number;
  routingPath: string;
  timestamp: string;
}

// ─── Cost Tables (USD per 1 000 tokens) ──────────────────────────────────────

export const COST_PER_1K_INPUT_TOKENS: Record<"fast" | "advanced" | "guard", number> = {
  fast:     0.00005,
  advanced: 0.00035,
  guard:    0.00002,
};

export const COST_PER_1K_OUTPUT_TOKENS: Record<"fast" | "advanced" | "guard", number> = {
  fast:     0.00008,
  advanced: 0.00050,
  guard:    0.00002,
};

/** Per-user daily AI budget (50 cents USD). */
export const DAILY_AI_BUDGET_USD = 0.50;

// ─── Cost Estimation ──────────────────────────────────────────────────────────

export function estimateCost(
  model: "fast" | "advanced" | "guard",
  inputTokens: number,
  outputTokens: number,
): number {
  const inputCost  = (inputTokens  / 1_000) * COST_PER_1K_INPUT_TOKENS[model];
  const outputCost = (outputTokens / 1_000) * COST_PER_1K_OUTPUT_TOKENS[model];
  return inputCost + outputCost;
}

// ─── Usage Recording ──────────────────────────────────────────────────────────

/**
 * Fire-and-forget write to Firestore `ai_usage_logs`.
 * All errors are caught silently — never throws.
 */
export async function recordAIUsage(
  record: Omit<AIUsageRecord, "id" | "timestamp">,
): Promise<void> {
  try {
    const db  = getAdminDb();
    const col = db.collection("ai_usage_logs");
    const ref = col.doc(); // auto-generated ID

    await ref.set({
      ...record,
      id:        ref.id,
      timestamp: new Date().toISOString(),
    });
  } catch (err: unknown) {
    // Silently swallow — usage logging must never affect the request path
    logger.warn("recordAIUsage failed silently", { err: String(err) });
  }
}

// ─── Feature Flags ────────────────────────────────────────────────────────────

/** Returns true unless AI_ENABLED is explicitly set to "false". */
export function isAIEnabled(): boolean {
  return process.env.AI_ENABLED !== "false";
}

/** Returns true unless the model-specific flag is explicitly "false". */
export function isModelEnabled(model: "fast" | "advanced" | "guard"): boolean {
  switch (model) {
    case "fast":
      return process.env.AI_FAST_ENABLED !== "false";
    case "advanced":
      return process.env.AI_ADVANCED_ENABLED !== "false";
    case "guard":
      return process.env.AI_GUARD_ENABLED !== "false";
  }
}

// ─── Budget Enforcement ───────────────────────────────────────────────────────

/**
 * Sums the estimated cost for a given user across all records written today.
 * Returns 0 on any Firestore error.
 */
export async function getDailyAISpend(userId: string): Promise<number> {
  try {
    const db = getAdminDb();

    // Build today's UTC date range
    const now        = new Date();
    const startOfDay = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0),
    );
    const endOfDay = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999),
    );

    const snapshot = await db
      .collection("ai_usage_logs")
      .where("userId", "==", userId)
      .where("timestamp", ">=", startOfDay.toISOString())
      .where("timestamp", "<=", endOfDay.toISOString())
      .get();

    let total = 0;
    snapshot.forEach((doc) => {
      const data = doc.data() as Partial<AIUsageRecord>;
      total += typeof data.estimatedCostUSD === "number" ? data.estimatedCostUSD : 0;
    });

    return total;
  } catch (err: unknown) {
    logger.warn("getDailyAISpend failed", { err: String(err) });
    return 0;
  }
}

/**
 * Returns true if the user has exceeded their daily AI budget.
 * Defaults to false on any error (fail-open to preserve UX).
 */
export async function isOverBudget(userId: string): Promise<boolean> {
  try {
    const spend = await getDailyAISpend(userId);
    return spend >= DAILY_AI_BUDGET_USD;
  } catch {
    return false;
  }
}
