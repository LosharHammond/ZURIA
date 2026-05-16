/**
 * Ghanaian English Pre-Processor
 *
 * Bridges the gap between how Ghanaian SME owners naturally speak and what
 * the transaction parser's pattern library expects.
 *
 * This runs BEFORE the transaction parser, silently translating colloquial
 * Ghanaian expressions into parser-recognizable equivalents — so the parser
 * can focus on financial pattern matching, not linguistic normalization.
 *
 * Principles:
 *  - Normalize, don't translate. Keep the meaning, clarify the structure.
 *  - Preserve names, amounts, and product words exactly.
 *  - Never modify numbers.
 *  - Idempotent — safe to run on already-normalized text.
 */

// ─── Normalization rules ──────────────────────────────────────────────────────

interface NormRule {
  /** Pattern to match in the lowercased input */
  pattern: RegExp;
  /** Replacement — can reference capture groups */
  replacement: string;
  /** Human label for debugging */
  label: string;
}

const RULES: NormRule[] = [
  // ── Income / received ────────────────────────────────────────────────────
  {
    label: "dash me → gave me (income)",
    pattern: /\b(\w+)\s+dash\s+me\b/gi,
    replacement: "$1 gave me",
  },
  {
    label: "dem dash me → they gave me",
    pattern: /\bdem\s+dash\s+me\b/gi,
    replacement: "they gave me",
  },
  {
    label: "i receive → I received",
    pattern: /\bi\s+receive\b/gi,
    replacement: "I received",
  },
  {
    label: "momo came in → received momo",
    pattern: /\bmomo\s+came?\s+in\b/gi,
    replacement: "received momo",
  },
  {
    label: "money came → received",
    pattern: /\bmoney\s+came?\s+(in)?\b/gi,
    replacement: "received",
  },
  {
    label: "customer send momo → customer paid momo",
    pattern: /\bcustomer\s+send\s+momo\b/gi,
    replacement: "customer paid via momo",
  },
  {
    label: "send momo to → paid momo to (expense/transfer)",
    pattern: /\bsend\s+momo\s+to\b/gi,
    replacement: "paid momo to",
  },

  // ── Debt / credit ─────────────────────────────────────────────────────────
  {
    label: "take on credit → owes me (debt)",
    pattern: /\bcustomer\s+take\s+(.+?)\s+on\s+credit\b/gi,
    replacement: "customer owes me for $1",
  },
  {
    label: "take credit → owes me",
    pattern: /\btake\s+credit\b/gi,
    replacement: "owes me",
  },
  {
    label: "[name] take [item] → [name] owes me for [item]",
    pattern: /\b(\w+)\s+take\s+([a-zA-Z\s]+)\s+without\s+pay(ing)?\b/gi,
    replacement: "$1 owes me for $2",
  },

  // ── Debt repayment ────────────────────────────────────────────────────────
  {
    label: "X clear small → X made partial payment",
    pattern: /\b(\w+)\s+clear\s+small\b/gi,
    replacement: "$1 paid partial",
  },
  {
    label: "X clear the debt → X paid debt",
    pattern: /\b(\w+)\s+clear\s+(the\s+)?(debt|balance|bill|money)\b/gi,
    replacement: "$1 paid debt",
  },
  {
    label: "X clear all → X paid everything",
    pattern: /\b(\w+)\s+clear\s+all\b/gi,
    replacement: "$1 paid everything",
  },
  {
    label: "X clear → X paid",
    pattern: /\b(\w+)\s+clear\b(?!\s+out)/gi,
    replacement: "$1 paid",
  },
  {
    label: "X pay me back → X paid me back (repayment)",
    pattern: /\b(\w+)\s+pay\s+me\s+back\b/gi,
    replacement: "$1 repaid me",
  },

  // ── Expenses ──────────────────────────────────────────────────────────────
  {
    label: "chop → spent (informal expense)",
    pattern: /\bi\s+chop\b/gi,
    replacement: "I spent",
  },
  {
    label: "chop loss → recorded a loss",
    pattern: /\b(i|we)\s+chop\s+loss\b/gi,
    replacement: "$1 had a loss",
  },
  {
    label: "blow money → spent money",
    pattern: /\bblow\s+money\b/gi,
    replacement: "spent money",
  },
  {
    label: "used money for → expense for",
    pattern: /\bused\s+money\s+for\b/gi,
    replacement: "expense for",
  },
  {
    label: "pay ECG/water/rent → expense for ECG/water/rent",
    pattern: /\bpay\s+(ECG|water|rent|electricity|phone|transport|fuel|food)\b/gi,
    replacement: "expense $1",
  },

  // ── Sales ─────────────────────────────────────────────────────────────────
  {
    label: "sold out → sold all",
    pattern: /\bsold\s+out\b/gi,
    replacement: "sold all",
  },
  {
    label: "sell X for Y → sold X for Y",
    pattern: /\bsell\b/gi,
    replacement: "sold",
  },
  {
    label: "we sell → I sold",
    pattern: /\bwe\s+sell\b/gi,
    replacement: "I sold",
  },

  // ── Loans / borrowing ─────────────────────────────────────────────────────
  {
    label: "took from X → borrowed from X",
    pattern: /\btook\s+money\s+from\b/gi,
    replacement: "borrowed from",
  },
  {
    label: "lend X money → gave X loan",
    pattern: /\blend\s+(\w+)\s+money\b/gi,
    replacement: "gave $1 a loan",
  },

  // ── Transfers ─────────────────────────────────────────────────────────────
  {
    label: "transfer to X → sent money to X",
    pattern: /\btransfer\s+to\b/gi,
    replacement: "sent money to",
  },
  {
    label: "moved money to → transferred to",
    pattern: /\bmoved?\s+money\s+to\b/gi,
    replacement: "transferred to",
  },

  // ── Conjunction splitting markers ─────────────────────────────────────────
  // These are handled by the multi-intent parser, but normalizing
  // "plus" and "also" to "and" makes the split pattern simpler.
  {
    label: "also → and (multi-intent connector)",
    pattern: /\balso\s+(sold|bought|paid|spent|received|gave)\b/gi,
    replacement: "and $1",
  },
  {
    label: "then → and (sequential connector)",
    pattern: /\bthen\s+(sold|bought|paid|spent|received|gave)\b/gi,
    replacement: "and $1",
  },
];

// ─── Normalizer function ──────────────────────────────────────────────────────

/**
 * Normalize Ghanaian English expressions in a raw user message.
 *
 * Safe to call on any input — if no rules match, the original text is returned
 * unchanged. The transformation is logged in debug mode only.
 *
 * @param rawText - The original user message
 * @returns Normalized text ready for the transaction parser
 */
export function normalizeGhanaianEnglish(rawText: string): string {
  let text = rawText.trim();

  for (const rule of RULES) {
    text = text.replace(rule.pattern, rule.replacement);
  }

  return text;
}

/**
 * Whether the text appears to be in a colloquial Ghanaian English style.
 * Used for logging / telemetry only.
 */
export function looksLikeGhanaianSlang(rawText: string): boolean {
  const SLANG_SIGNALS = [
    "dash me", "clear small", "chop loss", "take credit", "send momo",
    "e dey", "e no", "i dey", "we dey", "na so", "abi", "wahala",
    "nneεma", "ka ho", "sika", "hwε me",
  ];
  const lower = rawText.toLowerCase();
  return SLANG_SIGNALS.some((s) => lower.includes(s));
}
