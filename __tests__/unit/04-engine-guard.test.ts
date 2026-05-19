/**
 * UNIT TESTS — Engine Isolation Guard
 *
 * Adversarial focus:
 *  - Every RULE fires when it should
 *  - Every RULE does NOT fire when it should not
 *  - Override intents produced by blocked rules are correct
 *  - RULE 5 dedup flag surfaces correctly without blocking
 *  - Guard is pure / side-effect-free
 */

import {
  enforceEngineIsolation,
  isDuplicateLedgerEntry,
} from "@/lib/intelligence/engine-guard";
import type {
  ClassifiedIntent,
  ConversationContext,
  ConversationState,
} from "@/lib/intelligence/types";

// ─── Factories ────────────────────────────────────────────────────────────────

function makeState(
  overrides: Partial<ConversationState> = {},
): ConversationState {
  return {
    active_flow: "none",
    should_trigger_ui: false,
    subscription_ui_suppressed: false,
    ...overrides,
  };
}

function makeIntent(overrides: Partial<ClassifiedIntent> = {}): ClassifiedIntent {
  return {
    intent: "LEDGER_ENGINE",
    confidence: 0.90,
    sub_intent: "sale",
    entities: {
      person: null,
      amount: 100,
      asset: "rice",
      action: "sold",
      direction: "in",
      plan: null,
      annual: false,
    },
    state: makeState(),
    requires_action: true,
    ...overrides,
  };
}

