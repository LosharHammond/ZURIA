/**
 * Parser Learning — User Correction Handler
 *
 * User corrections are the highest-quality training signal: a human explicitly
 * told us the parser was wrong. Every correction is persisted and fed back into
 * the training pipeline.
 *
 * Server-only.
 */

import { getAdminDb } from "@/lib/firebase/admin";
import { collectTrainingExample } from "./collector";

// ─── New collections (not in collections.ts) ──────────────────────────────────
// "parser_corrections" — raw user corrections before they are merged into training data

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UserCorrection {
  id: string;
  userId: string;
  originalTransactionId: string;
  originalType: string;
  originalAmount: number;
  correctedType: string | null;
  correctedAmount: number | null;
  correctedProduct: string | null;
  correctedCustomer: string | null;
  rawCorrectionText: string; // what the user typed to correct
  timestamp: string;
}

// ─── Amount / type extraction patterns ───────────────────────────────────────

const AMOUNT_PATTERN = /\b(\d[\d,.]*)\b/;

const TYPE_KEYWORD_MAP: Array<[RegExp, string]> = [
  [/\bexpense\b/i, "expense"],
  [/\bsale\b|\bsold\b/i, "sale"],
  [/\bdebt\b|\bowes?\b/i, "debt_record"],
  [/\binventory\b|\bstock\b/i, "stock_purchase"],
  [/\bsalary\b|\bwage\b/i, "salary"],
  [/\bincome\b/i, "sale"],
];

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Parses a raw correction phrase like "no it was 500" or "that was expense".
 *
 * Returns:
 *  - `amount`  — first numeric value found (null if none)
 *  - `type`    — mapped transaction type (null if none detected)
 *  - `product` — always null (cannot reliably extract from free text here)
 */
export function parseCorrection(text: string): {
  amount: number | null;
  type: string | null;
  product: string | null;
} {
  // Extract amount: take the first number, strip commas
  const amountMatch = AMOUNT_PATTERN.exec(text);
  const amount =
    amountMatch !== null
      ? parseFloat(amountMatch[1].replace(/,/g, ""))
      : null;

  // Extract type
  let type: string | null = null;
  for (const [pattern, mapped] of TYPE_KEYWORD_MAP) {
    if (pattern.test(text)) {
      type = mapped;
      break;
    }
  }

  return { amount, type, product: null };
}

// ─── Firestore operations ─────────────────────────────────────────────────────

/**
 * Persists a raw user correction document.
 * Fire-and-forget — errors are swallowed.
 */
export async function saveUserCorrection(
  correction: Omit<UserCorrection, "id" | "timestamp">,
): Promise<void> {
  try {
    const db = getAdminDb();
    const id = crypto.randomUUID();
    const timestamp = new Date().toISOString();

    await db
      .collection("parser_corrections") // new collection — not in collections.ts
      .doc(id)
      .set({ ...correction, id, timestamp });
  } catch {
    // Intentionally swallowed
  }
}

/**
 * Applies a user correction by feeding it back into the training pipeline.
 *
 * Wraps the correction as a TrainingExample with `diverged = true` so the
 * pattern analyser knows the parser was wrong on this input.
 * Fire-and-forget.
 */
export async function applyCorrection(correction: UserCorrection): Promise<void> {
  // Build a minimal training example from the correction.
  // We don't have the full original parser/AI context here, so we synthesise
  // reasonable stand-ins that preserve the most important signal: the accepted
  // (corrected) type and amount.
  void collectTrainingExample({
    rawInput: correction.rawCorrectionText,
    normalizedInput: correction.rawCorrectionText.toLowerCase().trim(),
    parserResult: {
      type: correction.originalType,
      amount: correction.originalAmount,
      confidence: 0.5, // unknown original confidence — use neutral value
      productName: null,
      customerName: null,
    },
    aiResult: null,
    acceptedResult: {
      type: correction.correctedType ?? correction.originalType,
      amount: correction.correctedAmount ?? correction.originalAmount,
    },
    language: "unknown",
    businessCategory: "other",
    userId: correction.userId,
    diverged: true,
    correction: {
      correctedType: correction.correctedType ?? correction.originalType,
      correctedAmount: correction.correctedAmount ?? correction.originalAmount,
      correctedAt: correction.timestamp,
    },
  });
}
