/**
 * ZURIA Feature Flags
 *
 * Controls AI features, enables staged rollout, and provides an emergency
 * disable mechanism without a code deploy.
 *
 * Reads from Firestore with a 5-minute in-process cache to avoid hammering
 * the database on every request.  Falls back to safe defaults on any error.
 *
 * Server-only.
 */

import { getAdminDb } from "@/lib/firebase/admin";

// ─── New collections (not in collections.ts) ──────────────────────────────────
// "feature_flags" — per-flag config documents, doc id = flag name

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FeatureFlag {
  name: string;
  enabled: boolean;
  rolloutPercent: number;   // 0–100 for gradual rollout
  allowedPlans?: string[];  // subscription tier gating
  description: string;
  updatedAt: string;
}

// ─── Built-in flag name constants ─────────────────────────────────────────────

export const FLAGS = {
  AI_ENABLED:         "ai_enabled",
  AI_SHADOW_LEARNING: "ai_shadow_learning",
  AI_ADVANCED_MODEL:  "ai_advanced_model",
  AI_PROMPT_GUARD:    "ai_prompt_guard",
  MEMORY_ENGINE:      "memory_engine",
  PARSER_LEARNING:    "parser_learning",
  EXECUTIVE_REPORTS:  "executive_reports",
  COACHING_MODE:      "coaching_mode",
  MULTI_INTENT:       "multi_intent",
  DEBT_INTELLIGENCE:  "debt_intelligence",
} as const;

// ─── Default values (used when Firestore is unreachable) ──────────────────────

const DEFAULT_FLAGS: Record<string, boolean> = {
  ai_enabled:          true,
  ai_shadow_learning:  true,
  ai_advanced_model:   true,
  ai_prompt_guard:     true,
  memory_engine:       true,
  parser_learning:     true,
  executive_reports:   true,
  coaching_mode:       true,
  multi_intent:        true,
  debt_intelligence:   true,
};

// ─── Module-level cache ───────────────────────────────────────────────────────

const TTL_MS = 5 * 60 * 1000; // 5 minutes

/** Raw boolean cache for fast synchronous lookups. */
const flagCache = new Map<string, { value: boolean; expiresAt: number }>();

/** Full FeatureFlag document cache for rollout/plan checks. */
const flagDocCache = new Map<string, { doc: FeatureFlag; expiresAt: number }>();

// ─── Internal helpers ─────────────────────────────────────────────────────────

function cachedValue(flagName: string): boolean | undefined {
  const entry = flagCache.get(flagName);
  if (entry && entry.expiresAt > Date.now()) return entry.value;
  return undefined;
}

function setCachedValue(flagName: string, value: boolean): void {
  flagCache.set(flagName, { value, expiresAt: Date.now() + TTL_MS });
}

function setCachedDoc(flagName: string, doc: FeatureFlag): void {
  flagDocCache.set(flagName, { doc, expiresAt: Date.now() + TTL_MS });
  setCachedValue(flagName, doc.enabled);
}

function cachedDoc(flagName: string): FeatureFlag | undefined {
  const entry = flagDocCache.get(flagName);
  if (entry && entry.expiresAt > Date.now()) return entry.doc;
  return undefined;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Async flag read with 5-minute cache.
 * Returns `flag.enabled` from Firestore, falling back to DEFAULT_FLAGS on miss
 * or error.
 */
export async function getFlag(flagName: string): Promise<boolean> {
  // Return from cache if still fresh
  const cached = cachedValue(flagName);
  if (cached !== undefined) return cached;

  try {
    const db = getAdminDb();
    const snap = await db
      .collection("feature_flags") // new collection — not in collections.ts
      .doc(flagName)
      .get();

    if (snap.exists) {
      const doc = snap.data() as FeatureFlag;
      setCachedDoc(flagName, doc);
      return doc.enabled;
    }

    // Not in Firestore — use default and cache it
    const fallback = DEFAULT_FLAGS[flagName] ?? true;
    setCachedValue(flagName, fallback);
    return fallback;
  } catch {
    const fallback = DEFAULT_FLAGS[flagName] ?? true;
    setCachedValue(flagName, fallback);
    return fallback;
  }
}

/**
 * Synchronous flag check — safe to call in hot paths.
 * Uses cache only (no async I/O).  Returns the default if the cache is cold.
 */
export function getFlagSync(flagName: string): boolean {
  const cached = cachedValue(flagName);
  if (cached !== undefined) return cached;
  return DEFAULT_FLAGS[flagName] ?? true;
}

/**
 * Updates a flag in Firestore and refreshes the local cache.
 * Intended for admin use only.
 */
export async function setFlag(
  flagName: string,
  enabled: boolean,
  description = "",
): Promise<void> {
  const db = getAdminDb();
  const updatedAt = new Date().toISOString();

  const existing = cachedDoc(flagName);
  // Build the doc: start from safe defaults, layer in any existing values,
  // then apply the explicit overrides so they always win.
  const doc: FeatureFlag = {
    name: flagName,
    rolloutPercent: 100,
    description: "",
    ...(existing ?? {}),
    enabled,
    updatedAt,
    // Only carry description override when caller supplied a non-empty string
    ...(description ? { description } : {}),
  };

  await db
    .collection("feature_flags") // new collection — not in collections.ts
    .doc(flagName)
    .set(doc, { merge: true });

  setCachedDoc(flagName, doc);
}

/**
 * Synchronous flag evaluation with rollout-percent and plan gating.
 *
 * - Uses getFlagSync (cache / default, no I/O).
 * - If rolloutPercent < 100, deterministically assigns the user to a bucket
 *   via `userId.charCodeAt(0) % 100`.
 * - If allowedPlans is set, requires userPlan to appear in the list.
 */
export function isFlagEnabled(
  flagName: string,
  userId?: string,
  userPlan?: string,
): boolean {
  // Base enabled check
  if (!getFlagSync(flagName)) return false;

  const doc = cachedDoc(flagName);

  // Rollout percent gating
  if (doc && doc.rolloutPercent < 100) {
    if (!userId) return false; // Can't bucket without a userId
    const bucket = userId.charCodeAt(0) % 100;
    if (bucket >= doc.rolloutPercent) return false;
  }

  // Plan gating
  if (doc?.allowedPlans && doc.allowedPlans.length > 0) {
    if (!userPlan) return false;
    if (!doc.allowedPlans.includes(userPlan)) return false;
  }

  return true;
}
