/**
 * lib/confidence/evaluation/index.ts
 *
 * Ensemble confidence evaluator — combines multiple signal scores into
 * a single calibrated confidence value with tiers and human-readable
 * recovery recommendations.
 *
 * Runtime-agnostic — no Firebase, no Node.js-only APIs.
 */

import {
  scoreAmount,
  scoreTransactionType,
  scoreLanguageClarity,
  scoreEntityClarity,
  scoreAmbiguity,
  type SignalScore,
} from "../scoring";

// ─── Confidence Tiers ─────────────────────────────────────────────────────────

/**
 * 90–100%  → DETERMINISTIC_AUTO    — save immediately, no AI needed
 * 75–89%   → AI_ENHANCEMENT        — fast Groq model enrichment
 * 50–74%   → HUMAN_CLARIFICATION   — ask user to choose from options
 * 0–49%    → REJECT_UNSAFE         — do not save, explain and ask again
 */
export type ConfidenceTier =
  | "DETERMINISTIC_AUTO"
  | "AI_ENHANCEMENT"
  | "HUMAN_CLARIFICATION"
  | "REJECT_UNSAFE";

export const TIER_THRESHOLDS = {
  AUTO:        0.90,
  AI_ENHANCE:  0.75,
  HUMAN:       0.50,
  REJECT:      0.00,
} as const;

export function getTier(score: number): ConfidenceTier {
  if (score >= TIER_THRESHOLDS.AUTO)       return "DETERMINISTIC_AUTO";
  if (score >= TIER_THRESHOLDS.AI_ENHANCE) return "AI_ENHANCEMENT";
  if (score >= TIER_THRESHOLDS.HUMAN)      return "HUMAN_CLARIFICATION";
  return "REJECT_UNSAFE";
}

// ─── Ensemble Weights ─────────────────────────────────────────────────────────

/**
 * Weighted ensemble:
 *  - parser_confidence:  35%  (existing parser's own certainty)
 *  - amount:             25%  (amount extraction reliability)
 *  - transaction_type:   20%  (type classification certainty)
 *  - language_clarity:   12%  (text signal quality)
 *  - entity_clarity:     8%   (customer/product extraction)
 * Penalty factor: ambiguity (multiplied in, not additive)
 */
const WEIGHTS = {
  parserConfidence: 0.35,
  amount:           0.25,
  transactionType:  0.20,
  languageClarity:  0.12,
  entityClarity:    0.08,
} as const;

// ─── Input / Output types ─────────────────────────────────────────────────────

export interface EnsembleInput {
  /** Parser's own confidence (0–1) */
  parserConfidence: number;
  /** Extracted amount (null if not found) */
  amount: number | null;
  /** Raw user text */
  rawText: string;
  /** Extracted transaction type */
  transactionType: string;
  /** Detected language */
  language?: string;
  /** Extracted customer name */
  customerName?: string | null;
  /** Extracted product name */
  productName?: string | null;
  /** Historical average transaction amount for this business */
  historicalAvgAmount?: number;
  /** Recent transaction types for this business (pattern check) */
  previousTypes?: string[];
}

export interface EnsembleResult {
  /** Final 0–1 confidence */
  confidence: number;
  /** Categorical tier */
  tier: ConfidenceTier;
  /** Individual signal scores */
  signals: {
    parserConfidence: SignalScore;
    amount:           SignalScore;
    transactionType:  SignalScore;
    languageClarity:  SignalScore;
    entityClarity:    SignalScore;
    ambiguity:        SignalScore;
  };
  /** Why this tier was assigned */
  reasons: string[];
  /** Recovery suggestions if tier is HUMAN_CLARIFICATION or REJECT */
  recoverySuggestions: string[];
  /** Whether AI enhancement is needed */
  requiresAI: boolean;
  /** Whether human clarification is needed */
  requiresHuman: boolean;
  /** Whether the input should be rejected */
  shouldReject: boolean;
}

// ─── Core Evaluator ───────────────────────────────────────────────────────────

/**
 * Compute the ensemble confidence for a transaction extraction.
 *
 * This is the single function that all message handlers should call
 * after deterministic parsing to decide the routing path.
 */
export function computeEnsembleConfidence(input: EnsembleInput): EnsembleResult {
  // ── Individual signal scores ─────────────────────────────────────────────
  const parserSig = { score: Math.max(0, Math.min(1, input.parserConfidence)), reasons: ["Parser's own confidence"] } satisfies SignalScore;
  const amountSig      = scoreAmount(input.amount, input.rawText, input.historicalAvgAmount);
  const typeSig        = scoreTransactionType(input.transactionType, input.rawText, input.previousTypes);
  const langSig        = scoreLanguageClarity(input.rawText, input.language);
  const entitySig      = scoreEntityClarity(input.customerName, input.productName, input.rawText);
  const ambiguitySig   = scoreAmbiguity(input.rawText);

  // ── Weighted combination ─────────────────────────────────────────────────
  const weighted =
    parserSig.score    * WEIGHTS.parserConfidence +
    amountSig.score    * WEIGHTS.amount           +
    typeSig.score      * WEIGHTS.transactionType  +
    langSig.score      * WEIGHTS.languageClarity  +
    entitySig.score    * WEIGHTS.entityClarity;

  // Apply ambiguity penalty (multiplicative — strong ambiguity halves confidence)
  const penaltyFactor = 0.5 + 0.5 * ambiguitySig.score;
  const rawScore      = weighted * penaltyFactor;
  const confidence    = Math.max(0, Math.min(1, rawScore));

  const tier = getTier(confidence);

  // ── Build reasons ────────────────────────────────────────────────────────
  const reasons: string[] = [];
  if (confidence >= TIER_THRESHOLDS.AUTO)       reasons.push("High-confidence deterministic extraction");
  else if (confidence >= TIER_THRESHOLDS.AI_ENHANCE) reasons.push("AI enhancement improves this extraction");
  else if (confidence >= TIER_THRESHOLDS.HUMAN) reasons.push("Low confidence — user clarification needed");
  else                                           reasons.push("Too uncertain — safe to reject");

  // ── Recovery suggestions ─────────────────────────────────────────────────
  const recoverySuggestions: string[] = [];

  if (tier === "HUMAN_CLARIFICATION" || tier === "REJECT_UNSAFE") {
    if (input.amount === null || input.amount <= 0) {
      recoverySuggestions.push("Please include the amount (e.g. 'GHS 50')");
    }
    if (!input.customerName && !input.productName) {
      recoverySuggestions.push("Who did you sell to, or what did you buy?");
    }
    if (ambiguitySig.reasons.length > 0) {
      recoverySuggestions.push("Your message sounds like a question — please record what actually happened");
    }

    // Multi-choice prompt for ambiguous types
    const ambiguousTypes = ["expense", "stock_purchase", "cost"];
    if (ambiguousTypes.includes(input.transactionType)) {
      recoverySuggestions.push(
        "Was this:\n" +
        "A) An expense (money you spent)\n" +
        "B) Stock you bought to sell\n" +
        "C) A business bill (rent/utilities)"
      );
    }
  }

  return {
    confidence,
    tier,
    signals: {
      parserConfidence: parserSig,
      amount:           amountSig,
      transactionType:  typeSig,
      languageClarity:  langSig,
      entityClarity:    entitySig,
      ambiguity:        ambiguitySig,
    },
    reasons,
    recoverySuggestions,
    requiresAI:    tier === "AI_ENHANCEMENT",
    requiresHuman: tier === "HUMAN_CLARIFICATION",
    shouldReject:  tier === "REJECT_UNSAFE",
  };
}
