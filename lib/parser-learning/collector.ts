/**
 * Parser Learning — Training Data Collector
 *
 * Stores examples when AI improves on parser output and records parser failures.
 * All Firestore writes are fire-and-forget (never block the request path).
 *
 * Server-only.
 */

import { getAdminDb } from "@/lib/firebase/admin";

// ─── New collections (not in collections.ts) ──────────────────────────────────
// "parser_training_examples" — labelled input/output pairs for parser improvement
// "parser_failures"          — cases where the parser was unable to produce a result

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TrainingExample {
  id: string;
  rawInput: string;
  normalizedInput: string;
  parserResult: {
    type: string;
    amount: number;
    confidence: number;
    productName: string | null;
    customerName: string | null;
  };
  aiResult: {
    type: string | null;
    amount: number | null;
    confidence: number;
    response: string;
  } | null;
  acceptedResult: {
    type: string;
    amount: number;
  };
  language: "english" | "pidgin" | "twi" | "mixed" | "unknown";
  businessCategory: string;
  userId: string;
  diverged: boolean;       // true if parser and AI disagreed
  correction?: {           // if user corrected
    correctedType: string;
    correctedAmount: number;
    correctedAt: string;
  };
  timestamp: string;
}

export interface ParserFailure {
  id: string;
  rawInput: string;
  normalizedInput: string;
  failureReason:
    | "low_confidence"
    | "no_amount"
    | "wrong_type"
    | "ambiguous"
    | "unknown";
  parserConfidence: number;
  userId: string;
  timestamp: string;
}

// ─── Pidgin / Twi signal sets ─────────────────────────────────────────────────

const PIDGIN_SIGNALS: string[] = [
  "i dey",
  "e dey",
  "we dey",
  " na ",
  " abi",
  "wahala",
  "chop",
  "dash me",
  "e don",
  " dem",
];

const TWI_SIGNALS: string[] = [
  "mepε",
  "bɔɔ",
  "sika",
  "hwε",
  "ɛɛ",
  "pa ara",
  " yɛ ",
  " enti",
];

// ─── Public helpers ───────────────────────────────────────────────────────────

/**
 * Detects the primary language of `text`.
 * Returns "mixed" when both Twi and Pidgin signals are present.
 */
export function detectLanguage(text: string): TrainingExample["language"] {
  const lower = text.toLowerCase();

  const hasTwi = TWI_SIGNALS.some((s) => lower.includes(s));
  const hasPidgin = PIDGIN_SIGNALS.some((s) => lower.includes(s));

  if (hasTwi && hasPidgin) return "mixed";
  if (hasTwi) return "twi";
  if (hasPidgin) return "pidgin";
  return "english";
}

/**
 * Returns `true` when this interaction is worth storing as a training example.
 *
 * Rules:
 *  - Always collect when confidence < 0.60 (even without AI involvement).
 *  - Collect when confidence < 0.85 AND AI was involved (aiResponse is not null).
 *  - Skip otherwise (high-confidence, parser-only path).
 */
export function shouldCollectExample(
  parserConfidence: number,
  aiResponse: string | null,
): boolean {
  if (parserConfidence < 0.6) return true;
  if (parserConfidence < 0.85 && aiResponse !== null) return true;
  return false;
}

/**
 * Persists a labelled training example.
 * Fire-and-forget — errors are swallowed so callers are never blocked.
 */
export async function collectTrainingExample(
  example: Omit<TrainingExample, "id" | "timestamp">,
): Promise<void> {
  try {
    const db = getAdminDb();
    const id = crypto.randomUUID();
    const timestamp = new Date().toISOString();

    await db
      .collection("parser_training_examples") // new collection — not in collections.ts
      .doc(id)
      .set({ ...example, id, timestamp });
  } catch {
    // Intentionally swallowed — training data collection must never fail requests
  }
}

/**
 * Records a parser failure for later analysis.
 * Fire-and-forget — errors are swallowed.
 */
export async function recordParserFailure(
  failure: Omit<ParserFailure, "id" | "timestamp">,
): Promise<void> {
  try {
    const db = getAdminDb();
    const id = crypto.randomUUID();
    const timestamp = new Date().toISOString();

    await db
      .collection("parser_failures") // new collection — not in collections.ts
      .doc(id)
      .set({ ...failure, id, timestamp });
  } catch {
    // Intentionally swallowed
  }
}
