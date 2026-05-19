/**
 * ZURIA Event System — Lightweight Event Bus
 *
 * Fire-and-forget, non-blocking event bus.  Every emitted event is:
 *   1. Dispatched to all registered in-process handlers (async, uncoupled).
 *   2. Written to the Firestore "event_log" collection for audit / observability.
 *
 * Neither step ever throws or blocks the caller.
 *
 * Server-only.
 */

import { getAdminDb } from "@/lib/firebase/admin";
import type {
  AIRequestedPayload,
  ParserFailedPayload,
  SecurityEventPayload,
  ShadowLearnPayload,
  TransactionCreatedPayload,
  ZuriaEvent,
  ZuriaEventType,
} from "./types";

// ─── New collections (not in collections.ts) ──────────────────────────────────
// "event_log" — append-only audit log of all ZuriaEvents

// ─── Handler type ─────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EventHandler<T = any> = (event: ZuriaEvent<T>) => void | Promise<void>;

// ─── Internal event doc shape (plain objects only — safe for Firestore) ────────

// Firestore's set() accepts DocumentData which is Record<string, unknown>.
// We cast the event through this alias when writing.
type FirestoreDoc = Record<string, unknown>;

// ─── Event emitter class ──────────────────────────────────────────────────────

class ZuriaEventEmitter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly handlers = new Map<ZuriaEventType, Array<EventHandler<any>>>();

  /** Register a handler for a specific event type. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on<T = any>(type: ZuriaEventType, handler: EventHandler<T>): void {
    const bucket = this.handlers.get(type) ?? [];
    bucket.push(handler);
    this.handlers.set(type, bucket);
  }

  /** Remove a previously registered handler. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  off(type: ZuriaEventType, handler: EventHandler<any>): void {
    const bucket = this.handlers.get(type);
    if (!bucket) return;
    const idx = bucket.indexOf(handler);
    if (idx !== -1) bucket.splice(idx, 1);
  }

  /**
   * Emit an event — fire-and-forget.
   *
   * Assigns a UUID and ISO timestamp, dispatches all handlers asynchronously,
   * and writes to Firestore.  Never throws.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  emit<T = any>(partial: Omit<ZuriaEvent<T>, "id" | "timestamp">): void {
    const event: ZuriaEvent<T> = {
      ...partial,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
    };

    // ── Dispatch in-process handlers ─────────────────────────────────────────
    const bucket = this.handlers.get(event.type);
    if (bucket) {
      for (const handler of bucket) {
        Promise.resolve()
          .then(() => (handler as EventHandler<T>)(event))
          .catch(() => {
            // Handler errors must never surface to the caller
          });
      }
    }

    // ── Persist to Firestore ──────────────────────────────────────────────────
    try {
      const db = getAdminDb();
      // Cast to plain object for Firestore's DocumentData requirement
      const doc = event as unknown as FirestoreDoc;
      db.collection("event_log") // new collection — not in collections.ts
        .doc(event.id)
        .set(doc)
        .catch(() => {
          // Firestore write failure must never surface to the caller
        });
    } catch {
      // getAdminDb() itself may throw during cold start — swallow safely
    }
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const eventBus = new ZuriaEventEmitter();

// ─── Convenience wrappers ─────────────────────────────────────────────────────

export function emitTransactionCreated(
  userId: string,
  payload: TransactionCreatedPayload,
): void {
  eventBus.emit<TransactionCreatedPayload>({
    type: "transaction.created",
    userId,
    payload,
  });
}

export function emitParserFailed(
  userId: string,
  payload: ParserFailedPayload,
): void {
  eventBus.emit<ParserFailedPayload>({
    type: "parser.failed",
    userId,
    payload,
  });
}

export function emitAIRequested(
  userId: string,
  payload: AIRequestedPayload,
): void {
  eventBus.emit<AIRequestedPayload>({
    type: "ai.requested",
    userId,
    payload,
  });
}

export function emitShadowLearnDivergence(
  userId: string,
  payload: ShadowLearnPayload,
): void {
  eventBus.emit<ShadowLearnPayload>({
    type: "shadow_learn.divergence",
    userId,
    payload,
  });
}

export function emitSecurityEvent(
  userId: string,
  type: "security.suspicious_input" | "security.moderation_blocked",
  reason: string,
): void {
  eventBus.emit<SecurityEventPayload>({
    type,
    userId,
    payload: { reason },
  });
}