function makeContext(overrides: Partial<ConversationContext> = {}): ConversationContext {
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
// RULE 1 — NO SUBSCRIPTION INTERRUPTS during ledger flow
// ═══════════════════════════════════════════════════════════════════════════════

describe("Engine Guard › RULE 1 — No Subscription Interrupt", () => {
  test("SUBSCRIPTION_ENGINE during ledger flow → blocked", () => {
    const intent = makeIntent({
      intent: "SUBSCRIPTION_ENGINE",
      sub_intent: "upgrade_request",
      entities: { ...makeIntent().entities, amount: null },
    });
    const ctx = makeContext({ activeFlow: "ledger" });

    const result = enforceEngineIsolation(intent, ctx, null, "subscribe to pro");
    expect(result.blocked).toBe(true);
    expect(result.violationRule).toBe("RULE_1_NO_SUBSCRIPTION_INTERRUPT");
    expect(result.override?.intent).toBe("ERROR");
  });

  test("payment_claim during ledger flow → NOT blocked (always allowed)", () => {
    const intent = makeIntent({
      intent: "SUBSCRIPTION_ENGINE",
      sub_intent: "payment_claim",
      entities: { ...makeIntent().entities, amount: null },
    });
    const ctx = makeContext({ activeFlow: "ledger" });

    const result = enforceEngineIsolation(intent, ctx, null, "paid pro");
    expect(result.blocked).toBe(false);
    expect(result.violationRule).toBeNull();
  });

  test("SUBSCRIPTION_ENGINE with no active ledger flow → NOT blocked", () => {
    const intent = makeIntent({
      intent: "SUBSCRIPTION_ENGINE",
      sub_intent: "upgrade_request",
      entities: { ...makeIntent().entities, amount: null },
    });
    const ctx = makeContext({ activeFlow: "none" });

    const result = enforceEngineIsolation(intent, ctx, null, "subscribe");
    // RULE 1 does not apply (no ledger flow). May be blocked by RULE 3 if ui suppressed.
    expect(result.violationRule).not.toBe("RULE_1_NO_SUBSCRIPTION_INTERRUPT");
  });

  test("LEDGER_ENGINE during ledger flow → NOT blocked by RULE 1", () => {
    const intent = makeIntent({ intent: "LEDGER_ENGINE" });
    const ctx = makeContext({ activeFlow: "ledger" });

    const result = enforceEngineIsolation(intent, ctx, null, "sold rice 50");
    expect(result.violationRule).not.toBe("RULE_1_NO_SUBSCRIPTION_INTERRUPT");
  });

  test("override has should_trigger_ui = false", () => {
    const intent = makeIntent({
      intent: "SUBSCRIPTION_ENGINE",
      sub_intent: "pricing_query",
      entities: { ...makeIntent().entities, amount: null },
    });
    const ctx = makeContext({ activeFlow: "ledger" });

    const result = enforceEngineIsolation(intent, ctx, null, "how much is pro");
    expect(result.blocked).toBe(true);
    expect(result.override?.state.should_trigger_ui).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// RULE 2 — NO FALSE INTENT SWITCHING
// ═══════════════════════════════════════════════════════════════════════════════

describe("Engine Guard › RULE 2 — No False Intent Switch", () => {
  test("'Ama paid 20' classified as SUBSCRIPTION_ENGINE → rerouted to LEDGER_ENGINE", () => {
    const intent = makeIntent({
      intent: "SUBSCRIPTION_ENGINE",
      sub_intent: "upgrade_request",
      entities: {
        ...makeIntent().entities,
        amount: 20,
        person: "Ama",
        action: "paid",
        direction: "in",
      },
    });
    const ctx = makeContext();

    const result = enforceEngineIsolation(intent, ctx, null, "Ama paid 20");
    expect(result.blocked).toBe(true);
    expect(result.violationRule).toBe("RULE_2_NO_FALSE_INTENT_SWITCH");
    expect(result.override?.intent).toBe("LEDGER_ENGINE");
    expect(result.override?.sub_intent).toBe("debt_payment");
  });

  test("'sold goods 200 growth pack' → LEDGER_ENGINE sub=sale", () => {
    const intent = makeIntent({
      intent: "SUBSCRIPTION_ENGINE",
      sub_intent: "upgrade_request",
      entities: {
        ...makeIntent().entities,
        amount: 200,
        action: "sold",
        direction: "in",
      },
    });

    const result = enforceEngineIsolation(intent, makeContext(), null, "sold goods 200");
    expect(result.blocked).toBe(true);
    expect(result.override?.intent).toBe("LEDGER_ENGINE");
    expect(result.override?.sub_intent).toBe("sale");
  });

  test("'bought fuel 50 pro' → LEDGER_ENGINE sub=expense", () => {
    const intent = makeIntent({
      intent: "SUBSCRIPTION_ENGINE",
      sub_intent: "upgrade_request",
      entities: {
        ...makeIntent().entities,
        amount: 50,
        action: "bought",
        direction: "out",
      },
    });

    const result = enforceEngineIsolation(intent, makeContext(), null, "bought fuel 50");
    expect(result.blocked).toBe(true);
    expect(result.override?.sub_intent).toBe("expense");
  });

  test("payment_claim with amount → NOT blocked by RULE 2", () => {
    const intent = makeIntent({
      intent: "SUBSCRIPTION_ENGINE",
      sub_intent: "payment_claim",
      entities: { ...makeIntent().entities, amount: 50 },
    });

    const result = enforceEngineIsolation(intent, makeContext(), null, "paid 50 growth");
    expect(result.violationRule).not.toBe("RULE_2_NO_FALSE_INTENT_SWITCH");
  });

  test("SUBSCRIPTION_ENGINE with amount=0 → NOT blocked by RULE 2", () => {
    const intent = makeIntent({
      intent: "SUBSCRIPTION_ENGINE",
      sub_intent: "upgrade_request",
      entities: { ...makeIntent().entities, amount: 0 },
    });

    // amount=0 doesn't trigger RULE 2 (only amount > 0)
    const result = enforceEngineIsolation(intent, makeContext(), null, "upgrade to pro");
    expect(result.violationRule).not.toBe("RULE_2_NO_FALSE_INTENT_SWITCH");
  });

  test("RULE 2 override has confidence=0.85", () => {
    const intent = makeIntent({
      intent: "SUBSCRIPTION_ENGINE",
      sub_intent: "pricing_query",
      entities: { ...makeIntent().entities, amount: 300, action: "invested" },
    });

    const result = enforceEngineIsolation(intent, makeContext(), null, "invested 300");
    expect(result.blocked).toBe(true);
    expect(result.override?.confidence).toBe(0.85);
    expect(result.override?.sub_intent).toBe("investment");
  });

  test("RULE 2 override has active_flow = ledger", () => {
    const intent = makeIntent({
      intent: "SUBSCRIPTION_ENGINE",
      sub_intent: "upgrade_request",
      entities: { ...makeIntent().entities, amount: 200, action: "gave" },
    });

    const result = enforceEngineIsolation(intent, makeContext(), null, "gave Kofi 200");
    expect(result.blocked).toBe(true);
    expect(result.override?.state.active_flow).toBe("ledger");
    expect(result.override?.sub_intent).toBe("loan_given");
  });

  test("withdrawal action maps to correct sub_intent", () => {
    const intent = makeIntent({
      intent: "SUBSCRIPTION_ENGINE",
      sub_intent: "upgrade_request",
      entities: { ...makeIntent().entities, amount: 500, action: "withdrew" },
    });

    const result = enforceEngineIsolation(intent, makeContext(), null, "withdrew 500");
    expect(result.override?.sub_intent).toBe("withdrawal");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// RULE 3 — NO UI SPAM LOOP
// ═══════════════════════════════════════════════════════════════════════════════

describe("Engine Guard › RULE 3 — No UI Spam", () => {
  test("subscription UI suppressed + non-explicit sub_intent → should_trigger_ui=false", () => {
    const intent = makeIntent({
      intent: "SUBSCRIPTION_ENGINE",
      sub_intent: "noise" as any,
      entities: { ...makeIntent().entities, amount: null },
      state: makeState({ subscription_ui_suppressed: true, should_trigger_ui: true }),
    });

    const result = enforceEngineIsolation(intent, makeContext(), null, "ok");
    expect(result.blocked).toBe(true);
    expect(result.violationRule).toBe("RULE_3_NO_UI_SPAM");
    expect(result.override?.state.should_trigger_ui).toBe(false);
  });

  test("upgrade_request when suppressed → NOT blocked (explicit request)", () => {
    const intent = makeIntent({
      intent: "SUBSCRIPTION_ENGINE",
      sub_intent: "upgrade_request",
      entities: { ...makeIntent().entities, amount: null },
      state: makeState({ subscription_ui_suppressed: true }),
    });

    const result = enforceEngineIsolation(intent, makeContext(), null, "upgrade");
    expect(result.violationRule).not.toBe("RULE_3_NO_UI_SPAM");
  });

  test("pricing_query when suppressed → NOT blocked", () => {
    const intent = makeIntent({
      intent: "SUBSCRIPTION_ENGINE",
      sub_intent: "pricing_query",
      entities: { ...makeIntent().entities, amount: null },
      state: makeState({ subscription_ui_suppressed: true }),
    });

    const result = enforceEngineIsolation(intent, makeContext(), null, "how much is pro");
    expect(result.violationRule).not.toBe("RULE_3_NO_UI_SPAM");
  });

  test("payment_claim when suppressed → NOT blocked", () => {
    const intent = makeIntent({
      intent: "SUBSCRIPTION_ENGINE",
      sub_intent: "payment_claim",
      entities: { ...makeIntent().entities, amount: null },
      state: makeState({ subscription_ui_suppressed: true }),
    });

    const result = enforceEngineIsolation(intent, makeContext(), null, "paid growth");
    expect(result.violationRule).not.toBe("RULE_3_NO_UI_SPAM");
  });

  test("non-suppressed SUBSCRIPTION_ENGINE → NOT blocked by RULE 3", () => {
    const intent = makeIntent({
      intent: "SUBSCRIPTION_ENGINE",
      sub_intent: "upgrade_request",
      entities: { ...makeIntent().entities, amount: null },
      state: makeState({ subscription_ui_suppressed: false }),
    });

    const result = enforceEngineIsolation(intent, makeContext(), null, "subscribe");
    expect(result.violationRule).not.toBe("RULE_3_NO_UI_SPAM");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// RULE 4 — FINANCIAL ACCURACY
// ═══════════════════════════════════════════════════════════════════════════════

describe("Engine Guard › RULE 4 — Financial Accuracy", () => {
  test("LEDGER_ENGINE + amount=null + null sub_intent → blocked", () => {
    const intent = makeIntent({
      intent: "LEDGER_ENGINE",
      sub_intent: null,
      entities: { ...makeIntent().entities, amount: null },
    });
    const ctx = makeContext({ lastAmount: null });

    const result = enforceEngineIsolation(intent, ctx, null, "record something");
    expect(result.blocked).toBe(true);
    expect(result.violationRule).toBe("RULE_4_FINANCIAL_ACCURACY");
    expect(result.override?.intent).toBe("ERROR");
    expect(result.override?.sub_intent).toBe("incomplete");
  });

  test("LEDGER_ENGINE + amount=null + sub=sale → NOT blocked (sale is exempt)", () => {
    const intent = makeIntent({
      intent: "LEDGER_ENGINE",
      sub_intent: "sale",
      entities: { ...makeIntent().entities, amount: null },
    });
    const ctx = makeContext({ lastAmount: null });

    const result = enforceEngineIsolation(intent, ctx, null, "sold rice");
    expect(result.violationRule).not.toBe("RULE_4_FINANCIAL_ACCURACY");
  });

  test("LEDGER_ENGINE + amount=null + sub=expense → NOT blocked", () => {
    const intent = makeIntent({
      intent: "LEDGER_ENGINE",
      sub_intent: "expense",
      entities: { ...makeIntent().entities, amount: null },
    });

    const result = enforceEngineIsolation(intent, makeContext({ lastAmount: null }), null, "bought fuel");
    expect(result.violationRule).not.toBe("RULE_4_FINANCIAL_ACCURACY");
  });

  test("LEDGER_ENGINE + amount=null + sub=stock_update → NOT blocked", () => {
    const intent = makeIntent({
      intent: "LEDGER_ENGINE",
      sub_intent: "stock_update",
      entities: { ...makeIntent().entities, amount: null },
    });

    const result = enforceEngineIsolation(intent, makeContext({ lastAmount: null }), null, "received 50 bags");
    expect(result.violationRule).not.toBe("RULE_4_FINANCIAL_ACCURACY");
  });

  test("all exempted sub_intents pass RULE 4", () => {
    const EXEMPT: Array<string> = [
      "stock_update", "salary", "expense", "sale", "debt_record",
      "debt_payment", "loan_given", "loan_repaid", "investment", "withdrawal", "refund",
    ];
    for (const sub of EXEMPT) {
      const intent = makeIntent({
        intent: "LEDGER_ENGINE",
        sub_intent: sub as any,
        entities: { ...makeIntent().entities, amount: null },
      });
      const result = enforceEngineIsolation(intent, makeContext({ lastAmount: null }), null, "test");
      expect(result.violationRule).not.toBe("RULE_4_FINANCIAL_ACCURACY");
    }
  });

  test("LEDGER_ENGINE + amount=null + context lastAmount > 0 → NOT blocked", () => {
    const intent = makeIntent({
      intent: "LEDGER_ENGINE",
      sub_intent: null,
      entities: { ...makeIntent().entities, amount: null },
    });
    // Context carry-forward provides the amount
    const ctx = makeContext({ lastAmount: 100 });

    const result = enforceEngineIsolation(intent, ctx, null, "yes confirm");
    expect(result.violationRule).not.toBe("RULE_4_FINANCIAL_ACCURACY");
  });

  test("LEDGER_ENGINE + amount=100 → NOT blocked by RULE 4", () => {
    const intent = makeIntent({ intent: "LEDGER_ENGINE", sub_intent: "sale" });
    // amount is 100 from makeIntent default

    const result = enforceEngineIsolation(intent, makeContext(), null, "sold rice 100");
    expect(result.violationRule).not.toBe("RULE_4_FINANCIAL_ACCURACY");
  });

  test("RULE 4 override confidence is 0.55", () => {
    const intent = makeIntent({
      intent: "LEDGER_ENGINE",
      sub_intent: null,
      entities: { ...makeIntent().entities, amount: null },
    });

    const result = enforceEngineIsolation(intent, makeContext({ lastAmount: null }), null, "stuff");
    expect(result.blocked).toBe(true);
    expect(result.override?.confidence).toBe(0.55);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// RULE 5 — DUPLICATE DETECTION (dedup flag, not hard block)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Engine Guard › RULE 5 — Duplicate Suppression", () => {
  const RECENT_ISO = new Date(Date.now() - 5000).toISOString(); // 5s ago

  test("identical text within 30s → RULE_5 flag set, NOT fully blocked", () => {
    const intent = makeIntent({ intent: "LEDGER_ENGINE" });
    const ctx = makeContext({
      lastIntent: "LEDGER_ENGINE",
      lastNormalizedText: "sold rice 100",
      updatedAt: RECENT_ISO,
    });

    const result = enforceEngineIsolation(intent, ctx, null, "sold rice 100");
    // RULE 5 does NOT set blocked=true — it attaches the dedup flag via violationRule
    expect(result.violationRule).toBe("RULE_5_DUPLICATE_SUPPRESSED");
    expect(result.blocked).toBe(false);
    expect(result.override?.confidence).toBe(0.0);
  });

  test("isDuplicateLedgerEntry returns true when RULE_5 flag is set", () => {
    const intent = makeIntent({ intent: "LEDGER_ENGINE" });
    const ctx = makeContext({
      lastIntent: "LEDGER_ENGINE",
      lastNormalizedText: "sold rice 100",
      updatedAt: RECENT_ISO,
    });

    const result = enforceEngineIsolation(intent, ctx, null, "sold rice 100");
    expect(isDuplicateLedgerEntry(result)).toBe(true);
  });

  test("same text but >30s old → NOT flagged as duplicate", () => {
    const intent = makeIntent({ intent: "LEDGER_ENGINE" });
    const oldIso = new Date(Date.now() - 60_000).toISOString(); // 1 minute ago
    const ctx = makeContext({
      lastIntent: "LEDGER_ENGINE",
      lastNormalizedText: "sold rice 100",
      updatedAt: oldIso,
    });

    const result = enforceEngineIsolation(intent, ctx, null, "sold rice 100");
    expect(result.violationRule).not.toBe("RULE_5_DUPLICATE_SUPPRESSED");
  });

  test("different text → NOT flagged as duplicate", () => {
    const intent = makeIntent({ intent: "LEDGER_ENGINE" });
    const ctx = makeContext({
      lastIntent: "LEDGER_ENGINE",
      lastNormalizedText: "sold rice 100",
      updatedAt: RECENT_ISO,
    });

    const result = enforceEngineIsolation(intent, ctx, null, "sold flour 200");
    expect(result.violationRule).not.toBe("RULE_5_DUPLICATE_SUPPRESSED");
  });

  test("same text but last intent was not LEDGER_ENGINE → NOT flagged", () => {
    const intent = makeIntent({ intent: "LEDGER_ENGINE" });
    const ctx = makeContext({
      lastIntent: "SMALLTALK",
      lastNormalizedText: "sold rice 100",
      updatedAt: RECENT_ISO,
    });

    const result = enforceEngineIsolation(intent, ctx, null, "sold rice 100");
    expect(result.violationRule).not.toBe("RULE_5_DUPLICATE_SUPPRESSED");
  });

  test("no context → NOT flagged as duplicate", () => {
    const intent = makeIntent({ intent: "LEDGER_ENGINE" });
    const result = enforceEngineIsolation(intent, null, null, "sold rice 100");
    expect(result.violationRule).not.toBe("RULE_5_DUPLICATE_SUPPRESSED");
  });

  test("isDuplicateLedgerEntry returns false for normal pass result", () => {
    const intent = makeIntent();
    const result = enforceEngineIsolation(intent, makeContext(), null, "sold rice 100");
    expect(isDuplicateLedgerEntry(result)).toBe(false);
  });

  test("RULE_5 case-insensitive match — 'SOLD RICE 100' matches 'sold rice 100'", () => {
    const intent = makeIntent({ intent: "LEDGER_ENGINE" });
    const ctx = makeContext({
      lastIntent: "LEDGER_ENGINE",
      lastNormalizedText: "sold rice 100",
      updatedAt: RECENT_ISO,
    });

    const result = enforceEngineIsolation(intent, ctx, null, "SOLD RICE 100");
    expect(result.violationRule).toBe("RULE_5_DUPLICATE_SUPPRESSED");
  });

  test("whitespace-trimmed duplicate is still detected", () => {
    const intent = makeIntent({ intent: "LEDGER_ENGINE" });
    const ctx = makeContext({
      lastIntent: "LEDGER_ENGINE",
      lastNormalizedText: "sold rice 100",
      updatedAt: RECENT_ISO,
    });

    const result = enforceEngineIsolation(intent, ctx, null, "  sold rice 100  ");
    expect(result.violationRule).toBe("RULE_5_DUPLICATE_SUPPRESSED");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PASS — No rule should fire for clean inputs
// ═══════════════════════════════════════════════════════════════════════════════

describe("Engine Guard › Clean Pass (no rule fires)", () => {
  test("normal LEDGER_ENGINE sale with amount → passes all rules", () => {
    const result = enforceEngineIsolation(
      makeIntent(),
      makeContext(),
      null,
      "sold rice 100",
    );
    expect(result.blocked).toBe(false);
    expect(result.violationRule).toBeNull();
    expect(result.override).toBeNull();
  });

  test("SMALLTALK → passes all rules", () => {
    const intent = makeIntent({ intent: "SMALLTALK", sub_intent: "greeting" });
    const result = enforceEngineIsolation(intent, makeContext(), null, "hello");
    expect(result.blocked).toBe(false);
  });

  test("HELP_ENGINE → passes all rules", () => {
    const intent = makeIntent({ intent: "HELP_ENGINE", sub_intent: "commands_list" });
    const result = enforceEngineIsolation(intent, makeContext(), null, "help");
    expect(result.blocked).toBe(false);
  });

  test("UNDO → passes all rules", () => {
    const intent = makeIntent({ intent: "UNDO", sub_intent: "undo" });
    const result = enforceEngineIsolation(intent, makeContext(), null, "undo");
    expect(result.blocked).toBe(false);
  });

  test("ERROR intent → passes all rules", () => {
    const intent = makeIntent({ intent: "ERROR", sub_intent: "ambiguous" });
    const result = enforceEngineIsolation(intent, makeContext(), null, "hmm idk");
    expect(result.blocked).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PRIORITY — Rule ordering (RULE 1 fires before RULE 2 when both could apply)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Engine Guard › Rule Priority", () => {
  test("RULE 1 fires before RULE 2 when both conditions overlap", () => {
    // SUBSCRIPTION_ENGINE + amount > 0 + activeFlow = ledger
    // Both RULE 1 and RULE 2 could match. RULE 1 is checked first.
    const intent = makeIntent({
      intent: "SUBSCRIPTION_ENGINE",
      sub_intent: "upgrade_request",
      entities: { ...makeIntent().entities, amount: 200, action: "paid" },
    });
    const ctx = makeContext({ activeFlow: "ledger" });

    const result = enforceEngineIsolation(intent, ctx, null, "paid 200");
    expect(result.violationRule).toBe("RULE_1_NO_SUBSCRIPTION_INTERRUPT");
  });
});
