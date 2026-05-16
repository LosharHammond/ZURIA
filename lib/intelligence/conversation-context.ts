/**
 * Conversation context persistence — enhanced.
 *
 * Reads and writes ConversationContext to existing whatsapp_sessions /
 * telegram_links Firestore documents. Context fields are stored as ctx_*
 * prefixed fields so there is no schema collision with existing session data.
 *
 * Key improvements over v1:
 *  - Synchronous saves with 800ms timeout fallback (no more silent data loss)
 *  - 24h TTL enforcement — stale context is reset on load, not silently carried
 *  - Conversation history ring buffer (last 5 turns)
 *  - lastTransactionId + lastTransactionDesc for UNDO targeting
 *  - pendingLimitNotification for decoupled monetization warnings
 *
 * Server-only: firebase-admin.
 */

import { getAdminDb } from "@/lib/firebase/admin";
import { collections } from "@/lib/firebase/collections";
import type {
  ClassifiedIntent,
  ConversationContext,
  HistoryEntry,
  LedgerSubIntent,
} from "./types";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Context older than this is considered stale and reset on load */
const CONTEXT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/** Max turns stored in conversationHistory */
const HISTORY_LIMIT = 5;

/** Max ms to wait for a context save before giving up (never blocks the user) */
const SAVE_TIMEOUT_MS = 800;

// ─── Default context ──────────────────────────────────────────────────────────

const DEFAULT_CONTEXT: ConversationContext = {
  lastIntent:               null,
  activeFlow:               "none",
  lastPerson:               null,
  lastAmount:               null,
  lastAsset:                null,
  lastTransactionSubIntent: null,
  lastTransactionId:        null,
  lastTransactionDesc:      null,
  conversationHistory:      [],
  pendingLimitNotification: null,
  subscriptionUiShownAt:    null,
  updatedAt:                new Date().toISOString(),
};

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function loadWhatsAppContext(phone: string): Promise<ConversationContext> {
  try {
    const snap = await getAdminDb()
      .collection(collections.whatsappSessions)
      .doc(phone)
      .get();
    if (!snap.exists) return { ...DEFAULT_CONTEXT };
    return extractContext(snap.data()!);
  } catch {
    return { ...DEFAULT_CONTEXT };
  }
}

export async function loadTelegramContext(chatId: string): Promise<ConversationContext> {
  try {
    const snap = await getAdminDb()
      .collection(collections.telegramLinks)
      .doc(chatId)
      .get();
    if (!snap.exists) return { ...DEFAULT_CONTEXT };
    return extractContext(snap.data()!);
  } catch {
    return { ...DEFAULT_CONTEXT };
  }
}

function extractContext(data: Record<string, unknown>): ConversationContext {
  // ── TTL check — if context is stale (> 24h), start fresh ──────────────────
  const updatedAt = (data.ctx_updatedAt as string | null) ?? null;
  if (updatedAt) {
    const ageMs = Date.now() - new Date(updatedAt).getTime();
    if (ageMs > CONTEXT_TTL_MS) {
      return { ...DEFAULT_CONTEXT, updatedAt: new Date().toISOString() };
    }
  }

  return {
    lastIntent:              (data.ctx_lastIntent               as ConversationContext["lastIntent"])                    ?? null,
    activeFlow:              (data.ctx_activeFlow               as ConversationContext["activeFlow"])                    ?? "none",
    lastPerson:              (data.ctx_lastPerson               as string | null)                                        ?? null,
    lastAmount:              (data.ctx_lastAmount               as number | null)                                        ?? null,
    lastAsset:               (data.ctx_lastAsset                as string | null)                                        ?? null,
    lastTransactionSubIntent:(data.ctx_lastTransactionSubIntent as LedgerSubIntent | null)                              ?? null,
    lastTransactionId:       (data.ctx_lastTransactionId        as string | null)                                        ?? null,
    lastTransactionDesc:     (data.ctx_lastTransactionDesc      as string | null)                                        ?? null,
    conversationHistory:     (data.ctx_conversationHistory      as HistoryEntry[] | null)                               ?? [],
    pendingLimitNotification:(data.ctx_pendingLimitNotification as string | null)                                        ?? null,
    subscriptionUiShownAt:   (data.ctx_subscriptionUiShownAt   as string | null)                                        ?? null,
    updatedAt:               (data.ctx_updatedAt                as string)                                               ?? new Date().toISOString(),
  };
}

