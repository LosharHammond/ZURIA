/**
 * lib/offline/sync.ts
 *
 * Enhanced Offline Synchronization.
 *
 * Handles offline-first architecture for African SMEs with:
 *   - Unstable internet connections
 *   - Low-end devices
 *   - Power/network interruptions
 *
 * Implements:
 *   - Offline message/transaction queuing
 *   - Delayed synchronization with exponential backoff
 *   - Safe retries with idempotency-key deduplication
 *   - Optimistic local persistence via localStorage
 *
 * "Offline-first is a major African competitive advantage."
 *
 * Client-safe — uses localStorage only, no Firebase Admin.
 */

"use client";

// ─── Types ────────────────────────────────────────────────────────────────────

export type OfflineItemType = "transaction" | "message" | "correction" | "debt_update";
export type OfflineItemStatus = "pending" | "syncing" | "synced" | "failed";
export type SyncStatus = "online" | "offline" | "syncing" | "sync_failed";

export interface OfflineQueueItem {
  id: string;
  type: OfflineItemType;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  lastAttemptAt: string | null;
  nextRetryAt: string;
  status: OfflineItemStatus;
  /** Prevents duplicate processing — deterministic key from type + payload */
  idempotencyKey: string;
}

export interface SyncSummary {
  synced: number;
  failed: number;
  remaining: number;
}

export interface QueueStats {
  pending: number;
  failed: number;
  total: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STORAGE_KEY    = "zuria_offline_queue";
const MAX_QUEUE_SIZE = 100;
const MAX_RETRY_MS   = 30 * 60 * 1000; // 30 minutes

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Safe check for browser environment. */
function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

/** Returns true if the browser reports an active network connection. */
export function isOnline(): boolean {
  if (!isBrowser()) return false;
  return navigator.onLine;
}

/**
 * Creates a deterministic idempotency key from the item type and key payload fields.
 * Truncated to 24 chars for readability.
 */
export function generateIdempotencyKey(
  type: OfflineItemType,
  payload: Record<string, unknown>,
): string {
  const relevantFields: Record<string, unknown> = { type };
  const keyed = ["userId", "businessId", "amount", "transactionType", "messageId"] as const;
  for (const k of keyed) {
    if (payload[k] !== undefined) relevantFields[k] = payload[k];
  }
  // Truncate timestamp to the minute for grouping near-simultaneous duplicates
  if (typeof payload.timestamp === "string") {
    relevantFields.timestamp = (payload.timestamp as string).slice(0, 16);
  }
  try {
    return btoa(JSON.stringify(relevantFields)).slice(0, 24);
  } catch {
    return `${type}_${Date.now()}`.slice(0, 24);
  }
}

/**
 * Exponential backoff: delay = min(30s × 2^attempts, 30min).
 * Returns ISO timestamp for the next retry.
 */
export function computeNextRetry(attempts: number): string {
  const delayMs = Math.min(30_000 * Math.pow(2, attempts), MAX_RETRY_MS);
  return new Date(Date.now() + delayMs).toISOString();
}

// ─── Storage Helpers ──────────────────────────────────────────────────────────

function readQueue(): OfflineQueueItem[] {
  if (!isBrowser()) return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as OfflineQueueItem[];
  } catch {
    return [];
  }
}

function writeQueue(items: OfflineQueueItem[]): void {
  if (!isBrowser()) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch { /* storage quota exceeded — silently drop */ }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Add a new item to the offline queue.
 * Skips if the idempotency key already exists (deduplication).
 * Enforces a max queue size of 100 items.
 */
export function enqueueOfflineItem(
  item: Omit<OfflineQueueItem, "id" | "attempts" | "lastAttemptAt" | "nextRetryAt" | "status">,
): void {
  const queue = readQueue();

  // Deduplication check
  if (queue.some((q) => q.idempotencyKey === item.idempotencyKey)) return;

  // Enforce max queue size
  if (queue.length >= MAX_QUEUE_SIZE) {
    // Evict oldest synced/failed items first, then oldest pending
    const evictable = queue.findIndex((q) => q.status === "synced" || q.status === "failed");
    if (evictable >= 0) {
      queue.splice(evictable, 1);
    } else {
      return; // queue full and nothing to evict — drop new item
    }
  }

  const newItem: OfflineQueueItem = {
    ...item,
    id:             crypto.randomUUID(),
    attempts:       0,
    lastAttemptAt:  null,
    nextRetryAt:    new Date().toISOString(), // ready immediately
    status:         "pending",
  };

  queue.push(newItem);
  writeQueue(queue);
}

/** Read all items from the offline queue. Returns [] if not in browser or on error. */
export function getOfflineQueue(): OfflineQueueItem[] {
  return readQueue();
}

/** Update a single queue item by id. No-op if id not found. */
export function updateQueueItem(id: string, updates: Partial<OfflineQueueItem>): void {
  const queue = readQueue();
  const idx = queue.findIndex((q) => q.id === id);
  if (idx < 0) return;
  queue[idx] = { ...queue[idx], ...updates } as OfflineQueueItem;
  writeQueue(queue);
}

/** Remove a queue item by id. */
export function removeQueuedItem(id: string): void {
  const queue = readQueue().filter((q) => q.id !== id);
  writeQueue(queue);
}

/**
 * Returns queue stats by status.
 */
export function getQueueStats(): QueueStats {
  const queue = readQueue();
  return {
    pending: queue.filter((q) => q.status === "pending" || q.status === "syncing").length,
    failed:  queue.filter((q) => q.status === "failed").length,
    total:   queue.length,
  };
}

/**
 * Iterate pending items whose nextRetryAt <= now, calling syncFn for each.
 * Updates status based on result. Never throws.
 */
export async function syncOfflineQueue(
  syncFn: (item: OfflineQueueItem) => Promise<boolean>,
): Promise<SyncSummary> {
  const now = new Date().toISOString();
  const queue = readQueue();
  let synced = 0;
  let failed = 0;

  for (const item of queue) {
    if (item.status !== "pending") continue;
    if (item.nextRetryAt > now)    continue;

    // Mark as syncing
    updateQueueItem(item.id, { status: "syncing", lastAttemptAt: now });

    try {
      const success = await syncFn(item);

      if (success) {
        updateQueueItem(item.id, { status: "synced" });
        synced++;
      } else {
        const newAttempts = item.attempts + 1;
        if (newAttempts >= item.maxAttempts) {
          updateQueueItem(item.id, { status: "failed", attempts: newAttempts });
          failed++;
        } else {
          updateQueueItem(item.id, {
            status:       "pending",
            attempts:     newAttempts,
            nextRetryAt:  computeNextRetry(newAttempts),
          });
        }
      }
    } catch {
      const newAttempts = item.attempts + 1;
      if (newAttempts >= item.maxAttempts) {
        updateQueueItem(item.id, { status: "failed", attempts: newAttempts });
        failed++;
      } else {
        updateQueueItem(item.id, {
          status:      "pending",
          attempts:    newAttempts,
          nextRetryAt: computeNextRetry(newAttempts),
        });
      }
    }
  }

  const remaining = readQueue().filter((q) => q.status === "pending").length;
  return { synced, failed, remaining };
}
