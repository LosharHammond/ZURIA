/**
 * Engine Isolation Guard — anti-bug rule enforcer.
 *
 * Runs AFTER classifyMessage() and BEFORE dispatching to any engine.
 * Enforces the 5 non-negotiable engine isolation rules:
 *
 *  RULE 1 — NO SUBSCRIPTION INTERRUPTS during ledger flow
 *  RULE 2 — NO FALSE INTENT SWITCHING ("Ama paid 20" is always LEDGER_ENGINE)
 *  RULE 3 — NO UI SPAM LOOP (24h subscription UI suppression)
 *  RULE 4 — FINANCIAL ACCURACY IS PRIORITY (never lose amount/person/direction)
 *  RULE 5 — DOUBLE MESSAGE HANDLING (idempotency — do NOT log duplicate)
 *
 * Returns an IsolationCheckResult describing whether the intent was blocked
 * and what override was applied.
 *
 * Runtime-agnostic: no firebase imports.
 */

import type {
  ClassifiedIntent,
  ConversationContext,
  IsolationCheckResult,
} from "./types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function blocked(rule: string, override: ClassifiedIntent): IsolationCheckResult {
  return { blocked: true, override, violationRule: rule };
}

function pass(): IsolationCheckResult {
  return { blocked: false, override: null, violationRule: null };
}

function cloneWith(
  ci: ClassifiedIntent,
  patch: Partial<ClassifiedIntent>,
): ClassifiedIntent {
  return { ...ci, ...patch, state: { ...ci.state, ...(patch.state ?? {}) } };
}

// ─── Guard ────────────────────────────────────────────────────────────────────

/**
 * Check whether the classified intent violates an engine isolation rule.
 *
 * @param intent  - Output of classifyMessage()
 * @param context - Current conversation context
 * @param lastRawText - The previous message (for duplicate detection)
 * @param currentRawText - The current message
 */
