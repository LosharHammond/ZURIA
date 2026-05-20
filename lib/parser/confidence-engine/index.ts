/**
 * lib/parser/confidence-engine/index.ts
 *
 * Multi-layer confidence engine.
 * Replaces the simple 0–1 score with a weighted, validated confidence system.
 *
 * CONF_HIGH threshold raised to 0.90 (from 0.85).
 * Below 0.90 → AI enhancement required.
 *
 * "False confidence is dangerous."
 *
 * Server-safe — pure functions, no Firestore.
 */

// ─── Thresholds ───────────────────────────────────────────────────────────────

/** 90%+ → save immediately, no AI needed */
export const CONF_HIGH_V2 = 0.90;

/** 60%+ → medium confidence, lightweight AI enhancement */
export const CONF_MEDIUM_V2 = 0.60;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FieldConfidence {
  amount: number;          // 0–1
  transactionType: number; // 0–1
  customerName: number;    // 0–1 (1 if absent and not needed)
  productName: number;     // 0–1 (1 if absent and not needed)
  paymentMethod: number;   // 0–1
  language: number;        // 0–1 clarity score
}

export interface ConfidenceResult {
  overall: number;               // 0–1 final weighted score
  fieldConfidence: FieldConfidence;
  ambiguityReasons: string[];
  recoverySuggestions: string[];
  requiresAI: boolean;           // true if overall < 0.90
  requiresHumanRecovery: boolean; // true if overall < 0.60
  confidence: "high" | "moderate" | "low";
}

export interface ConfidenceInput {
  rawText: string;
  normalizedText: string;
  parserType: string;
  parserAmount: number;
  parserConfidence: number;    // parser's raw 0–1 score
  productName: string | null;
  customerName: string | null;
  paymentMethod: string | null;
  language: string;
  historicalAvgAmount?: number; // from business profile
  previousTypes?: string[];     // recent transaction types for context
}

// ─── Sub-scorers ──────────────────────────────────────────────────────────────

/**
 * Scores the extracted amount field.
 */
export function scoreAmount(
  amount: number,
  rawText: string,
  historical?: number,
): { score: number; reasons: string[] } {
  const reasons: string[] = [];

  if (amount === 0) {
    return { score: 0.0, reasons: ["No amount detected"] };
  }

  let score = 0.90;

  // Very large amount — suspicious
  if (amount > 500_000) {
    score -= 0.3;
    reasons.push(`Unusually large amount (${amount.toLocaleString()}) — possible OCR or input error`);
  }

  // Amount not found literally in raw text
  const amountStr = amount.toString();
  const amountStrNoDecimals = Math.round(amount).toString();
  if (!rawText.includes(amountStr) && !rawText.includes(amountStrNoDecimals)) {
    score -= 0.15;
    reasons.push("Amount not found verbatim in original text");
  }

  // Historical average comparison
  if (historical !== undefined && historical > 0) {
    if (amount > historical * 5) {
      score -= 0.2;
      reasons.push(`Amount (${amount}) is more than 5x the historical average (${historical.toFixed(2)})`);
    }
  }

  return { score: Math.max(0, Math.min(1, score)), reasons };
}

/**
 * Scores the extracted transaction type.
 */
export function scoreTransactionType(
  type: string,
  rawText: string,
  previousTypes: string[],
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  const lower = rawText.toLowerCase();

  if (!type || type === "unknown") {
    return { score: 0.0, reasons: ["Transaction type could not be determined"] };
  }

  // Check if the type keyword appears in the raw text
  const typeKeywords: Record<string, string[]> = {
    sale:      ["sold", "sale", "customer", "paid", "bought"],
    expense:   ["spent", "expense", "bought", "paid", "cost"],
    income:    ["received", "income", "payment", "collected", "got"],
    debt:      ["owe", "debt", "credit", "borrow", "lend"],
    loan:      ["loan", "borrow", "lend", "advance"],
    inventory: ["stock", "inventory", "restock", "bought"],
    withdrawal:["withdraw", "took out", "cash out"],
    deposit:   ["deposit", "paid in", "top up", "topup"],
  };

  const keywords = typeKeywords[type.toLowerCase()] ?? [type.toLowerCase()];
  const foundInText = keywords.some((kw) => lower.includes(kw));

  let score = foundInText ? 0.95 : 0.60;

  if (!foundInText) {
    reasons.push(`Transaction type "${type}" not confirmed by keywords in text`);
  }

  // Bonus if this type appears in recent history
  if (previousTypes.includes(type)) {
    score = Math.min(1, score + 0.05);
  }

  return { score, reasons };
}

/**
 * Scores language clarity of the input text.
 */
