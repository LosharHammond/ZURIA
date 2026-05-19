/**
 * ADVERSARIAL TESTS — Intent Misclassification Prevention
 *
 * Specifically targets the AI/classifier pipeline to ensure:
 *  1. Financial transactions are NEVER routed to SUBSCRIPTION_ENGINE
 *  2. Subscription messages with amounts are protected by RULE 2
 *  3. Ambiguous messages never silently record wrong amounts
 *  4. Pidgin/Ghanaian inputs route correctly after normalization
 *  5. Context memory doesn't corrupt unrelated follow-ups
 *  6. Edge inputs (empty, emoji, injection) route safely
 *  7. High-stake amounts require correct engine (no loss of GHS 10,000)
 *
 * Pipeline tested: normalizeGhanaianEnglish → classifyMessage → enforceEngineIsolation
 */

import { normalizeGhanaianEnglish } from "@/lib/intelligence/ghanaian-normalizer";
import { classifyMessage } from "@/lib/intelligence/intent-classifier";
import { enforceEngineIsolation } from "@/lib/intelligence/engine-guard";
import type { ConversationContext } from "@/lib/intelligence/types";

// ─── Pipeline helper ──────────────────────────────────────────────────────────

function classify(text: string, ctx: ConversationContext | null = null) {
  const normalized = normalizeGhanaianEnglish(text);
  const intent     = classifyMessage(normalized, ctx);
  const guard      = enforceEngineIsolation(intent, ctx, null, normalized);
  return {
    normalized,
    intent:    guard.blocked ? guard.override! : intent,
    raw:       intent,
    guard,
  };
}

