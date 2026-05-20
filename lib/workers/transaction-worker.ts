/**
 * lib/workers/transaction-worker.ts
 *
 * Transaction Event Worker.
 *
 * Handles all downstream effects of a new transaction:
 *   - Updates business intelligence
 *   - Refreshes risk score
 *   - Creates timeline events
 *   - Triggers parser learning if low confidence
 *   - Enqueues report generation if daily threshold met
 *
 * Fire-and-forget from the request path. Never throws.
 *
 * Server-only.
 */

import type { Transaction } from "@/types/domain";
import { enqueueJob } from "@/lib/workers/index";
import { createLogger } from "@/lib/observability/logger";

const logger = createLogger("transaction-worker");

// ─── handleTransactionCreated ─────────────────────────────────────────────────

/**
 * Orchestrates all downstream effects when a new transaction is created.
 *
 * Individually wraps every enqueue call so one failure never stops others.
 * Never throws — safe to fire-and-forget from the request path.
 */
export async function handleTransactionCreated(params: {
  userId: string;
  businessId: string;
  transaction: Transaction;
  parserConfidence: number;
  usedAI: boolean;
}): Promise<void> {
  const { userId, businessId, transaction, parserConfidence } = params;

  // 1. Low-confidence parse → trigger parser learning batch
  if (parserConfidence < 0.6) {
    try {
      await enqueueJob(
        "run_parser_learning",
        { userId, businessId, transactionId: transaction.id },
      );
      logger.info("enqueued run_parser_learning", { transactionId: transaction.id, confidence: parserConfidence });
    } catch (err) {
      logger.warn("failed to enqueue run_parser_learning", { error: String(err) });
    }
  }

  // 2. Debt records → recalculate risk score (delayed 30 s to let writes settle)
  // "debt" is the correct TransactionType for credit sales (customer owes you).
  if (transaction.type === "debt") {
    try {
      await enqueueJob(
        "recalculate_risk",
        { userId, businessId, transactionId: transaction.id },
        { delayMs: 30_000 },
      );
      logger.info("enqueued recalculate_risk (30s delay)", { transactionId: transaction.id });
    } catch (err) {
      logger.warn("failed to enqueue recalculate_risk", { error: String(err) });
    }
  }

  // 3. Large transactions → refresh business intelligence
  if (transaction.amount > 500) {
    try {
      await enqueueJob(
        "refresh_business_intelligence",
        { userId, businessId, transactionId: transaction.id },
      );
      logger.info("enqueued refresh_business_intelligence", { transactionId: transaction.id, amount: transaction.amount });
    } catch (err) {
      logger.warn("failed to enqueue refresh_business_intelligence", { error: String(err) });
    }
  }

  // 4. Always refresh the timeline
  try {
    await enqueueJob(
      "refresh_timeline",
      { userId, businessId, transactionId: transaction.id },
    );
    logger.info("enqueued refresh_timeline", { transactionId: transaction.id });
  } catch (err) {
    logger.warn("failed to enqueue refresh_timeline", { error: String(err) });
  }

  // 5. End-of-day (≥ 20:00) → generate daily executive report
  const currentHour = new Date().getHours();
  if (currentHour >= 20) {
    try {
      await enqueueJob(
        "generate_report",
        { userId, businessId, period: "daily" },
      );
      logger.info("enqueued generate_report (end-of-day)", { userId, businessId });
    } catch (err) {
      logger.warn("failed to enqueue generate_report", { error: String(err) });
    }
  }
}

// ─── handleDebtUpdated ────────────────────────────────────────────────────────

/**
 * Enqueues a risk recalculation when a debt balance changes significantly
 * (more than 20% relative change).
 *
 * Never throws — safe to fire-and-forget.
 */
export async function handleDebtUpdated(params: {
  userId: string;
  businessId: string;
  debtId: string;
  newBalance: number;
  oldBalance: number;
}): Promise<void> {
  const { userId, businessId, debtId, newBalance, oldBalance } = params;

  // Guard against division by zero; treat any change from zero as significant
  const changePct =
    oldBalance === 0
      ? newBalance > 0
        ? 1
        : 0
      : Math.abs(newBalance - oldBalance) / oldBalance;

  if (changePct > 0.2) {
    try {
      await enqueueJob(
        "recalculate_risk",
        { userId, businessId, debtId, newBalance, oldBalance },
      );
      logger.info("enqueued recalculate_risk (debt updated)", { debtId, changePct: (changePct * 100).toFixed(1) + "%" });
    } catch (err) {
      logger.warn("failed to enqueue recalculate_risk for debt update", { debtId, error: String(err) });
    }
  }
}
