/**
 * lib/confidence/scoring/index.ts
 *
 * Multi-layer confidence scoring for individual signals.
 * Each scorer returns a normalized 0–1 score and an explanation.
 *
 * Runtime-agnostic — no Firebase, no Node.js-only APIs.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SignalScore {
  score:   number;     // 0–1
  reasons: string[];   // human-readable explanations for debugging
}

// ─── Amount Scorer ────────────────────────────────────────────────────────────

/**
 * Score the confidence that the extracted amount is correct.
 *
 * Factors:
 * - Does the raw text contain explicit digit(s)?
 * - Is the amount within a realistic African SME range?
 * - Does it match a historical average (if provided)?
 */
export function scoreAmount(
  amount: number | null,
  rawText: string,
  historicalAvg?: number,
): SignalScore {
  const reasons: string[] = [];

  if (amount === null || amount <= 0) {
    return { score: 0.1, reasons: ["No valid amount extracted"] };
  }

  // Base: amount exists
  let score = 0.50;

  // Digit presence in raw text — strongest signal
  const hasExplicitDigit = /\d/.test(rawText);
  if (hasExplicitDigit) {
    score += 0.25;
    reasons.push("Explicit digit found in text");
  } else {
    reasons.push("Amount inferred — no digit in text");
  }

  // Realistic range check (GHS 0.01 – 100,000 for SME)
  if (amount >= 0.01 && amount <= 100_000) {
    score += 0.10;
    reasons.push("Amount within realistic SME range");
  } else if (amount > 100_000) {
    score -= 0.10;
    reasons.push("Amount unusually large");
  }

  // Historical similarity
  if (historicalAvg !== undefined && historicalAvg > 0) {
    const ratio = Math.abs(amount - historicalAvg) / historicalAvg;
    if      (ratio <= 0.20) { score += 0.15; reasons.push("Close to historical average (±20%)"); }
    else if (ratio <= 0.50) { score += 0.08; reasons.push("Near historical average (±50%)"); }
    else if (ratio >= 2.0)  { score -= 0.08; reasons.push("Significantly above historical average"); }
  }

  return { score: Math.max(0, Math.min(1, score)), reasons };
}

// ─── Transaction Type Scorer ──────────────────────────────────────────────────

/** Strong type signal keywords by category */
const TYPE_KEYWORDS: Record<string, string[]> = {
  sale:           ["sold", "sell", "sales", "customer paid", "collected", "payment received", "ada", "tɔn"],
  expense:        ["paid for", "bought", "spent", "purchase", "pay", "tua"],
  debt:           ["owes", "credit", "on credit", "take now pay later", "owe"],
  repayment:      ["paid back", "cleared debt", "paid debt", "settled"],
  stock_purchase: ["restock", "stock", "inventory", "wholesale", "supplier"],
  salary:         ["salary", "wages", "worker", "staff", "pay employee"],
  cost:           ["rent", "utilities", "electricity", "water", "bill"],
  borrow_in:      ["borrowed", "loan received", "took loan", "advance"],
  borrow_out:     ["gave loan", "lent", "gave advance"],
};

/**
 * Score confidence that the extracted transaction type is correct.
 */
export function scoreTransactionType(
  extractedType: string,
  rawText: string,
  previousTypes?: string[],
): SignalScore {
  const reasons: string[] = [];
  const lower   = rawText.toLowerCase();

  // Does the raw text contain strong type keywords matching the extracted type?
  const keywords = TYPE_KEYWORDS[extractedType] ?? [];
  const keywordMatches = keywords.filter((kw) => lower.includes(kw));

  let score = 0.50; // base — type was extracted

  if (keywordMatches.length >= 2) {
    score += 0.30;
    reasons.push(`Strong type signal: "${keywordMatches.slice(0, 2).join('", "')}"`);
  } else if (keywordMatches.length === 1) {
    score += 0.15;
    reasons.push(`Type keyword found: "${keywordMatches[0]}"`);
  } else {
    reasons.push("Type inferred from context — no strong keyword");
  }

  // Historical pattern consistency
  if (previousTypes && previousTypes.length >= 3) {
    const freq = previousTypes.filter((t) => t === extractedType).length / previousTypes.length;
    if (freq >= 0.70) {
      score += 0.15;
      reasons.push(`Consistent with business pattern (${Math.round(freq * 100)}% of recent)`);
    } else if (freq >= 0.40) {
      score += 0.05;
    } else if (freq < 0.10 && previousTypes.length >= 10) {
      score -= 0.10;
      reasons.push("Unusual type for this business");
    }
  }

  return { score: Math.max(0, Math.min(1, score)), reasons };
}

