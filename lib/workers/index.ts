/**
 * lib/workers/index.ts
 *
 * Event Worker Dispatcher.
 *
 * Processes background jobs from the ZURIA job queue.
 * Workers decouple heavy operations from the request path:
 *   - AI report generation
 *   - Parser learning batch jobs
 *   - Shadow learning analysis
 *   - Notification delivery
 *   - Timeline event creation
 *   - Risk score recalculation
 *
 * Called by Vercel cron or on-demand API route.
 *
 * Server-only.
 */

import { dequeue, completeJob, failJob, enqueue, type QueueJob } from "@/lib/queues";
import { getAdminDb } from "@/lib/firebase/admin";
import { collections } from "@/lib/firebase/collections";
import { createLogger } from "@/lib/observability/logger";

const logger = createLogger("worker");

// ─── Types ────────────────────────────────────────────────────────────────────

export type JobType =
  | "generate_report"
  | "recalculate_risk"
  | "refresh_timeline"
  | "run_parser_learning"
  | "send_notification"
  | "refresh_business_intelligence"
  | "prune_memory"
  | "run_reconciliation";

export interface WorkerResult {
  jobId: string;
  jobType: JobType;
  success: boolean;
  durationMs: number;
  error?: string;
}

// ─── Priority map ─────────────────────────────────────────────────────────────

/**
 * Returns the processing priority for a job type.
 * Lower number = higher priority.
 */
export function getJobTypePriority(type: JobType): number {
  const priorities: Record<JobType, number> = {
    send_notification: 1,
    recalculate_risk: 3,
    refresh_timeline: 4,
    generate_report: 5,
    run_parser_learning: 6,
    refresh_business_intelligence: 7,
    prune_memory: 8,
    run_reconciliation: 9,
  };
  return priorities[type];
}

// ─── Job dispatcher ───────────────────────────────────────────────────────────

/**
 * Routes a job to the correct handler function.
 * Each handler is responsible for its own error handling where relevant,
 * but dispatchJob itself may throw — callers should catch.
 */
export async function dispatchJob(job: QueueJob): Promise<void> {
  const type = job.type as JobType;
  const payload = job.payload as Record<string, unknown>;

  switch (type) {
    case "generate_report": {
      // Lazy import to avoid loading heavy AI dependencies on cold-start
      const { generateReport } = await import("@/lib/reports/executive");
      const userId = String(payload.userId ?? "");
      const businessId = String(payload.businessId ?? "");
      const period = (payload.period as "daily" | "weekly" | "monthly") ?? "daily";
      await generateReport(userId, businessId, [], [], period);
      break;
    }

    case "recalculate_risk": {
      // Lazy import to avoid loading heavy dependencies on cold-start
      const { getOrRefreshRiskScore } = await import("@/lib/risk");
      const businessId = String(payload.businessId ?? "");
      const userId = String(payload.userId ?? job.userId);
      await getOrRefreshRiskScore(userId, businessId, {
        transactions: [],
        debts: [],
        avgDailyRevenue: 0,
        avgDailyExpenses: 0,
        cashFlowPattern: "stable",
        activeDebtCount: 0,
        totalDebtOutstanding: 0,
      });
      break;
    }

    case "refresh_timeline": {
      const { refreshTimeline } = await import("@/lib/timeline");
      const businessId = String(payload.businessId ?? "");
      const userId = String(payload.userId ?? job.userId);
      const avgDailyRevenue = Number(payload.avgDailyRevenue ?? 0);
      await refreshTimeline(userId, businessId, [], [], avgDailyRevenue);
      break;
    }

    case "run_parser_learning": {
      // Lazy import to avoid loading NLP dependencies until needed
      const { analyzePatterns } = await import("@/lib/parser-learning/rule-generator");
      await analyzePatterns();
      break;
    }

    case "send_notification": {
      const db = getAdminDb();
      const notification = {
        userId: payload.userId ?? job.userId,
        businessId: payload.businessId ?? "",
        type: payload.type ?? "info",
        title: payload.title ?? "",
        message: payload.message ?? "",
        platform: payload.platform ?? "app",
        createdAt: new Date().toISOString(),
        read: false,
      };
      await db.collection(collections.notifications).add(notification);
      break;
    }

    case "refresh_business_intelligence": {
      const { getOrRefreshIntelligence } = await import("@/lib/business-intelligence");
      const businessId = String(payload.businessId ?? "");
      const userId = String(payload.userId ?? job.userId);
      await getOrRefreshIntelligence(userId, businessId);
      break;
    }

    case "prune_memory": {
      // Lazy import to keep server bundle lean
      const { pruneExpiredMemory } = await import("@/lib/memory/decay");
      const businessId = String(payload.businessId ?? "");
      await pruneExpiredMemory(businessId);
      break;
    }

    case "run_reconciliation": {
      const { runReconciliation } = await import("@/lib/finance/ledger");
      const businessId = String(payload.businessId ?? "");
      await runReconciliation(businessId);
      break;
    }

    default: {
      // Exhaustiveness guard — unknown job types are logged and completed
      const exhaustiveCheck: never = type;
      logger.warn("Unknown job type — marking complete", { jobId: job.id, type: exhaustiveCheck });
      break;
    }
  }
}

// ─── Batch processor ──────────────────────────────────────────────────────────

/**
 * Dequeues up to `batchSize` jobs, dispatches each one, and marks them
 * complete or failed. One job failure never blocks the others.
 *
 * @returns Array of WorkerResult — one entry per processed job.
 */
export async function processJobBatch(batchSize = 5): Promise<WorkerResult[]> {
  const jobs = await dequeue(batchSize);
  const results: WorkerResult[] = [];

  for (const job of jobs) {
    const start = Date.now();
    const jobType = job.type as JobType;

    try {
      await dispatchJob(job);
      await completeJob(job.id);

      results.push({
        jobId: job.id,
        jobType,
        success: true,
        durationMs: Date.now() - start,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      await failJob(job.id, errorMessage);

      results.push({
        jobId: job.id,
        jobType,
        success: false,
        durationMs: Date.now() - start,
        error: errorMessage,
      });
    }
  }

  return results;
}

// ─── enqueueJob ───────────────────────────────────────────────────────────────

/**
 * Convenience wrapper around the queue's `enqueue` function.
 * Maps worker JobType → QueueJobType and applies priority-based defaults.
 *
 * @returns The jobId, or an empty string on failure.
 */
export async function enqueueJob(
  type: JobType,
  payload: Record<string, unknown>,
  options?: { delayMs?: number; priority?: number },
): Promise<string> {
  const userId = String(payload.userId ?? "system");
  const delayMs = options?.delayMs ?? 0;

  // Map the worker's richer JobType to the queue's QueueJobType
  // The queue uses a narrower set of internal types; we use "memory_refresh"
  // as a catch-all for internal maintenance jobs.
  const queueTypeMap: Record<JobType, Parameters<typeof enqueue>[0]> = {
    generate_report: "report_generation",
    recalculate_risk: "memory_refresh",
    refresh_timeline: "memory_refresh",
    run_parser_learning: "parser_learning",
    send_notification: "notification_send",
    refresh_business_intelligence: "memory_refresh",
    prune_memory: "memory_refresh",
    run_reconciliation: "memory_refresh",
  };

  const queueType = queueTypeMap[type];
  const jobId = await enqueue(queueType, { ...payload, workerJobType: type }, userId, delayMs);
  return jobId;
}
