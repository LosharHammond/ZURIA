/**
 * ZURIA Universal Intent Classifier
 *
 * Maps every raw chat message → ClassifiedIntent (strict JSON).
 * This is the single routing authority for all 4 engines.
 *
 * Classification order (highest-priority first):
 *  1. AUTH_ENGINE        — always checked first; security cannot be bypassed
 *  2. SUBSCRIPTION_ENGINE (explicit payment claim) — "paid growth / pro / enterprise"
 *  3. LEDGER_ENGINE      — financial recording (amount > 0, confidence ≥ 0.40)
 *  4. LEDGER_QUERY_ENGINE — read/report intents
 *  5. SUBSCRIPTION_ENGINE (upgrade request / pricing) — explicit subscribe words
 *  6. HELP_ENGINE         — help / commands
 *  7. SMALLTALK           — greetings, noise
 *  8. ERROR               — ambiguous / incomplete
 *
 * Context memory: the caller passes a ConversationContext built from the
 * session document. The classifier uses it for intent continuity (e.g.,
 * "Ama paid 20" after a debt_list query stays in LEDGER_ENGINE, not ERROR).
 *
 * Runtime-agnostic: no firebase imports. Pure string processing + parser call.
 */

import { parseTransaction } from "@/lib/parsers/transaction-parser";
import type {
  ClassifiedIntent,
  ClassifiedEntities,
  ConversationContext,
  ConversationState,
  IntentType,
  LedgerSubIntent,
  QuerySubIntent,
  SubIntent,
} from "./types";

// ─── Re-export types so callers only need one import ─────────────────────────
export type {
  ClassifiedIntent,
  ClassifiedEntities,
  ConversationContext,
  ConversationState,
  IntentType,
  SubIntent,
  IsolationCheckResult,
} from "./types";

// ─── Constants ────────────────────────────────────────────────────────────────

const LEDGER_CONFIDENCE_THRESHOLD = 0.40;

// ─── Pattern sets ─────────────────────────────────────────────────────────────

// AUTH_ENGINE — checked before everything
const AUTH_LOCK_RE    = /^(lock|logout|log\s*out|signout|sign\s*out)$/i;
const AUTH_PIN_RE     = /^\d{4}$/;

// SUBSCRIPTION_ENGINE — explicit payment claim (highest-priority subscription signal)
const PAYMENT_CLAIM_RE = /\bpaid\s+(growth|pro|enterprise)(\s+annual)?\b/i;
// Explicit subscribe/upgrade intent (lower priority — blocked during ledger flow)
const SUBSCRIBE_RE = /\b(subscri(?:be|ption|bed|bing)|upgrade|pricing|plans?|growth\s*plan|pro\s*plan|enterprise\s*plan|how\s*much\s*(?:is|for|does)|hyεn|cancel\s*plan)\b/i;

// HELP_ENGINE
const HELP_RE = /\b(help|commands?|what\s*can\s*(?:i|you)|how\s*(?:to\s*use|do\s*i)|guide|tutorial|start|mboa\s*me|boa\s*me|bo\s*me\s*kwan|menu)\b/i;