// ─── Language Clarity Scorer ──────────────────────────────────────────────────

/** Markers that indicate unambiguous financial intent */
const CLEAR_FINANCIAL_MARKERS = [
  /\d+(\.\d+)?/, // numbers
  /ghc|ghs|gh₵|cedis?/i,
  /sold|sale|paid|buy|bought|expense|debt|salary|stock/i,
  /tɔn|tua|ada|hwɛ/i, // Twi financial terms
  /momo|mobile money/i,
];

/**
 * Score confidence based on language/text clarity.
 */
export function scoreLanguageClarity(
  rawText: string,
  detectedLanguage?: string,
): SignalScore {
  const reasons: string[] = [];
  let score = 0.40;

  // Count matching clear markers
  const matchCount = CLEAR_FINANCIAL_MARKERS.filter((r) => r.test(rawText)).length;
  if (matchCount >= 3) {
    score += 0.35;
    reasons.push(`${matchCount} clear financial markers in text`);
  } else if (matchCount === 2) {
    score += 0.20;
    reasons.push("2 financial markers found");
  } else if (matchCount === 1) {
    score += 0.08;
    reasons.push("1 financial marker found");
  } else {
    reasons.push("No strong financial markers");
  }

  // Text length signal — very short texts are ambiguous
  if (rawText.length < 5) {
    score -= 0.15;
    reasons.push("Very short text — high ambiguity");
  } else if (rawText.length >= 15) {
    score += 0.05;
    reasons.push("Sufficient text length");
  }

  // Language known and supported
  if (detectedLanguage && detectedLanguage !== "unknown") {
    score += 0.05;
    reasons.push(`Detected language: ${detectedLanguage}`);
  }

  return { score: Math.max(0, Math.min(1, score)), reasons };
}

// ─── Entity Clarity Scorer ────────────────────────────────────────────────────

/**
 * Score confidence that customer/product entity extraction is reliable.
 */
export function scoreEntityClarity(
  customerName?: string | null,
  productName?: string | null,
  rawText?: string,
): SignalScore {
  const reasons: string[] = [];
  let score = 0.50;

  const hasCustomer = customerName && customerName.length >= 2;
  const hasProduct  = productName  && productName.length  >= 2;

  if (hasCustomer && hasProduct) {
    score += 0.25;
    reasons.push("Both customer and product extracted");
  } else if (hasCustomer || hasProduct) {
    score += 0.10;
    reasons.push(hasCustomer ? "Customer name extracted" : "Product name extracted");
  }

  // Explicit "from" / "to" language in text
  if (rawText) {
    if (/from\s+\w|to\s+\w|for\s+\w/i.test(rawText)) {
      score += 0.10;
      reasons.push("Explicit entity reference (from/to/for)");
    }
  }

  return { score: Math.max(0, Math.min(1, score)), reasons };
}

// ─── Semantic Ambiguity Scorer ────────────────────────────────────────────────

/** Patterns that indicate ambiguous intent */
const AMBIGUITY_PATTERNS = [
  /\?/,                           // question mark — user is asking, not recording
  /\b(what|how|when|who|which)\b/i,
  /\b(maybe|possibly|not sure|i think|perhaps)\b/i,
  /\b(check|balance|total|how much|summary)\b/i,
];

/**
 * Returns an ambiguity score (higher = MORE ambiguous = LOWER confidence).
 * Inverted before combining: ambiguityScore → (1 - ambiguityScore).
 */
export function scoreAmbiguity(rawText: string): SignalScore {
  const reasons: string[] = [];
  let ambiguity = 0;

  for (const pattern of AMBIGUITY_PATTERNS) {
    if (pattern.test(rawText)) {
      ambiguity += 0.25;
      reasons.push(`Ambiguity marker: ${pattern.source}`);
    }
  }

  // Return as confidence (inverted)
  const score = Math.max(0, 1 - ambiguity);
  return { score, reasons };
}