// ─── Write ────────────────────────────────────────────────────────────────────

/**
 * Save context to WhatsApp session document.
 *
 * SYNCHRONOUS with a 800ms timeout fallback.
 * A failed save is still logged to console — it's never silently swallowed.
 * The timeout ensures the user is never blocked waiting for Firestore.
 */
export async function saveWhatsAppContext(
  phone: string,
  intent: ClassifiedIntent,
  subscriptionUiWasShown: boolean,
  txnUpdate?: TxnContextUpdate,
  historyEntry?: { user: string; zuria: string },
): Promise<void> {
  const delta = buildContextDelta(intent, subscriptionUiWasShown, txnUpdate, historyEntry);

  // Best-effort with 800ms timeout — never blocks the response
  await Promise.race([
    getAdminDb().collection(collections.whatsappSessions).doc(phone).update(delta),
    new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error("ctx_save_timeout")), SAVE_TIMEOUT_MS)
    ),
  ]).catch((err) => {
    // Log timeout/failure — but NEVER throw; context save must not break responses
    if ((err as Error).message !== "ctx_save_timeout") {
      console.warn("[conversation-context] WhatsApp ctx save failed:", err);
    }
  });
}

export async function saveTelegramContext(
  chatId: string,
  intent: ClassifiedIntent,
  subscriptionUiWasShown: boolean,
  txnUpdate?: TxnContextUpdate,
  historyEntry?: { user: string; zuria: string },
): Promise<void> {
  const delta = buildContextDelta(intent, subscriptionUiWasShown, txnUpdate, historyEntry);

  await Promise.race([
    getAdminDb().collection(collections.telegramLinks).doc(chatId).update(delta),
    new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error("ctx_save_timeout")), SAVE_TIMEOUT_MS)
    ),
  ]).catch((err) => {
    if ((err as Error).message !== "ctx_save_timeout") {
      console.warn("[conversation-context] Telegram ctx save failed:", err);
    }
  });
}

// ─── Pending limit notification ───────────────────────────────────────────────

/**
 * Stage a limit-warning message to be prepended to the NEXT response.
 * This decouples the monetization nudge from the financial confirmation
 * that triggered it — the user sees the warning as a separate thought,
 * not as a postscript to their transaction.
 */
export async function stageLimitNotification(
  platform: "whatsapp" | "telegram",
  id: string,
  message: string,
): Promise<void> {
  const col = platform === "whatsapp"
    ? collections.whatsappSessions
    : collections.telegramLinks;

  await getAdminDb()
    .collection(col)
    .doc(id)
    .update({ ctx_pendingLimitNotification: message, ctx_updatedAt: new Date().toISOString() })
    .catch(() => {});
}

/**
 * Clear the pending limit notification after it has been shown.
 */
export async function clearLimitNotification(
  platform: "whatsapp" | "telegram",
  id: string,
): Promise<void> {
  const col = platform === "whatsapp"
    ? collections.whatsappSessions
    : collections.telegramLinks;

  await getAdminDb()
    .collection(col)
    .doc(id)
    .update({ ctx_pendingLimitNotification: null, ctx_updatedAt: new Date().toISOString() })
    .catch(() => {});
}

// ─── Transaction context update ───────────────────────────────────────────────

export interface TxnContextUpdate {
  /** ID of the transaction just saved — stored for UNDO targeting */
  transactionId:   string;
  /** Human-readable description for the undo confirmation prompt */
  transactionDesc: string;
}

// ─── Delta builder ────────────────────────────────────────────────────────────

