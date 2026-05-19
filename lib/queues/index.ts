/**
 * ZURIA Queue Infrastructure
 *
 * Lightweight job queue backed by Firestore. Provides retry semantics,
 * exponential backoff, and dead-letter handling — no Redis or BullMQ required.
 */

import { getAdminDb } from "@/lib/firebase/admin";
import { createLogger } from "@/lib/observability/logger";

const logger = createLogger("queue");

// ─── Types ────────────────────────────────────────────────────────────────────

export type QueueJobStatus = "pending" | "processing" | "done" | "failed" | "dead";

export type QueueJobType =
  | "ai_request"
  | "report_generation"
  | "parser_learning"
  | "shadow_learn"
  | "memory_refresh"
  | "notification_send";

export interface QueueJob<T = Record<string, unknown>> {
  id: string;
  type: QueueJobType;
  payload: T;
  status: QueueJobStatus;
  attempts: number;
  maxAttempts: number;
  scheduledAt: string;
  processedAt: string | null;
  error: string | null;
  createdAt: string;
  userId: string;
}

// ─── Internal Firestore document shape ───────────────────────────────────────

type QueueJobDoc = Omit<QueueJob, "id">;

const COLLECTION = "job_queue";

// ─── enqueue ─────────────────────────────────────────────────────────────────

/**
 * Add a job to the queue.
 * @returns The job id, or an empty string on failure.
 */
export async function enqueue<T extends Record<string, unknown>>(
  type: QueueJobType,
  payload: T,
  userId: string,
  delayMs = 0,
): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date();

  const job: QueueJobDoc = {
    type,
    payload,
    status: "pending",
    attempts: 0,
    maxAttempts: 3,
    scheduledAt: new Date(now.getTime() + delayMs).toISOString(),
    processedAt: null,
    error: null,
    createdAt: now.toISOString(),
    userId,
  };

  try {
    const db = getAdminDb();
    await db.collection(COLLECTION).doc(id).set(job);
    logger.info("Job enqueued", { id, type, userId, delayMs });
    return id;
  } catch (err) {
    logger.error("Failed to enqueue job", {
      type,
      userId,
      error: String(err),
    });
    return "";
  }
}

// ─── dequeue ─────────────────────────────────────────────────────────────────

/**
 * Claim up to `limit` pending jobs whose scheduledAt <= now.
 * Marks them as "processing" atomically in a batch write.
 * @returns Array of claimed jobs, or [] on failure.
 */
export async function dequeue(limit = 10): Promise<QueueJob[]> {
  try {
    const db = getAdminDb();
    const now = new Date().toISOString();

    const snapshot = await db
      .collection(COLLECTION)
      .where("status", "==", "pending")
      .where("scheduledAt", "<=", now)
      .limit(limit)
      .get();

    if (snapshot.empty) return [];

    const batch = db.batch();
    const jobs: QueueJob[] = [];

    for (const doc of snapshot.docs) {
      batch.update(doc.ref, { status: "processing" as QueueJobStatus });
      const data = doc.data() as QueueJobDoc;
      jobs.push({ id: doc.id, ...data });
    }

    await batch.commit();

    logger.info("Jobs dequeued", { count: jobs.length });
    return jobs;
  } catch (err) {
    logger.error("Failed to dequeue jobs", { error: String(err) });
    return [];
  }
}

// ─── completeJob ─────────────────────────────────────────────────────────────

/**
 * Mark a job as successfully completed.
 */
export async function completeJob(id: string): Promise<void> {
  try {
    const db = getAdminDb();
    await db.collection(COLLECTION).doc(id).update({
      status: "done" as QueueJobStatus,
      processedAt: new Date().toISOString(),
    });
    logger.info("Job completed", { id });
  } catch (err) {
    logger.error("Failed to complete job", { id, error: String(err) });
  }
}

// ─── failJob ─────────────────────────────────────────────────────────────────

/**
 * Record a job failure. Retries with exponential backoff up to maxAttempts,
 * then marks the job "dead" for manual inspection.
 */
export async function failJob(id: string, error: string): Promise<void> {
  try {
    const db = getAdminDb();
    const docRef = db.collection(COLLECTION).doc(id);
    const snap = await docRef.get();

    if (!snap.exists) {
      logger.warn("failJob: job not found", { id });
      return;
    }

    const data = snap.data() as QueueJobDoc;
    const newAttempts = data.attempts + 1;

    if (newAttempts >= data.maxAttempts) {
      await docRef.update({
        status: "dead" as QueueJobStatus,
        attempts: newAttempts,
        error,
        processedAt: new Date().toISOString(),
      });
      logger.warn("Job moved to dead letter queue", { id, attempts: newAttempts });
    } else {
      const backoffMs = newAttempts * 30_000; // 30s, 60s, 90s ...
      const retryAt = new Date(Date.now() + backoffMs).toISOString();

      await docRef.update({
        status: "pending" as QueueJobStatus,
        attempts: newAttempts,
        error,
        scheduledAt: retryAt,
      });
      logger.info("Job scheduled for retry", { id, attempts: newAttempts, retryAt });
    }
  } catch (err) {
    logger.error("Failed to record job failure", { id, error: String(err) });
  }
}

// ─── getQueueStats ───────────────────────────────────────────────────────────

export interface QueueStats {
  pending: number;
  processing: number;
  failed: number;
  dead: number;
}

/**
 * Retrieve current queue depth counts.
 */
export async function getQueueStats(): Promise<QueueStats> {
  const zero: QueueStats = { pending: 0, processing: 0, failed: 0, dead: 0 };

  try {
    const db = getAdminDb();
    const col = db.collection(COLLECTION);

    const [pendingSnap, processingSnap, failedSnap, deadSnap] = await Promise.all([
      col.where("status", "==", "pending").count().get(),
      col.where("status", "==", "processing").count().get(),
      col.where("status", "==", "failed").count().get(),
      col.where("status", "==", "dead").count().get(),
    ]);

    return {
      pending:    pendingSnap.data().count,
      processing: processingSnap.data().count,
      failed:     failedSnap.data().count,
      dead:       deadSnap.data().count,
    };
  } catch (err) {
    logger.error("Failed to fetch queue stats", { error: String(err) });
    return zero;
  }
}

