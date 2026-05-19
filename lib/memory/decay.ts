/**
 * lib/memory/decay.ts
 *
 * AI Memory Decay System.
 *
 * Not all memory should persist forever. This module implements:
 *   - Short-term memory (24h TTL): recent context, last few messages
 *   - Operational memory (30-day TTL): business profile, patterns
 *   - Long-term memory (1-year TTL): archetypes, major milestones
 *   - Archival memory (permanent): never expires, audit trail
 *
 * Memory confidence decays over time. Old data is deprioritized.
 * Memory is reinforced when a pattern repeats.
 *
 * Server-only.
 */

import { getAdminDb } from "@/lib/firebase/admin";

// ─── Types ────────────────────────────────────────────────────────────────────

export type MemoryTier = "short_term" | "operational" | "long_term" | "archival";

export interface MemoryEntry {
  id: string;
  businessId: string;
  tier: MemoryTier;
  key: string;             // e.g. "last_supplier", "preferred_payment_method"
  value: unknown;
  confidence: number;      // 0–1, decays over time
  reinforcementCount: number; // how many times this was confirmed
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string | null; // null for archival
}

export interface MemoryDecayConfig {
  short_term: { ttlMs: number; decayRate: number };    // ttl=24h, fast decay
  operational: { ttlMs: number; decayRate: number };   // ttl=30d, medium decay
  long_term: { ttlMs: number; decayRate: number };     // ttl=365d, slow decay
  archival: { ttlMs: number | null; decayRate: number }; // never expires
}

// ─── Config ───────────────────────────────────────────────────────────────────

export const MEMORY_DECAY_CONFIG: MemoryDecayConfig = {
  short_term:  { ttlMs: 24 * 60 * 60 * 1000,         decayRate: 0.10 }, // 10%/hour
  operational: { ttlMs: 30 * 24 * 60 * 60 * 1000,    decayRate: 0.02 }, // 2%/day
  long_term:   { ttlMs: 365 * 24 * 60 * 60 * 1000,   decayRate: 0.005 },// 0.5%/day
  archival:    { ttlMs: null,                          decayRate: 0 },
};

// ─── computeCurrentConfidence ─────────────────────────────────────────────────

/**
 * Applies exponential decay: confidence * e^(-decayRate * elapsedTime).
 * elapsedTime in hours for short_term, days for all others.
 * Floors at 0, cap at 1.
 */
export function computeCurrentConfidence(entry: MemoryEntry): number {
  const config = MEMORY_DECAY_CONFIG[entry.tier];
  if (config.decayRate === 0) return Math.min(1, Math.max(0, entry.confidence));

  const nowMs = Date.now();
  const lastSeenMs = new Date(entry.lastSeenAt).getTime();
  const elapsedMs = Math.max(0, nowMs - lastSeenMs);

  let elapsedUnits: number;
  if (entry.tier === "short_term") {
    // hours
    elapsedUnits = elapsedMs / (60 * 60 * 1000);
  } else {
    // days
    elapsedUnits = elapsedMs / (24 * 60 * 60 * 1000);
  }

  const decayed = entry.confidence * Math.exp(-config.decayRate * elapsedUnits);
  return Math.min(1, Math.max(0, decayed));
}

// ─── isMemoryExpired ──────────────────────────────────────────────────────────

/** Returns true if the entry's expiresAt is in the past. */
export function isMemoryExpired(entry: MemoryEntry): boolean {
  if (entry.expiresAt === null) return false;
  return new Date(entry.expiresAt).getTime() < Date.now();
}

// ─── reinforceMemory ──────────────────────────────────────────────────────────

/**
 * Returns a new entry with reinforcementCount+1 and confidence boosted by
 * min(0.05 * reinforcementCount, 0.20), lastSeenAt updated.
 */
export function reinforceMemory(entry: MemoryEntry): MemoryEntry {
  const newCount = entry.reinforcementCount + 1;
  const boost = Math.min(0.05 * newCount, 0.20);
  const newConfidence = Math.min(1, entry.confidence + boost);
  return {
    ...entry,
    reinforcementCount: newCount,
    confidence: newConfidence,
    lastSeenAt: new Date().toISOString(),
  };
}

// ─── createMemoryEntry ────────────────────────────────────────────────────────

/**
 * Pure factory. Sets expiresAt based on tier TTL (null for archival).
 * id via crypto.randomUUID().
 */
export function createMemoryEntry(
  businessId: string,
  tier: MemoryTier,
  key: string,
  value: unknown,
  initialConfidence = 0.7,
): MemoryEntry {
  const now = new Date();
  const config = MEMORY_DECAY_CONFIG[tier];

  const expiresAt: string | null =
    config.ttlMs === null
      ? null
      : new Date(now.getTime() + config.ttlMs).toISOString();

  return {
    id: crypto.randomUUID(),
    businessId,
    tier,
    key,
    value,
    confidence: Math.min(1, Math.max(0, initialConfidence)),
    reinforcementCount: 0,
    createdAt: now.toISOString(),
    lastSeenAt: now.toISOString(),
    expiresAt,
  };
}

// ─── saveMemoryEntry ──────────────────────────────────────────────────────────

/** Fire-and-forget write to Firestore "memory_store" collection. Never throws. */
export async function saveMemoryEntry(entry: MemoryEntry): Promise<void> {
  try {
    const db = getAdminDb();
    await db.collection("memory_store").doc(entry.id).set(entry, { merge: true });
  } catch {
    // silent
  }
}

// ─── getActiveMemory ──────────────────────────────────────────────────────────

/**
 * Fetches from Firestore, filters out expired entries, applies computeCurrentConfidence.
 * Returns [] on error.
 */
export async function getActiveMemory(
  businessId: string,
  tier?: MemoryTier,
): Promise<MemoryEntry[]> {
  try {
    const db = getAdminDb();
    let query = db
      .collection("memory_store")
      .where("businessId", "==", businessId);

    if (tier !== undefined) {
      query = query.where("tier", "==", tier);
    }

    const snap = await query.get();
    const raw = snap.docs.map((d) => d.data() as MemoryEntry);

    return raw
      .filter((e) => !isMemoryExpired(e))
      .map((e) => ({ ...e, confidence: computeCurrentConfidence(e) }));
  } catch {
    return [];
  }
}

// ─── pruneExpiredMemory ───────────────────────────────────────────────────────

/**
 * Deletes expired entries from Firestore for a given businessId.
 * Returns count deleted. Wrapped in try/catch.
 */
export async function pruneExpiredMemory(businessId: string): Promise<number> {
  try {
    const db = getAdminDb();
    const now = new Date().toISOString();

    // Query entries that have an expiresAt in the past.
    // Firestore requires a composite index for this query in production,
    // but the logic is correct per spec.
    const snap = await db
      .collection("memory_store")
      .where("businessId", "==", businessId)
      .where("expiresAt", "<", now)
      .get();

    if (snap.empty) return 0;

    const batch = db.batch();
    for (const doc of snap.docs) {
      batch.delete(doc.ref);
    }
    await batch.commit();
    return snap.size;
  } catch {
    return 0;
  }
}