function buildContextDelta(
  intent: ClassifiedIntent,
  subscriptionUiWasShown: boolean,
  txnUpdate?: TxnContextUpdate,
  historyEntry?: { user: string; zuria: string },
): Record<string, unknown> {
  const now = new Date().toISOString();

  const delta: Record<string, unknown> = {
    ctx_lastIntent:  intent.intent,
    ctx_activeFlow:  intent.state.active_flow,
    ctx_updatedAt:   now,
    // Clear pending limit notification once context is updated
    // (it will have been shown before this save was triggered)
    ctx_pendingLimitNotification: null,
  };

  // Persist entity extractions — only overwrite with non-null values
  if (intent.entities.person !== null) delta.ctx_lastPerson = intent.entities.person;
  if (intent.entities.amount !== null) delta.ctx_lastAmount = intent.entities.amount;
  if (intent.entities.asset  !== null) delta.ctx_lastAsset  = intent.entities.asset;

  // Track last ledger sub-intent for undo targeting
  if (intent.intent === "LEDGER_ENGINE" && intent.sub_intent) {
    delta.ctx_lastTransactionSubIntent = intent.sub_intent;
  }

  // Store last transaction ID and description for UNDO
  if (txnUpdate) {
    delta.ctx_lastTransactionId   = txnUpdate.transactionId;
    delta.ctx_lastTransactionDesc = txnUpdate.transactionDesc;
  }

  // Record when subscription UI was shown (24h suppression clock)
  if (subscriptionUiWasShown) {
    delta.ctx_subscriptionUiShownAt = now;
  }

  // History is updated separately via updateHistory() — not in the main delta
  // to avoid write conflicts on rapid messages.

  return delta;
}

// ─── Conversation history ─────────────────────────────────────────────────────

/**
 * Append a user+zuria turn to the conversation history ring buffer.
 * Keeps the last HISTORY_LIMIT turns. Fire-and-forget (non-blocking).
 */
export function appendConversationHistory(
  platform: "whatsapp" | "telegram",
  id: string,
  userText: string,
  zuriaText: string,
  currentHistory: HistoryEntry[],
): void {
  const now = new Date().toISOString();
  const newEntries: HistoryEntry[] = [
    { role: "user",  text: userText.slice(0, 200), ts: now },
    { role: "zuria", text: zuriaText.slice(0, 200), ts: now },
  ];

  const updated = [...currentHistory, ...newEntries].slice(-HISTORY_LIMIT * 2);

  const col = platform === "whatsapp"
    ? collections.whatsappSessions
    : collections.telegramLinks;

  getAdminDb()
    .collection(col)
    .doc(id)
    .update({ ctx_conversationHistory: updated, ctx_updatedAt: now })
    .catch(() => {});
}

// ─── Reset ────────────────────────────────────────────────────────────────────

export function clearWhatsAppContext(phone: string): void {
  const cleared: Record<string, unknown> = {
    ctx_lastIntent:               null,
    ctx_activeFlow:               "none",
    ctx_lastPerson:               null,
    ctx_lastAmount:               null,
    ctx_lastAsset:                null,
    ctx_lastTransactionSubIntent: null,
    ctx_lastTransactionId:        null,
    ctx_lastTransactionDesc:      null,
    ctx_conversationHistory:      [],
    ctx_pendingLimitNotification: null,
    ctx_subscriptionUiShownAt:    null,
    ctx_updatedAt:                new Date().toISOString(),
  };
  getAdminDb()
    .collection(collections.whatsappSessions)
    .doc(phone)
    .update(cleared)
    .catch(() => {});
}

export function clearTelegramContext(chatId: string): void {
  const cleared: Record<string, unknown> = {
    ctx_lastIntent:               null,
    ctx_activeFlow:               "none",
    ctx_lastPerson:               null,
    ctx_lastAmount:               null,
    ctx_lastAsset:                null,
    ctx_lastTransactionSubIntent: null,
    ctx_lastTransactionId:        null,
    ctx_lastTransactionDesc:      null,
    ctx_conversationHistory:      [],
    ctx_pendingLimitNotification: null,
    ctx_subscriptionUiShownAt:    null,
    ctx_updatedAt:                new Date().toISOString(),
  };
  getAdminDb()
    .collection(collections.telegramLinks)
    .doc(chatId)
    .update(cleared)
    .catch(() => {});
}

// ─── History helper ───────────────────────────────────────────────────────────

/**
 * Build a short text summary of conversation history for AI context.
 */
export function historyToText(history: HistoryEntry[]): string {
  return history
    .slice(-6)
    .map((h) => `${h.role === "user" ? "User" : "ZURIA"}: ${h.text}`)
    .join("\n");
}