// UNDO — correction / reversal intent
// Matches: "undo", "wrong", "cancel that", "wait no", "no wait", "mistake", "delete last",
// "that was wrong", "remove that", "i meant", Ghanaian: "ei wrong", "no no", "ahhh wait"
const UNDO_RE = /\b(undo|wrong\s*(?:entry|amount|number)?|cancel\s*(?:that|last)|remove\s*(?:that|last)|delete\s*last|retract|mistake|i\s*made\s*a\s*mistake|no\s*wait|wait\s*no|that(?:'s|\s+was|\s+is)\s*wrong|i\s*(?:meant|mean)\s*\d|ei\s*wrong|ahh?\s*wait|no\s*no\s*no?)\b/i;

// SMALLTALK — greetings and noise
const GREETING_RE  = /^(hi|hello|hey|good\s*(morning|afternoon|evening|night)|howdy|yo|sup|hiya|morning|evening|afternoon|ghana|maakye|ete\s*sen|wo\s*ho\s*te\s*s[εe]n|mema\s*wo\s*akye|akwaaba|salaam|salam)\b/i;
const AFFIRM_RE    = /^(ok|okay|yes|yep|sure|noted|thanks?|thank\s*you|alright|got\s*it|understood|cool|nice|great|done|k|👍|🙏|😊|✅|no|nope|nah)$/i;
const EMOJI_ONLY_RE = /^[\p{Emoji}\s]+$/u;

// LEDGER_QUERY_ENGINE — structured query patterns (undo removed — now its own intent)
const QUERY_PATTERNS: Array<{ re: RegExp; sub: QuerySubIntent }> = [
  { re: /\b(referral|refer|my\s*link|my\s*earnings?|earn(ings?)?|refer\s*&?\s*earn|cashout|cash\s*out|withdraw\s*referral)\b/i, sub: "referral_status" },
  { re: /\b(full\s*dashboard|all.?time|entire|complete\s*report|all\s*report|analytics|overview\s*all)\b/i,                     sub: "full_dashboard" },
  { re: /\b(month(?:ly)?(?:\s*report)?|this\s*month|monthly\s*(?:summary|review|breakdown))\b/i,                                                  sub: "monthly_report" },
  { re: /\b(week(?:ly)?(?:\s*report)?|this\s*week|weekly\s*(?:summary|review|breakdown)|dis\s*week)\b/i,                                          sub: "weekly_report" },
  { re: /\b(who\s*ow|owe\s*me|debts?|credit\s*list|my\s*debtors?|people\s*ow|ka\s*ho|me\s*nipa)\b/i,                                            sub: "debt_list" },
  { re: /\b(loans?|borrow(?:ings?)?|lending|my\s*loans?|i\s*owe|what\s*i\s*owe|me\s*ka)\b/i,                                                    sub: "loan_list" },
  { re: /\b(stock|inventory|goods|items|products|how\s*many|product\s*list|my\s*goods|nne[εe]ma|shelf)\b/i,                                      sub: "stock_level" },
  { re: /\b(balance|bal|summary|summ|report|today|how\s*much|profit|earn(?:ings)?|daily|overview|status|eod|end\s*of\s*day|sika|hwε\s*me|how\s*i\s*stand|how\s*e\s*dey|wetin\s*i\s*get|my\s*(?:cash|money)|tell\s*me)\b/i, sub: "summary" },
];

// ─── Entity extraction helpers ────────────────────────────────────────────────

/**
 * Extract entities from a ledger-classified message using the parser output.
 */
function ledgerEntities(text: string): ClassifiedEntities {
  const parsed = parseTransaction(text);
  // Map transaction types to flow directions
  const IN_TYPES  = new Set(["sale", "income", "received", "debt_payment", "loan_repaid", "refund_received"]);
  const OUT_TYPES = new Set(["expense", "salary", "withdrawal", "investment", "loan_given", "refund_given"]);
  const DEBT_IN   = new Set(["debt_record"]);
  const DEBT_OUT  = new Set(["borrow"]);

  let direction: ClassifiedEntities["direction"] = null;
  if (IN_TYPES.has(parsed.type))   direction = "in";
  if (OUT_TYPES.has(parsed.type))  direction = "out";
  if (DEBT_IN.has(parsed.type))    direction = "debt_in";
  if (DEBT_OUT.has(parsed.type))   direction = "debt_out";

  // Attempt to extract the verb from the raw text as the "action"
  const actionMatch = text.match(
    /\b(sold|sell|bought|buy|paid|pay|owes?|gave|give|received|receive|collected|collect|withdrew|withdraw|invested|invest|stocked|stock|repaid|repay|lent|lend|transferred|transfer|refunded|refund|returned|return)\b/i
  );

  return {
    person:    parsed.customerName,
    amount:    parsed.amount > 0 ? parsed.amount : null,
    asset:     parsed.productName,
    action:    actionMatch ? actionMatch[1].toLowerCase() : null,
    direction,
    plan:      null,
    annual:    false,
  };
}

/**
 * Extract subscription plan and annual flag from payment claim or upgrade text.
 */
function subscriptionEntities(text: string): Partial<ClassifiedEntities> {
  const planMatch  = text.match(/\b(growth|pro|enterprise)\b/i);
  const annualFlag = /\bannual\b/i.test(text);
  return {
    person: null, amount: null, asset: null, action: null, direction: null,
    plan:   planMatch ? planMatch[1].toLowerCase() : null,
    annual: annualFlag,
  };
}

const EMPTY_ENTITIES: ClassifiedEntities = {
  person: null, amount: null, asset: null, action: null,
  direction: null, plan: null, annual: false,
};

// ─── Context-aware continuity helpers ────────────────────────────────────────

/**
 * True when the session is actively in a ledger flow AND the message does not
 * contain explicit signals for another engine. Used to keep "Ama paid 20"
 * classified as LEDGER_ENGINE even if it superficially contains the word "paid"
 * (which is also in the subscription-claim pattern).
 */
function isInLedgerFlow(ctx: ConversationContext | null): boolean {
  return ctx?.activeFlow === "ledger";
}

/**
 * True when subscription UI was shown less than 24 hours ago.
 */
function isSubscriptionSuppressed(ctx: ConversationContext | null): boolean {
  if (!ctx?.subscriptionUiShownAt) return false;
  const shownMs = new Date(ctx.subscriptionUiShownAt).getTime();
  return Date.now() - shownMs < 24 * 60 * 60 * 1000;
}

// ─── Transaction type → LedgerSubIntent map ───────────────────────────────────

const TX_TYPE_TO_SUB: Partial<Record<string, LedgerSubIntent>> = {
  sale:           "sale",
  expense:        "expense",
  debt_record:    "debt_record",
  debt_payment:   "debt_payment",
  loan_given:     "loan_given",
  loan_repaid:    "loan_repaid",
  stock_update:   "stock_update",
  refund_given:   "refund",
  refund_received:"refund",
  salary:         "salary",
  investment:     "investment",
  withdrawal:     "withdrawal",
  borrow:         "loan_given",
  income:         "sale",
  received:       "debt_payment",
};

// ─── Main classifier ──────────────────────────────────────────────────────────

/**
 * Classify a raw chat message into a structured ClassifiedIntent.
 *
 * @param rawText - The raw message text from the user
 * @param context - Persisted conversation context from the session (null on first message)
 */
export function classifyMessage(
  rawText: string,
  context: ConversationContext | null,
): ClassifiedIntent {
  const text     = rawText.trim();
  const textLow  = text.toLowerCase();
  const suppressed = isSubscriptionSuppressed(context);

  // ── Helper: build a complete ClassifiedIntent ─────────────────────────────
  function make(
    intent:      IntentType,
    confidence:  number,
    sub_intent:  SubIntent | null,
    entities:    ClassifiedEntities,
    active_flow: ConversationState["active_flow"],
    requires_action = true,
    trigger_ui = false,
  ): ClassifiedIntent {
    return {
      intent,
      confidence,
      sub_intent,
      entities,
      state: {
        active_flow,
        should_trigger_ui: trigger_ui,
        subscription_ui_suppressed: suppressed,
      },
      requires_action,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PRIORITY 1 — AUTH_ENGINE
  // Lock/logout commands and PIN entry are ALWAYS handled first.
  // Auth cannot be intercepted by any other engine.
  // ─────────────────────────────────────────────────────────────────────────

  if (AUTH_LOCK_RE.test(text)) {
    return make("AUTH_ENGINE", 1.0, "lock", EMPTY_ENTITIES, "auth");
  }

  if (AUTH_PIN_RE.test(text)) {
    return make("AUTH_ENGINE", 0.99, "pin_entry", EMPTY_ENTITIES, "auth");
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PRIORITY 2 — UNDO intent
  // Correction signals take priority over everything except auth.
  // If the user says "wrong" / "undo" / "cancel that" — they need to fix a
  // record. Never let this fall through to the ledger or query engine.
  // ─────────────────────────────────────────────────────────────────────────

  if (UNDO_RE.test(textLow)) {
    return make("UNDO", 0.92, "undo", EMPTY_ENTITIES, context?.activeFlow ?? "none", true, false);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PRIORITY 3 — SUBSCRIPTION_ENGINE: explicit payment claim
  // "paid growth" / "paid pro annual" — these are payment confirmations, not
  // transactions. Checked before LEDGER_ENGINE because they contain "paid".
  // ─────────────────────────────────────────────────────────────────────────

  const claimMatch = text.match(PAYMENT_CLAIM_RE);
  if (claimMatch) {
    return make(
      "SUBSCRIPTION_ENGINE", 0.97, "payment_claim",
      { ...EMPTY_ENTITIES, plan: claimMatch[1].toLowerCase(), annual: /annual/i.test(text) },
      "subscription", true, false,
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PRIORITY 3 — LEDGER_ENGINE (financial recording)
  // Run the transaction parser. If confidence ≥ threshold and amount > 0,
  // this IS a financial entry regardless of context.
  // ─────────────────────────────────────────────────────────────────────────

  const parsed = parseTransaction(text);

  if (parsed.amount > 0 && parsed.confidence >= LEDGER_CONFIDENCE_THRESHOLD) {
    const entities = ledgerEntities(text);
    const sub      = (TX_TYPE_TO_SUB[parsed.type] ?? "sale") as LedgerSubIntent;
    return make("LEDGER_ENGINE", parsed.confidence, sub, entities, "ledger");
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PRIORITY 4 — LEDGER_QUERY_ENGINE (read/report intents)
  // ─────────────────────────────────────────────────────────────────────────

  for (const { re, sub } of QUERY_PATTERNS) {
    if (re.test(textLow)) {
      return make("LEDGER_QUERY_ENGINE", 0.92, sub, EMPTY_ENTITIES, "query");
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PRIORITY 5 — SUBSCRIPTION_ENGINE: upgrade request / pricing query
  // ANTI-BUG RULE 1: suppressed during active ledger flow.
  // ─────────────────────────────────────────────────────────────────────────

  if (SUBSCRIBE_RE.test(textLow)) {
    if (isInLedgerFlow(context)) {
      // Do NOT interrupt ledger flow — reclassify as ERROR/ambiguous so the
      // handler can emit a gentle "finish your entry first" response instead
      // of showing pricing in the middle of a business recording session.
      return make(
        "ERROR", 0.60, "ambiguous",
        EMPTY_ENTITIES, context?.activeFlow ?? "none", false,
      );
    }
    return make(
      "SUBSCRIPTION_ENGINE", 0.93, "upgrade_request",
      { ...EMPTY_ENTITIES, ...subscriptionEntities(text) },
      "subscription", true, true,
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PRIORITY 6 — HELP_ENGINE
  // ─────────────────────────────────────────────────────────────────────────

  if (HELP_RE.test(textLow)) {
    return make("HELP_ENGINE", 0.95, "commands_list", EMPTY_ENTITIES, "none", true, false);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PRIORITY 7 — SMALLTALK
  // ─────────────────────────────────────────────────────────────────────────

  if (GREETING_RE.test(text)) {
    return make("SMALLTALK", 0.90, "greeting", EMPTY_ENTITIES, "none", false, false);
  }

  if (EMOJI_ONLY_RE.test(text) && text.length <= 10) {
    return make("SMALLTALK", 0.88, "emoji_only", EMPTY_ENTITIES, "none", false, false);
  }

  if (AFFIRM_RE.test(text)) {
    // Context-sensitive: if in ledger flow "ok" / "yes" may be a confirmation
    if (isInLedgerFlow(context)) {
      return make("LEDGER_ENGINE", 0.55, "sale", {
        ...EMPTY_ENTITIES,
        person: context?.lastPerson ?? null,
        amount: context?.lastAmount ?? null,
        asset:  context?.lastAsset  ?? null,
      }, "ledger");
    }
    return make("SMALLTALK", 0.80, "affirmation", EMPTY_ENTITIES, "none", false, false);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PRIORITY 8 — Context-aware continuity
  // Short messages that didn't match above may be continuations of an active flow.
  // Example: user is recording a debt; next message is just "20" — amount continuation.
  // ─────────────────────────────────────────────────────────────────────────

  if (context && context.activeFlow !== "none") {
    const numericOnly = /^\d+(\.\d+)?$/.test(text);
    if (numericOnly && context.activeFlow === "ledger") {
      // Bare number during ledger flow → likely an amount continuation
      return make(
        "LEDGER_ENGINE", 0.65, context.lastTransactionSubIntent ?? "sale",
        {
          ...EMPTY_ENTITIES,
          amount: parseFloat(text),
          person: context.lastPerson ?? null,
          asset:  context.lastAsset  ?? null,
        },
        "ledger",
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PRIORITY 8 — ERROR / AMBIGUOUS
  // Could not confidently classify — ask for clarification.
  // NEVER default to subscription.
  // ─────────────────────────────────────────────────────────────────────────

  // If the parser found something but below confidence threshold — partial ledger
  if (parsed.amount > 0 && parsed.confidence > 0) {
    return make(
      "LEDGER_ENGINE", parsed.confidence, "sale",
      ledgerEntities(text), "ledger", true,
    );
  }

  return make(
    "ERROR", 0.50, "ambiguous",
    EMPTY_ENTITIES,
    context?.activeFlow ?? "none",
    false,
  );
}

// ─── Utility: serialisable JSON (for API responses / audit logs) ──────────────

/**
 * Returns the ClassifiedIntent as a plain JSON-safe object matching the
 * exact output schema specified in the system prompt.
 */
export function toJson(ci: ClassifiedIntent): Record<string, unknown> {
  return {
    intent:      ci.intent,
    confidence:  parseFloat(ci.confidence.toFixed(2)),
    sub_intent:  ci.sub_intent,
    entities: {
      person:    ci.entities.person,
      amount:    ci.entities.amount,
      asset:     ci.entities.asset,
      action:    ci.entities.action,
      direction: ci.entities.direction,
      ...(ci.entities.plan   !== null ? { plan:   ci.entities.plan   } : {}),
      ...(ci.entities.annual         ? { annual: ci.entities.annual } : {}),
    },
    state: {
      active_flow:                ci.state.active_flow,
      should_trigger_ui:          ci.state.should_trigger_ui,
      subscription_ui_suppressed: ci.state.subscription_ui_suppressed,
    },
    requires_action: ci.requires_action,
  };
}