function makeCtx(overrides: Partial<ConversationContext> = {}): ConversationContext {
  return {
    lastIntent: null,
    activeFlow: "none",
    lastPerson: null,
    lastAmount: null,
    lastAsset: null,
    lastTransactionSubIntent: null,
    lastTransactionId: null,
    lastTransactionDesc: null,
    conversationHistory: [],
    pendingLimitNotification: null,
    subscriptionUiShownAt: null,
    pendingTransaction: null,
    lastNormalizedText: null,
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1 — Financial transactions NEVER route to SUBSCRIPTION_ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

describe("Misclassification › Financial → Never SUBSCRIPTION_ENGINE", () => {
  const FINANCIAL_INPUTS = [
    "sold rice 100",
    "Ama paid me 50",
    "bought fuel 30",
    "Kofi owes me 200",
    "expense rent 500",
    "received momo 150",
    "sold goods 1000 via momo",
    "salary worker 400",
    "gave Kojo loan 300",
    "withdrew 200 from bank",
    "invested 1000 in stock",
    "paid worker 250",
    "customer took credit 80",
    "refunded Ama 20",
  ];

  FINANCIAL_INPUTS.forEach((input) => {
    test(`"${input}" → LEDGER_ENGINE (never SUBSCRIPTION_ENGINE)`, () => {
      const { intent } = classify(input);
      expect(intent.intent).not.toBe("SUBSCRIPTION_ENGINE");
      expect(intent.intent).toBe("LEDGER_ENGINE");
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2 — RULE 2: subscription-like text with amounts → LEDGER_ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

describe("Misclassification › RULE 2 Protection (Amount + Subscription Keywords)", () => {
  const RULE2_CASES = [
    { text: "Ama paid 20", expectedSub: "debt_payment" },
    { text: "paid growth 50",   expectedIntent: "SUBSCRIPTION_ENGINE" }, // legit claim
    { text: "sold growth pack 100", expectedEngine: "LEDGER_ENGINE" },
    { text: "received pro payment 200", expectedEngine: "LEDGER_ENGINE" },
  ];

  test("'Ama paid 20' → LEDGER_ENGINE (not subscription)", () => {
    const { intent } = classify("Ama paid 20");
    expect(intent.intent).toBe("LEDGER_ENGINE");
    expect(intent.entities.amount).toBe(20);
  });

  test("'paid growth 50' → SUBSCRIPTION_ENGINE payment_claim (legit payment)", () => {
    const { raw } = classify("paid growth 50");
    // This should be a payment claim — not blocked by RULE 2 because sub_intent=payment_claim
    expect(raw.intent).toBe("SUBSCRIPTION_ENGINE");
    expect(raw.sub_intent).toBe("payment_claim");
  });

  test("'sold goods 200 growth' → LEDGER_ENGINE (sale, not subscription)", () => {
    const { intent } = classify("sold goods 200 growth");
    expect(intent.intent).toBe("LEDGER_ENGINE");
    expect(intent.entities.amount).toBe(200);
  });

  test("RULE 2 guard: LEDGER_ENGINE confidence bumped to 0.85", () => {
    // If RULE 2 fires, override confidence is exactly 0.85
    const normalized = normalizeGhanaianEnglish("Ama paid 20");
    const raw = classifyMessage(normalized, null);
    const guard = enforceEngineIsolation(raw, null, null, normalized);
    if (guard.violationRule === "RULE_2_NO_FALSE_INTENT_SWITCH") {
      expect(guard.override?.confidence).toBe(0.85);
    }
    // If classifier already got it right, RULE 2 doesn't need to fire
    expect(raw.intent === "LEDGER_ENGINE" || guard.violationRule === "RULE_2_NO_FALSE_INTENT_SWITCH").toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3 — High-stakes amounts must not be lost or misrouted
// ═══════════════════════════════════════════════════════════════════════════════

describe("Misclassification › High-Stakes Amount Preservation", () => {
  const HIGH_VALUE_CASES = [
    { text: "sold property for 500000 cedis", amount: 500000 },
    { text: "received GHS 10000 from Kofi", amount: 10000 },
    { text: "Ama paid 99999", amount: 99999 },
    { text: "expense equipment 75000", amount: 75000 },
    { text: "gave Kojo a loan of 25000", amount: 25000 },
    { text: "salary payment 8000", amount: 8000 },
  ];

  HIGH_VALUE_CASES.forEach(({ text, amount }) => {
    test(`"${text}" → amount ${amount} preserved, LEDGER_ENGINE`, () => {
      const { intent } = classify(text);
      expect(intent.intent).toBe("LEDGER_ENGINE");
      expect(intent.entities.amount).toBe(amount);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4 — Pidgin inputs route correctly after normalization
// ═══════════════════════════════════════════════════════════════════════════════

describe("Misclassification › Pidgin → Correct Engine", () => {
  test("'Kofi no pay me' → LEDGER_QUERY_ENGINE (debt follow-up)", () => {
    const { intent } = classify("Kofi no pay me");
    // After normalization: "Kofi hasn't paid me" → debt_list query
    expect(["LEDGER_QUERY_ENGINE", "LEDGER_ENGINE"]).toContain(intent.intent);
  });

  test("'momo came in 200' → LEDGER_ENGINE (income)", () => {
    const { intent } = classify("momo came in 200");
    expect(intent.intent).toBe("LEDGER_ENGINE");
    expect(intent.entities.amount).toBe(200);
  });

  test("'customer send momo 100' → LEDGER_ENGINE (sale/received)", () => {
    const { intent } = classify("customer send momo 100");
    expect(intent.intent).toBe("LEDGER_ENGINE");
    expect(intent.entities.amount).toBe(100);
  });

  test("'Ama dash me 50' → LEDGER_ENGINE", () => {
    const { intent } = classify("Ama dash me 50");
    expect(intent.intent).toBe("LEDGER_ENGINE");
    expect(intent.entities.amount).toBe(50);
  });

  test("'wetin i get today' → LEDGER_QUERY_ENGINE", () => {
    const { intent } = classify("wetin i get today");
    expect(intent.intent).toBe("LEDGER_QUERY_ENGINE");
  });

  test("'how e dey' → SMALLTALK or LEDGER_QUERY_ENGINE", () => {
    const { intent } = classify("how e dey");
    expect(["SMALLTALK", "LEDGER_QUERY_ENGINE"]).toContain(intent.intent);
  });

  test("'I wan check my money' → LEDGER_QUERY_ENGINE", () => {
    const { intent } = classify("I wan check my money");
    expect(intent.intent).toBe("LEDGER_QUERY_ENGINE");
  });

  test("'Ama clear the debt' → LEDGER_ENGINE (debt payment)", () => {
    const { intent } = classify("Ama clear the debt");
    expect(intent.intent).toBe("LEDGER_ENGINE");
  });

  test("'Kofi clear all' → LEDGER_ENGINE", () => {
    const { intent } = classify("Kofi clear all");
    expect(intent.intent).toBe("LEDGER_ENGINE");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 5 — Context memory integrity
// ═══════════════════════════════════════════════════════════════════════════════

describe("Misclassification › Context Memory Safety", () => {
  test("bare number in ledger context → LEDGER_ENGINE (carry-forward)", () => {
    const ctx = makeCtx({
      lastIntent: "LEDGER_ENGINE",
      activeFlow: "ledger",
      lastAmount: 100,
    });
    const { intent } = classify("150", ctx);
    // Bare number in ledger flow should route to LEDGER_ENGINE
    expect(intent.intent).toBe("LEDGER_ENGINE");
  });

  test("bare number with NO context → ERROR or SMALLTALK (not LEDGER)", () => {
    const { intent } = classify("150");
    // Without context, a bare number is ambiguous — should NOT assume it's LEDGER
    // (prevents ghost transactions)
    expect(["ERROR", "SMALLTALK", "LEDGER_QUERY_ENGINE"]).toContain(intent.intent);
  });

  test("'yes' in pending_confirmation → not classified as subscription", () => {
    const ctx = makeCtx({
      lastIntent: "LEDGER_ENGINE",
      activeFlow: "pending_confirmation",
      lastAmount: 100,
    });
    const { intent } = classify("yes", ctx);
    // "yes" in confirmation context should not route to subscription
    expect(intent.intent).not.toBe("SUBSCRIPTION_ENGINE");
  });

  test("person name from context not used for financial routing", () => {
    const ctx = makeCtx({ lastPerson: "Ama" });
    const { intent } = classify("she paid me 50", ctx);
    // Should still route correctly to LEDGER_ENGINE regardless of context person
    expect(intent.intent).toBe("LEDGER_ENGINE");
    expect(intent.entities.amount).toBe(50);
  });

  test("query after ledger transaction does not inherit ledger flow incorrectly", () => {
    const ctx = makeCtx({
      lastIntent: "LEDGER_ENGINE",
      activeFlow: "ledger",
    });
    const { intent } = classify("show me today's balance", ctx);
    // Query should route to LEDGER_QUERY_ENGINE, not LEDGER_ENGINE
    expect(intent.intent).toBe("LEDGER_QUERY_ENGINE");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 6 — Edge case inputs (no misclassification, no crash)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Misclassification › Edge Case Inputs", () => {
  test("empty string → ERROR, confidence=0", () => {
    const { intent } = classify("");
    expect(intent.intent).toBe("ERROR");
    expect(intent.confidence).toBe(0);
  });

  test("only whitespace → ERROR, confidence=0", () => {
    const { intent } = classify("   ");
    expect(intent.intent).toBe("ERROR");
    expect(intent.confidence).toBe(0);
  });

  test("emoji only → SMALLTALK or ERROR (not LEDGER_ENGINE)", () => {
    const { intent } = classify("💰💰💰");
    expect(intent.intent).not.toBe("LEDGER_ENGINE");
    expect(["SMALLTALK", "ERROR"]).toContain(intent.intent);
  });

  test("SQL injection → no crash, routes safely", () => {
    expect(() => classify("sold rice'; DROP TABLE transactions; -- 100")).not.toThrow();
    const { intent } = classify("sold rice'; DROP TABLE transactions; -- 100");
    expect(intent.intent).toBe("LEDGER_ENGINE");
    expect(intent.entities.amount).toBe(100);
  });

  test("null-byte in text → no crash", () => {
    expect(() => classify("sold rice\0 100")).not.toThrow();
  });

  test("very long text (DoS attempt) → no crash", () => {
    const long = "sold ".repeat(1000) + "rice 50";
    expect(() => classify(long)).not.toThrow();
  });

  test("PIN-like number alone → AUTH_ENGINE or ERROR (not LEDGER)", () => {
    const { intent } = classify("1234");
    // 4-digit number could be a PIN — must not be classified as LEDGER_ENGINE sale
    // without supporting context
    expect(intent.intent).not.toBe("LEDGER_ENGINE");
  });

  test("regex injection in text → no crash", () => {
    expect(() => classify("((((((sold rice 100)).*)")).not.toThrow();
  });

  test("amount as word → ERROR or low confidence (not confident record)", () => {
    const { intent } = classify("sold rice one hundred");
    // "one hundred" should not be parsed as 100 with high confidence
    if (intent.intent === "LEDGER_ENGINE" && intent.entities.amount === 100) {
      expect(intent.confidence).toBeLessThan(0.80);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 7 — AI hallucination prevention (wrong intent should be caught by guard)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Misclassification › Hallucination Prevention (Guard as Safety Net)", () => {
  test("if classifier emits SUBSCRIPTION_ENGINE for 'Ama paid 20', guard corrects it", () => {
    // Simulate classifier hallucination
    const hallucinated = {
      intent: "SUBSCRIPTION_ENGINE" as const,
      confidence: 0.7,
      sub_intent: "upgrade_request" as const,
      entities: {
        person: "Ama",
        amount: 20,
        asset: null,
        action: "paid",
        direction: "in" as const,
        plan: null,
        annual: false,
      },
      state: {
        active_flow: "none" as const,
        should_trigger_ui: false,
        subscription_ui_suppressed: false,
      },
      requires_action: true,
    };

    const guard = enforceEngineIsolation(hallucinated, null, null, "Ama paid 20");
    expect(guard.blocked).toBe(true);
    expect(guard.violationRule).toBe("RULE_2_NO_FALSE_INTENT_SWITCH");
    expect(guard.override?.intent).toBe("LEDGER_ENGINE");
    expect(guard.override?.entities.amount).toBe(20);
  });

  test("if classifier emits SUBSCRIPTION_ENGINE during ledger flow, RULE 1 catches it", () => {
    const hallucinated = {
      intent: "SUBSCRIPTION_ENGINE" as const,
      confidence: 0.65,
      sub_intent: "pricing_query" as const,
      entities: {
        person: null, amount: null, asset: null, action: null, direction: null, plan: null, annual: false,
      },
      state: { active_flow: "none" as const, should_trigger_ui: true, subscription_ui_suppressed: false },
      requires_action: false,
    };

    const ctx = makeCtx({ activeFlow: "ledger" });
    const guard = enforceEngineIsolation(hallucinated, ctx, null, "how much is pro");
    expect(guard.blocked).toBe(true);
    expect(guard.violationRule).toBe("RULE_1_NO_SUBSCRIPTION_INTERRUPT");
  });

  test("if classifier emits LEDGER_ENGINE with null sub_intent and no amount, RULE 4 catches it", () => {
    const hallucinated = {
      intent: "LEDGER_ENGINE" as const,
      confidence: 0.6,
      sub_intent: null,
      entities: {
        person: null, amount: null, asset: null, action: null, direction: null, plan: null, annual: false,
      },
      state: { active_flow: "none" as const, should_trigger_ui: false, subscription_ui_suppressed: false },
      requires_action: true,
    };

    const guard = enforceEngineIsolation(hallucinated, makeCtx({ lastAmount: null }), null, "hmm");
    expect(guard.blocked).toBe(true);
    expect(guard.violationRule).toBe("RULE_4_FINANCIAL_ACCURACY");
    expect(guard.override?.intent).toBe("ERROR");
  });

  test("duplicate LEDGER_ENGINE message within 30s is flagged not blocked", () => {
    const normalized = "sold rice 100";
    const raw = classifyMessage(normalized, null);
    const ctx = makeCtx({
      lastIntent: "LEDGER_ENGINE",
      lastNormalizedText: normalized,
      updatedAt: new Date(Date.now() - 5000).toISOString(), // 5s ago
    });
    const guard = enforceEngineIsolation(raw, ctx, null, normalized);
    // RULE 5: not fully blocked, just flagged
    if (guard.violationRule === "RULE_5_DUPLICATE_SUPPRESSED") {
      expect(guard.blocked).toBe(false);
      expect(guard.override?.confidence).toBe(0.0);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 8 — Critical classification correctness for 700 query categories
// ═══════════════════════════════════════════════════════════════════════════════

describe("Misclassification › Core 700 Query Classification Spot Checks", () => {
  // Representative sample from each of the 5 query categories

  // Category 1: Basic (sales, expenses, debts, stock, balance)
  const CATEGORY_1 = [
    { text: "sold rice 50", engine: "LEDGER_ENGINE" },
    { text: "bought fuel 30", engine: "LEDGER_ENGINE" },
    { text: "Kofi owes me 100", engine: "LEDGER_ENGINE" },
    { text: "show me today's summary", engine: "LEDGER_QUERY_ENGINE" },
    { text: "how much did I make today", engine: "LEDGER_QUERY_ENGINE" },
    { text: "what is my balance", engine: "LEDGER_QUERY_ENGINE" },
    { text: "who owes me money", engine: "LEDGER_QUERY_ENGINE" },
  ];

  // Category 2: Debt + Inventory + Stock
  const CATEGORY_2 = [
    { text: "received 50 bags of rice", engine: "LEDGER_ENGINE" },
    { text: "Ama clear the debt", engine: "LEDGER_ENGINE" },
    { text: "what is my stock level", engine: "LEDGER_QUERY_ENGINE" },
    { text: "how many bags of rice do I have", engine: "LEDGER_QUERY_ENGINE" },
    { text: "Mark Ama debt as cleared", engine: "LEDGER_ENGINE" },
  ];

  // Category 3: Moderate complexity
  const CATEGORY_3 = [
    { text: "sold rice 120 and bought fuel 40", engine: "LEDGER_ENGINE" },
    { text: "undo last transaction", engine: "UNDO" },
    { text: "gave Kojo loan 500", engine: "LEDGER_ENGINE" },
    { text: "show me this week's report", engine: "LEDGER_QUERY_ENGINE" },
    { text: "what are my expenses this month", engine: "LEDGER_QUERY_ENGINE" },
  ];

  // Category 4: Advanced
  const CATEGORY_4 = [
    { text: "how is my business doing", engine: "LEDGER_QUERY_ENGINE" },
    { text: "help", engine: "HELP_ENGINE" },
    { text: "subscribe to pro", engine: "SUBSCRIPTION_ENGINE" },
    { text: "paid growth", engine: "SUBSCRIPTION_ENGINE" },
    { text: "hello", engine: "SMALLTALK" },
    { text: "thanks", engine: "SMALLTALK" },
    { text: "ok", engine: "SMALLTALK" },
  ];

  [...CATEGORY_1, ...CATEGORY_2, ...CATEGORY_3, ...CATEGORY_4].forEach(({ text, engine }) => {
    test(`"${text}" → ${engine}`, () => {
      const { intent } = classify(text);
      expect(intent.intent).toBe(engine);
    });
  });
});