export function scoreLanguageClarity(
  rawText: string,
  language: string,
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  const words = rawText.trim().split(/\s+/);

  if (words.length < 3) {
    return { score: 0.60, reasons: ["Text is very short — low context for confident parsing"] };
  }

  let score = 0.95;

  // Multiple conflicting transaction signals
  const conflictingPairs: Array<[string, string]> = [
    ["sold", "bought"],
    ["received", "spent"],
    ["income", "expense"],
    ["deposit", "withdrawal"],
  ];

  const lower = rawText.toLowerCase();
  let conflicts = 0;
  for (const [a, b] of conflictingPairs) {
    if (lower.includes(a) && lower.includes(b)) {
      conflicts++;
      reasons.push(`Conflicting signals: "${a}" and "${b}" both present`);
    }
  }

  if (conflicts > 0) {
    score -= conflicts * 0.2;
  }

  // Mixed language (heuristic: common Ghanaian/Twi words mixed with English)
  const ghanaianWords = ["cedis", "cedi", "ghana", "momo", "ewom", "sika", "wo", "me", "ɛ"];
  const englishWords = ["sold", "bought", "paid", "received", "spent"];
  const hasGhanaian = ghanaianWords.some((w) => lower.includes(w));
  const hasEnglish = englishWords.some((w) => lower.includes(w));

  if (hasGhanaian && hasEnglish) {
    // Mixed language detected but cleanly — common in Ghana, handle gracefully
    score = Math.min(score, 0.85);
  } else if (language !== "en" && !hasGhanaian && !hasEnglish) {
    // Unknown language mix
    reasons.push("Language clarity uncertain — consider sending in English or Twi");
    score = Math.min(score, 0.75);
  }

  return { score: Math.max(0, Math.min(1, score)), reasons };
}

// ─── Main Confidence Computation ─────────────────────────────────────────────

/**
 * Computes a multi-layer, weighted confidence score for a parsed transaction.
 * Pure function — safe to call anywhere.
 */
export function computeConfidence(input: ConfidenceInput): ConfidenceResult {
  const {
    rawText,
    parserType,
    parserAmount,
    customerName,
    productName,
    paymentMethod,
    language,
    historicalAvgAmount,
    previousTypes = [],
  } = input;

  // ── Field scores ──────────────────────────────────────────────────────────

  const amountResult = scoreAmount(parserAmount, rawText, historicalAvgAmount);
  const typeResult   = scoreTransactionType(parserType, rawText, previousTypes);
  const langResult   = scoreLanguageClarity(rawText, language);

  // Absent optional fields score as 1 (not missing, just not needed)
  const customerScore    = customerName  !== null ? Math.min(1, 0.80 + (customerName.length > 2 ? 0.15 : 0)) : 1.0;
  const productScore     = productName   !== null ? Math.min(1, 0.80 + (productName.length  > 2 ? 0.15 : 0)) : 1.0;
  const paymentScore     = paymentMethod !== null ? 0.95 : 0.70;

  const fieldConfidence: FieldConfidence = {
    amount:          amountResult.score,
    transactionType: typeResult.score,
    customerName:    customerScore,
    productName:     productScore,
    paymentMethod:   paymentScore,
    language:        langResult.score,
  };

  // ── Weights ───────────────────────────────────────────────────────────────
  // amount 0.35, type 0.30, language 0.15, customer 0.10, product 0.10
  // Payment method is folded into amount for now (used as a tiebreaker)
  const weighted =
    fieldConfidence.amount          * 0.35 +
    fieldConfidence.transactionType * 0.30 +
    fieldConfidence.language        * 0.15 +
    fieldConfidence.customerName    * 0.10 +
    fieldConfidence.productName     * 0.10;

  // ── Penalty pass ─────────────────────────────────────────────────────────
  let overall = weighted;
  const allReasons: string[] = [
    ...amountResult.reasons,
    ...typeResult.reasons,
    ...langResult.reasons,
  ];

  // Missing payment method reduces final score slightly
  if (!paymentMethod) {
    overall -= 0.03;
  }

  // Multiple interpretations penalty (conflicts in language scoring)
  const conflictCount = langResult.reasons.filter((r) => r.startsWith("Conflicting")).length;
  if (conflictCount > 1) {
    overall -= 0.05;
    allReasons.push("Multiple conflicting signals compound uncertainty");
  }

  overall = Math.max(0, Math.min(1, overall));

  // ── Recovery suggestions ──────────────────────────────────────────────────
  const suggestions: string[] = [];
  if (fieldConfidence.amount < 0.70) {
    suggestions.push("Include the exact amount (e.g. 'GH₵ 50' or '50 cedis')");
  }
  if (fieldConfidence.transactionType < 0.70) {
    suggestions.push("Be specific about the transaction type (sold, bought, received, spent)");
  }
  if (fieldConfidence.language < 0.70) {
    suggestions.push("Avoid mixing conflicting transaction words in one message");
  }
  if (!customerName && parserType === "sale") {
    suggestions.push("Adding a customer name helps confirm this is a sale");
  }

  // ── Result assembly ───────────────────────────────────────────────────────
  const requiresAI            = overall < CONF_HIGH_V2;
  const requiresHumanRecovery = overall < CONF_MEDIUM_V2;

  let confidence: "high" | "moderate" | "low";
  if (overall >= CONF_HIGH_V2)   confidence = "high";
  else if (overall >= CONF_MEDIUM_V2) confidence = "moderate";
  else confidence = "low";

  return {
    overall,
    fieldConfidence,
    ambiguityReasons:    allReasons,
    recoverySuggestions: suggestions,
    requiresAI,
    requiresHumanRecovery,
    confidence,
  };
}