export function enforceEngineIsolation(
  intent: ClassifiedIntent,
  context: ConversationContext | null,
  lastRawText: string | null,
  currentRawText: string,
): IsolationCheckResult {

  // ── RULE 1 — NO SUBSCRIPTION INTERRUPTS ──────────────────────────────────
  // If active_flow is "ledger" and the classifier emitted SUBSCRIPTION_ENGINE,
  // we already reclassified to ERROR in the classifier. But as a second safety
  // layer: if something slipped through, convert it to ERROR here.
  if (
    intent.intent === "SUBSCRIPTION_ENGINE" &&
    intent.sub_intent !== "payment_claim" && // payment claims always allowed
    context?.activeFlow === "ledger"
  ) {
    return blocked(
      "RULE_1_NO_SUBSCRIPTION_INTERRUPT",
      cloneWith(intent, {
        intent:     "ERROR",
        confidence: 0.60,
        sub_intent: "ambiguous",
        state: { ...intent.state, active_flow: "ledger", should_trigger_ui: false },
        requires_action: false,
      }),
    );
  }

  // ── RULE 2 — NO FALSE INTENT SWITCHING ───────────────────────────────────
  // "Ama paid 20" contains "paid" which could superficially match subscription
  // keywords ("paid growth"). Ensure a message with amount > 0 that was
  // classified as SUBSCRIPTION_ENGINE (non-claim) gets rerouted to LEDGER_ENGINE.
  if (
    intent.intent === "SUBSCRIPTION_ENGINE" &&
    intent.sub_intent !== "payment_claim" &&
    intent.entities.amount !== null &&
    intent.entities.amount > 0
  ) {
    // Derive the most accurate ledger sub_intent from the action verb extracted
    // by the classifier. Defaulting to "expense" was a semantic mismatch: "Ama paid 20"
    // (action="paid", direction="in") should be "debt_payment", not "expense".
    type LedgerSub = import("./types").LedgerSubIntent;
    const actionToSub: Record<string, LedgerSub> = {
      paid:       "debt_payment",
      pay:        "debt_payment",
      received:   "debt_payment",
      receive:    "debt_payment",
      collected:  "debt_payment",
      collect:    "debt_payment",
      sold:       "sale",
      sell:       "sale",
      bought:     "expense",
      buy:        "expense",
      spent:      "expense",
      spend:      "expense",
      gave:       "loan_given",
      give:       "loan_given",
      lent:       "loan_given",
      lend:       "loan_given",
      repaid:     "loan_repaid",
      repay:      "loan_repaid",
      withdrew:   "withdrawal",
      withdraw:   "withdrawal",
      invested:   "investment",
      invest:     "investment",
      salary:     "salary",
    };
    const inferredSub: LedgerSub =
      (intent.entities.action ? actionToSub[intent.entities.action] : undefined)
      ?? (intent.entities.direction === "in" ? "debt_payment" : "expense");

    return blocked(
      "RULE_2_NO_FALSE_INTENT_SWITCH",
      cloneWith(intent, {
        intent:     "LEDGER_ENGINE",
        confidence: 0.85,
        sub_intent: inferredSub,
        state: { ...intent.state, active_flow: "ledger", should_trigger_ui: false },
        requires_action: true,
      }),
    );
  }

  // ── RULE 3 — NO UI SPAM LOOP ──────────────────────────────────────────────
  // If subscription UI was shown < 24h ago AND the user did NOT explicitly
  // request subscription info (sub_intent ≠ upgrade_request or pricing_query),
  // suppress the should_trigger_ui flag so the handler shows a minimal response.
  if (
    intent.intent === "SUBSCRIPTION_ENGINE" &&
    intent.state.subscription_ui_suppressed &&
    intent.sub_intent !== "upgrade_request" &&
    intent.sub_intent !== "pricing_query" &&
    intent.sub_intent !== "payment_claim"
  ) {
    return blocked(
      "RULE_3_NO_UI_SPAM",
      cloneWith(intent, {
        state: { ...intent.state, should_trigger_ui: false },
      }),
    );
  }

  // ── RULE 4 — FINANCIAL ACCURACY PRIORITY ─────────────────────────────────
  // If the message was classified as LEDGER_ENGINE but has no amount AND no
  // context carry-forward to fill it, downgrade to ERROR/ambiguous rather than
  // letting the engine record a GHS 0.00 entry.
  if (
    intent.intent === "LEDGER_ENGINE" &&
    intent.entities.amount === null &&
    context?.lastAmount === null &&
    intent.sub_intent !== "stock_update" // stock updates may have no amount
  ) {
    return blocked(
      "RULE_4_FINANCIAL_ACCURACY",
      cloneWith(intent, {
        intent:     "ERROR",
        confidence: 0.55,
        sub_intent: "incomplete",
        requires_action: false,
      }),
    );
  }

  // ── RULE 5 — DOUBLE MESSAGE HANDLING ─────────────────────────────────────
  // Detects duplicate webhook deliveries (WhatsApp retries on network failure).
  // Compares the current normalized text against the last stored normalized text
  // from context — this works even across serverless function restarts, unlike
  // the old approach that passed lastRawText as null.
  //
  // Condition: same normalized text + last intent was LEDGER_ENGINE + last
  // transaction was recorded within the last 30 seconds (prevents blocking
  // intentional re-entry of the same amount, e.g., two sales of the same item).
  const lastNorm = context?.lastNormalizedText ?? null;
  const recentMs = 30_000; // 30 seconds
  const lastUpdatedRecently = context?.updatedAt
    ? Date.now() - new Date(context.updatedAt).getTime() < recentMs
    : false;

  if (
    intent.intent === "LEDGER_ENGINE" &&
    lastNorm !== null &&
    lastNorm.trim().toLowerCase() === currentRawText.trim().toLowerCase() &&
    context?.lastIntent === "LEDGER_ENGINE" &&
    lastUpdatedRecently
  ) {
    // We do NOT block — just attach a dedup flag so the handler skips the write
    // while still returning a normal confirmation (WhatsApp delivery guarantee).
    return {
      blocked: false,
      override: cloneWith(intent, {
        // Confidence set to 0.0 signals the handler to treat as idempotent
        confidence: 0.0,
      }),
      violationRule: "RULE_5_DUPLICATE_SUPPRESSED",
    };
  }

  void lastRawText; // Parameter kept for API compatibility; logic now uses context

  return pass();
}

// ─── Duplicate detection helper ───────────────────────────────────────────────

/**
 * Returns true when the guard's override carries the RULE_5 dedup flag.
 * The handler uses this to skip the Firestore write while still sending
 * a normal confirmation response.
 */
export function isDuplicateLedgerEntry(result: IsolationCheckResult): boolean {
  return result.violationRule === "RULE_5_DUPLICATE_SUPPRESSED";
}
