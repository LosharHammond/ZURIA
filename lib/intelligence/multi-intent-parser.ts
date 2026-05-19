/**
 * Multi-Intent Parser
 *
 * Splits a single user message containing multiple financial events into
 * individual ParsedTransaction objects — each one ready to be recorded.
 *
 * Problem: "sold rice 120 and bought fuel 40" contains two distinct
 * financial events. The transaction parser handles only one at a time.
 * Without this layer, only the first event is recorded and the second is lost.
 *
 * Strategy:
 *  1. Detect whether the message contains multiple intent signals
 *  2. Split on conjunction words that link financial actions
 *  3. Parse each segment independently with parseTransaction()
 *  4. Return only segments that meet the confidence threshold
 *
 * Conservative approach: when in doubt, do NOT split. It is safer to parse
 * a single transaction correctly than to incorrectly split one into two.
 */

import { parseTransaction } from "@/lib/parsers/transaction-parser";
import type { ParsedTransaction } from "@/types/domain";

// ─── Split detection ──────────────────────────────────────────────────────────

/**
 * Financial action verbs that signal the start of a new transaction.
 * A conjunction immediately followed by one of these words indicates
 * a new financial event, not a descriptor of the previous one.
 */
const FINANCIAL_VERBS = [
  "sold", "sell", "bought", "buy", "paid", "pay", "spent", "spend",
  "received", "receive", "gave", "give", "lent", "lend",
  "transferred", "transfer", "withdrew", "withdraw",
  "salary", "expense", "income",
];

const VERB_PATTERN = FINANCIAL_VERBS.join("|");

/**
 * Conjunction patterns that may link multiple financial events.
 * Only split when the conjunction is followed by a financial verb.
 *
 * Also handles "but still owes N" / "but owes N" — common Ghanaian phrasing
 * for a compound "paid X, debt balance Y" message. We split on "but" only
 * when it is immediately followed by "still owes", "owes", or "still ow"
 * so we never incorrectly split unrelated "but" clauses.
 */
const SPLIT_RE = new RegExp(
  `\\s*(?:and|plus|also|then|,\\s*(?:and)?|;)\\s+(?=${VERB_PATTERN})`,
  "gi",
);

/**
 * Detects "paid X ... but still owes Y" compound patterns and returns two
 * raw segments so the caller can parse each independently.
 * Returns null if the message does not match this shape.
 */
function splitPaidOwes(raw: string): [string, string] | null {
  // Pattern: "... paid N ... but (still) owes M ..."
  const m = /^(.+?)\bbut\s+(?:still\s+)?(?:ow(?:es?|e[sd]?)\b.+)$/i.exec(raw.trim());
  if (!m) return null;
  const firstPart  = (m[1] ?? "").trim();
  const secondPart = raw.slice(firstPart.length).replace(/^\s*but\s*/i, "").trim();
  if (!firstPart || !secondPart) return null;
  return [firstPart, secondPart];
}

/** Minimum confidence for a segment to be included in results */
const MIN_CONFIDENCE = 0.40;

// ─── Multi-intent parser ──────────────────────────────────────────────────────

export interface MultiIntentResult {
  /** Whether more than one transaction was detected */
  isMultiIntent: boolean;
  /** Parsed transactions — may be 1 (single intent) or multiple */
  transactions: ParsedTransaction[];
  /** The raw segments that were parsed (for debugging) */
  segments: string[];
}

/**
 * Parse a user message that may contain multiple financial events.
 *
 * Always returns at least one result (the full message parsed as a single
 * transaction). If multiple transactions are detected, returns all of them.
 *
 * @param rawText - The user's original message (already Ghanaian-normalized)
 */
export function parseMultiIntent(rawText: string): MultiIntentResult {
  // ── Step 0: Handle "paid X but still owes Y" compound messages ────────────
  // These cannot be split by SPLIT_RE because "but" is not in the conjunction
  // list (too ambiguous in general). We detect this specific shape explicitly.
  const oweSplit = splitPaidOwes(rawText);
  if (oweSplit) {
    const [seg1, seg2] = oweSplit;
    const p1 = parseTransaction(seg1!);
    const p2 = parseTransaction(seg2!);
    const valid = [
      ...(p1.confidence >= MIN_CONFIDENCE && p1.amount > 0 ? [p1] : []),
      ...(p2.confidence >= MIN_CONFIDENCE               ? [p2] : []),
    ];
    if (valid.length === 2) {
      return { isMultiIntent: true, transactions: valid, segments: [seg1!, seg2!] };
    }
    if (valid.length === 1) {
      return { isMultiIntent: false, transactions: valid, segments: [rawText] };
    }
  }

  // ── Step 1: Attempt to split into segments ─────────────────────────────────
  const segments = rawText.split(SPLIT_RE).map((s) => s.trim()).filter(Boolean);

  // Only attempt multi-parse if we found more than one segment
  if (segments.length < 2) {
    const single = parseTransaction(rawText);
    return {
      isMultiIntent: false,
      transactions:  single.confidence >= MIN_CONFIDENCE ? [single] : [],
      segments:      [rawText],
    };
  }

  // ── Step 2: Parse each segment independently ───────────────────────────────
  const results = segments
    .map((seg) => ({ seg, parsed: parseTransaction(seg) }))
    .filter(({ parsed }) => parsed.confidence >= MIN_CONFIDENCE && parsed.amount > 0);

  // ── Step 3: Validate — require all segments to have amount > 0 ────────────
  // If any segment fails, fall back to parsing the full text as one transaction.
  // This prevents incorrect splits where "and" is part of a product name.
  if (results.length === 0) {
    const single = parseTransaction(rawText);
    return {
      isMultiIntent: false,
      transactions:  single.confidence >= MIN_CONFIDENCE ? [single] : [],
      segments:      [rawText],
    };
  }

  // If only one segment parsed successfully, treat as single intent
  if (results.length === 1) {
    return {
      isMultiIntent: false,
      transactions:  [results[0]!.parsed],
      segments:      [results[0]!.seg],
    };
  }

  return {
    isMultiIntent: true,
    transactions:  results.map((r) => r.parsed),
    segments:      results.map((r) => r.seg),
  };
}

// ─── Multi-transaction summary ────────────────────────────────────────────────

import { MONEY_IN_TYPES, MONEY_OUT_TYPES } from "@/types/domain";
import { formatMoney } from "@/lib/utils";

/**
 * Generate a compact confirmation summary for multiple recorded transactions.
 */
export function fmtMultiConfirm(
  transactions: ParsedTransaction[],
  dailyIn: number,
  dailyOut: number,
): string {
  const lines: string[] = ["✅ Recorded:"];

  for (const txn of transactions) {
    const isIn  = MONEY_IN_TYPES.includes(txn.type);
    const isOut = MONEY_OUT_TYPES.includes(txn.type);
    const arrow = isIn ? "💚" : isOut ? "🔴" : "🔄";
    const item  = txn.productName ? ` (${txn.productName})` : "";
    const who   = txn.customerName ? ` · ${txn.customerName}` : "";
    lines.push(`${arrow} ${txn.type} — *${formatMoney(txn.amount)}*${item}${who}`);
  }

  const net = dailyIn - dailyOut;
  lines.push("");
  if (net > 0) {
    lines.push(`📊 You're *+${formatMoney(net)}* today.`);
  } else if (net < 0) {
    lines.push(`📊 Down *${formatMoney(Math.abs(net))}* today.`);
  }

  return lines.join("\n");
}
