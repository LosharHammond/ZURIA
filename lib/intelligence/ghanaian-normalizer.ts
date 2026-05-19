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
    label: "X cost N → expense X N (utility/resource cost framing)",
    // Matches: "water cost 50", "electricity cost 200", "fuel cost 80"
    // The parser sees "water" as a sellable product; reframe as expense so it
    // routes correctly. Only applies to known utility/overhead words.
    pattern: /\b(water|electricity|ecg|fuel|gas|rent|transport|airtime|internet|data)\s+cost\b/gi,
    replacement: "expense $1",
  },
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

  // ── Akan Twi payment/debt verbs ───────────────────────────────────────────
  {
    // "bɔɔ" uses ɔ (U+0254) which is not a JS \w char, so \b does not work.
    // Use a lookahead/lookbehind on whitespace/start-of-string instead.
    label: "bɔɔ → paid (Akan Twi for 'paid/settled a debt')",
    pattern: /(^|[\s(])(bɔɔ|bo[oɔ])([\s),.]|$)/gi,
    replacement: "$1paid$3",
  },
  {
    label: "na how much → how much (Pidgin emphasis particle strip)",
    pattern: /\bna\s+(how\s+much)\b/gi,
    replacement: "$1",
  },
  {
    label: "[ProperName] pay N → [ProperName] paid N (present→past for payment statements)",
    // Only fires when a capitalised name (≥3 chars) directly precedes 'pay' + amount,
    // indicating a completed transaction, not a command or query.
    pattern: /\b([A-Z][a-z]{2,})\s+pay\s+(\d[\d.,]*)/g,
    replacement: "$1 paid $2",
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

  // ── Stock intake: "I have N [unit] of X" → "received N [unit] of X" ─────
  // Covers common ways users report stock on hand.
  {
    label: "I have N [unit] of X → received N [unit] of X (stock intake)",
    pattern: /\bi\s+have\s+(\d+)\s*(bags?|pcs?|pieces?|cartons?|crates?|packs?|bottles?|units?|boxes?|tins?|rolls?|sachets?|dozens?|items?|pairs?|sets?|bundles?|trays?|kits?|jars?|cans?)\b/gi,
    replacement: "received $1 $2",
  },

  // ── Debt management operations ────────────────────────────────────────────
  {
    label: "Mark X debt as cleared → X paid debt (debt_payment signal)",
    // Produce "X paid debt" directly (not "X clear debt") so the classifier
    // sees it as a ledger entry, not a query, even in a single-pass normalizer.
    pattern: /\bmark\s+(\w+)\s+(?:debt|balance|bill|account)\s+as\s+cleared?\b/gi,
    replacement: "$1 paid debt",
  },
  {
    label: "clear X full/all debt → X paid full debt",
    pattern: /\bclear\s+(\w+)(?:'s)?\s+(?:full\s+|all\s+)?(?:debt|balance|bill)\b/gi,
    replacement: "$1 paid full debt",
  },
  {
    label: "Reduce X debt by N → X paid N",
    pattern: /\breduce\s+(\w+)(?:'s)?\s+(?:debt|balance|bill)\s+by\s+(\d[\d.]*)\b/gi,
    replacement: "$1 paid $2",
  },
  {
    label: "X no pay me / X no gree pay → X hasn't paid me",
    pattern: /\b(\w+)\s+no\s+(?:gree\s+)?pay\s+(?:me|us)?\b/gi,
    replacement: "$1 hasn't paid me",
  },
  {
    label: "X refuse(d) to pay → X refusing to pay (debt follow-up)",
    pattern: /\b(\w+)\s+refuse[sd]?\s+to\s+pay\b/gi,
    replacement: "$1 refusing to pay",
  },

  // ── Discount / reduction ──────────────────────────────────────────────────
  {
    label: "gave discount N → expense discount N",
    pattern: /\b(?:i\s+)?gave\s+(?:a\s+)?discount(?:\s+of)?\s+(\d[\d.]*)\b/gi,
    replacement: "expense discount $1",
  },

  // ── Pidgin / colloquial query normalisation ───────────────────────────────
  {
    label: "wan check / wan see → want to check (query intent)",
    pattern: /\bi?\s*wan\s+(?:check|see)\s+(?:my\s+)?(?:money|balance|account|profit|cash|record|report)\b/gi,
    replacement: "I want to check my balance",
  },
  {
    label: "my cash don finish / money don finish → my cash is finished",
    pattern: /\b(my\s+)?(?:cash|money)\s+don\s+finish\b/gi,
    replacement: "my cash is finished",
  },
  {
    label: "don finish (standalone) → is finished",
    pattern: /\bdon\s+finish\b/gi,
    replacement: "is finished",
  },
  {
    label: "wetin i get → what I have",
    pattern: /\bwetin\s+(?:i|we)\s+(?:get|have)\b/gi,
    replacement: "what I have",
  },
  {
    label: "how e dey → how is it",
    pattern: /\bhow\s+e\s+dey\b/gi,
    replacement: "how is it",
  },
  {
    label: "i wan → I want to",
    pattern: /\bi\s+wan\b/gi,
    replacement: "I want to",
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
  // ── Implicit conjunction: "[number] [financial verb]" without "and" ───────
  // Handles "sold rice 100 bought fuel 20 paid worker 30" →
  //         "sold rice 100 and bought fuel 20 and paid worker 30"
  // Only inserts "and" when a financial action verb immediately follows a number.
  {
    label: "N [financial-verb] → N and [financial-verb] (implicit multi-intent)",
    pattern: /(\d+)\s+(sold|bought|paid|spent|received|gave|lent|withdrew|invested|sell|buy|pay|spend|give|lend|withdraw|invest)\b/gi,
    replacement: "$1 and $2",
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
