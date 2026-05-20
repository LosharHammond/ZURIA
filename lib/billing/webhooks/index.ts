/**
 * lib/billing/webhooks/index.ts
 *
 * Webhook queue management — dead-letter handling, retry scheduling,
 * queue health metrics, and failure categorization.
 *
 * Server-only: firebase-admin.
 */

import { getAdminDb } from "@/lib/firebase/admin";
import { collections } from "@/lib/firebase/collections";

// ─── Types ────────────────────────────────────────────────────────────────────

export type WebhookQueueStatus = "pending" | "processing" | "done" | "dead" | "failed";

export interface WebhookQueueEntry {
  id: string;
  eventType: string;
  data: Record<string, unknown>;
  receivedAt: string;
  status: WebhookQueueStatus;
  attempts: number;
  maxAttempts: number;
  nextRetryAt: string;
  lastError?: string;
  processedAt?: string;
}

export interface WebhookQueueStats {
  pending: number;
  processing: number;
  done: number;
  dead: number;
  failed: number;
  total: number;
  oldestPendingAt: string | null;
  deadLetters: WebhookQueueEntry[];
}

export interface DeadLetterEntry {
  id: string;
  originalId: string;
  eventType: string;
  data: Record<string, unknown>;
  receivedAt: string;
  failedAt: string;
  attempts: number;
  lastError: string;
  status: "pending_review" | "replayed" | "resolved" | "ignored";
}

// ─── Queue Health ─────────────────────────────────────────────────────────────

/**
 * Returns webhook queue statistics.
 * Never throws.
 */
export async function getWebhookQueueStats(): Promise<WebhookQueueStats> {
  const empty: WebhookQueueStats = {
    pending: 0, processing: 0, done: 0, dead: 0, failed: 0,
    total: 0, oldestPendingAt: null, deadLetters: [],
  };

  try {
    const db  = getAdminDb();
    const col = db.collection(collections.webhookQueue);

    const [pendingSnap, processingSnap, doneSnap, deadSnap, failedSnap] = await Promise.all([
      col.where("status", "==", "pending").get(),
      col.where("status", "==", "processing").get(),
      col.where("status", "==", "done").limit(1).get(), // just count
      col.where("status", "==", "dead").orderBy("receivedAt", "desc").limit(20).get(),
      col.where("status", "==", "failed").get(),
    ]);

    const deadLetters = deadSnap.docs.map((d) => d.data() as WebhookQueueEntry);

    // Find oldest pending entry
    let oldestPendingAt: string | null = null;
    for (const doc of pendingSnap.docs) {
      const entry = doc.data() as WebhookQueueEntry;
      if (!oldestPendingAt || entry.receivedAt < oldestPendingAt) {
        oldestPendingAt = entry.receivedAt;
      }
    }

    return {
      pending:         pendingSnap.size,
      processing:      processingSnap.size,
      done:            doneSnap.size,
      dead:            deadSnap.size,
      failed:          failedSnap.size,
      total:           pendingSnap.size + processingSnap.size + deadSnap.size + failedSnap.size,
      oldestPendingAt,
      deadLetters,
    };
  } catch {
    return empty;
  }
}

// ─── Dead-Letter Management ───────────────────────────────────────────────────

/**
 * Move a webhook queue entry to the dead-letter collection for review.
 * Called automatically after maxAttempts is exceeded.
 * Idempotent — uses deterministic doc ID.
 */
export async function moveToDeadLetter(
  entry: WebhookQueueEntry,
  lastError: string,
): Promise<void> {
  try {
    const db           = getAdminDb();
    const deadLetterId = `dl_${entry.id}`;
    const now          = new Date().toISOString();

    const deadEntry: DeadLetterEntry = {
      id:           deadLetterId,
      originalId:   entry.id,
      eventType:    entry.eventType,
      data:         entry.data,
      receivedAt:   entry.receivedAt,
      failedAt:     now,
      attempts:     entry.attempts,
      lastError,
      status:       "pending_review",
    };

    await db.runTransaction(async (txn) => {
      const queueRef  = db.collection(collections.webhookQueue).doc(entry.id);
      const deadRef   = db.collection(collections.billingDeadLetters).doc(deadLetterId);

      txn.update(queueRef, { status: "dead", lastError, processedAt: now });
      txn.set(deadRef, deadEntry, { merge: true });
    });
  } catch {
    // Non-fatal — cron will re-attempt
  }
}

/**
 * Replay a dead-letter entry — resets it back to "pending" in the queue
 * so the worker will process it again.
 *
 * Returns true on success.
 */
export async function replayDeadLetter(deadLetterId: string): Promise<boolean> {
  try {
    const db      = getAdminDb();
    const deadRef = db.collection(collections.billingDeadLetters).doc(deadLetterId);
    const deadSnap = await deadRef.get();

    if (!deadSnap.exists) return false;

    const dead     = deadSnap.data() as DeadLetterEntry;
    const now      = new Date().toISOString();
    const queueRef = db.collection(collections.webhookQueue).doc(dead.originalId);

    await db.runTransaction(async (txn) => {
      txn.set(queueRef, {
        id:          dead.originalId,
        eventType:   dead.eventType,
        data:        dead.data,
        receivedAt:  dead.receivedAt,
        status:      "pending",
        attempts:    0,
        maxAttempts: 5,
        nextRetryAt: now,
      }, { merge: false });
      txn.update(deadRef, { status: "replayed", replayedAt: now });
    });

    return true;
  } catch {
    return false;
  }
}

/**
 * List unresolved dead-letter entries.
 */
export async function listDeadLetters(limit = 50): Promise<DeadLetterEntry[]> {
  try {
    const db  = getAdminDb();
    const snap = await db
      .collection(collections.billingDeadLetters)
      .where("status", "==", "pending_review")
      .orderBy("failedAt", "desc")
      .limit(limit)
      .get();
    return snap.docs.map((d) => d.data() as DeadLetterEntry);
  } catch {
    return [];
  }
}

/**
 * Mark a dead-letter as resolved (no replay needed).
 */
export async function resolveDeadLetter(deadLetterId: string, note?: string): Promise<void> {
  try {
    const db = getAdminDb();
    await db.collection(collections.billingDeadLetters).doc(deadLetterId).update({
      status:     "resolved",
      resolvedAt: new Date().toISOString(),
      ...(note ? { resolvedNote: note } : {}),
    });
  } catch {
    // Non-fatal
  }
}
