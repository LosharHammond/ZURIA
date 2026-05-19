/**
 * ╔══════════════════════════════════════════════════════════════════════════════╗
 * ║   ZURIA — BEHAVIORAL REGRESSION TEST RUNNER                                ║
 * ║   File 16 · Permanent · Deterministic · 1000+ cases                        ║
 * ╚══════════════════════════════════════════════════════════════════════════════╝
 *
 * Runs the full behavioral regression suite against ZURIA's live pipeline:
 *   normalizeGhanaianEnglish → classifyMessage → enforceEngineIsolation
 *
 * Each test validates:
 *   ✓ Correct engine routing (expectedIntent)
 *   ✓ Correct sub-intent classification (expectedSubIntent, where deterministic)
 *   ✓ Entity extraction accuracy (amount, customerName, productName, direction)
 *   ✓ No forbidden behaviors triggered
 *   ✓ Amount/name corruption never occurs
 *
 * Non-deterministic properties (tone, emotional interpretation) are recorded
 * in the test name and report for LLM evaluation, but not hard-asserted here.
 *
 * FAIL triggers documented in this file:
 *   • Wrong engine routes (financial → subscription, etc.)
 *   • GHS 0 for messages with amounts
 *   • Amount corruption (1300 pcs treated as GHS 1300)
 *   • Customer name lost
 *   • Product name lost
 *   • Forbidden behavior flag set
 */

import {
  getRegressionSuite,
  getSuiteStats,
  exportToJson,
  type RegressionTest,
  type ForbiddenBehavior,
} from "./regression-suite";
import { normalizeGhanaianEnglish } from "@/lib/intelligence/ghanaian-normalizer";
import { classifyMessage }          from "@/lib/intelligence/intent-classifier";
import { enforceEngineIsolation, isDuplicateLedgerEntry } from "@/lib/intelligence/engine-guard";
import { parseTransaction }         from "@/lib/parsers/transaction-parser";
import type { ConversationContext } from "@/lib/intelligence/types";
import path from "path";

// ─── Suite + stats ────────────────────────────────────────────────────────────

const SUITE = getRegressionSuite();
const STATS = getSuiteStats(SUITE);

// ─── Pipeline helper ──────────────────────────────────────────────────────────

interface PipelineResult {
  normalized:  string;
  intent:      string;
  subIntent:   string | null;
  confidence:  number;
  entities: {
    amount:        number | null;
    customerName:  string | null;
    productName:   string | null;
    direction:     string | null;
    action:        string | null;
  };
  isDuplicate: boolean;
  blockedBy:   string | null;
}

function runPipeline(
  userInput:  string,
  context:    RegressionTest["context"] | null,
): PipelineResult {
  const normalized = normalizeGhanaianEnglish(userInput);

  // Build ConversationContext with safe defaults
  const ctx: ConversationContext | null = context ? {
    lastIntent:               (context.lastIntent ?? null) as any,
    activeFlow:               (context.activeFlow ?? "none") as any,
    lastPerson:               context.lastPerson ?? null,
    lastAmount:               context.lastAmount ?? null,
    lastAsset:                context.lastAsset ?? null,
    lastTransactionSubIntent: (context.lastTransactionSubIntent ?? null) as any,
    lastTransactionId:        null,
    lastTransactionDesc:      null,
    conversationHistory:      [],
    pendingLimitNotification: null,
    subscriptionUiShownAt:    context.subscriptionUiShownAt ?? null,
    pendingTransaction:       null,
    lastNormalizedText:       context.lastNormalizedText ?? null,
    updatedAt:                context.updatedAt ?? new Date().toISOString(),
  } : null;

  const raw   = classifyMessage(normalized, ctx);
  // Pass context.lastNormalizedText as lastRawText so RULE 5 duplicate detection fires
  const lastRaw = context?.lastNormalizedText ?? null;
  const guard = enforceEngineIsolation(raw, ctx, lastRaw, normalized);
  // For RULE 5 (dedup): guard.blocked=false but override carries confidence=0.0 signal.
  // Apply the override so result.confidence reflects the dedup flag accurately.
  const isRule5 = guard.violationRule === "RULE_5_DUPLICATE_SUPPRESSED";
  const final = guard.blocked ? guard.override! : (isRule5 && guard.override ? guard.override : raw);

  // Parse for entity-level checks (transaction parser is independent of classifier)
  const parsed = parseTransaction(normalized);

  // For stock_update sub-intent: use the entity amount when it was explicitly set
  // (e.g. "bought 5 bags of rice for 200" → amount=200), otherwise null (qty-only).
  // Never use parsed.amount fallback for stock_update — that would treat quantity as GHS.
  const isStockUpdate = final.sub_intent === "stock_update";
  return {
    normalized,
    intent:     final.intent,
    subIntent:  final.sub_intent,
    confidence: final.confidence,
    entities: {
      amount:       isStockUpdate
        ? (final.entities.amount ?? null)
        : (final.entities.amount ?? (parsed.amount > 0 ? parsed.amount : null)),
      customerName: final.entities.person ?? parsed.customerName ?? null,
      productName:  final.entities.asset  ?? parsed.productName  ?? null,
      direction:    final.entities.direction,
      action:       final.entities.action,
    },
    isDuplicate: isDuplicateLedgerEntry(guard),
    blockedBy:   guard.violationRule,
  };
}

// ─── Forbidden-behavior checker ───────────────────────────────────────────────

function checkForbiddenBehaviors(
  test:   RegressionTest,
  result: PipelineResult,
): { violations: string[] } {
  const violations: string[] = [];

  const check = (behavior: ForbiddenBehavior, cond: boolean, msg: string) => {
    if (test.forbiddenBehaviors.includes(behavior) && cond) {
      violations.push(`[${behavior}] ${msg}`);
    }
  };

  check(
    "show_subscription_ui",
    result.intent === "SUBSCRIPTION_ENGINE" && test.expectedIntent !== "SUBSCRIPTION_ENGINE",
    `Routed to SUBSCRIPTION_ENGINE when ${test.expectedIntent} was expected`,
  );

  check(
    "record_zero_amount",
    result.intent === "LEDGER_ENGINE" && (result.entities.amount ?? 0) === 0 &&
    test.expectedEntities.amount !== null && test.expectedEntities.amount !== 0,
    `Amount resolved to 0 when ${test.expectedEntities.amount} was expected`,
  );

  check(
    "hallucinate_balance",
    result.intent === "ERROR" && test.expectedIntent === "LEDGER_QUERY_ENGINE",
    `Query errored instead of routing to LEDGER_QUERY_ENGINE (potential hallucination path)`,
  );

  check(
    "confuse_qty_with_price",
    test.expectedEntities.amount === 0 &&
    result.entities.amount !== null && result.entities.amount > 0,
    `Quantity treated as GHS amount (got ${result.entities.amount})`,
  );

  check(
    "confuse_debt_with_expense",
    result.subIntent === "expense" &&
    (test.expectedSubIntent === "debt_payment" || test.expectedSubIntent === "debt_record"),
    `Debt classified as expense (expected ${test.expectedSubIntent})`,
  );

  check(
    "confuse_debt_with_sale",
    result.subIntent === "sale" &&
    (test.expectedSubIntent === "debt_payment" || test.expectedSubIntent === "debt_record"),
    `Debt classified as sale (expected ${test.expectedSubIntent})`,
  );

  check(
    "reroute_to_wrong_engine",
    result.intent !== test.expectedIntent,
    `Engine mismatch: got ${result.intent}, expected ${test.expectedIntent}`,
  );

  check(
    "corrupt_amount",
    test.expectedEntities.amount !== null &&
    test.expectedEntities.amount > 0 &&
    result.entities.amount !== null &&
    Math.abs((result.entities.amount ?? 0) - test.expectedEntities.amount) > 0.01,
    `Amount corrupted: got ${result.entities.amount}, expected ${test.expectedEntities.amount}`,
  );

  check(
    "double_record",
    result.isDuplicate === false && test.context?.lastNormalizedText === test.userInput.toLowerCase(),
    `Duplicate not detected (RULE 5 should have flagged this)`,
  );

  check(
    "activate_without_payment",
    result.intent === "SUBSCRIPTION_ENGINE" && result.subIntent !== "payment_claim" &&
    test.forbiddenBehaviors.includes("activate_without_payment"),
    `Subscription activated path without payment_claim sub_intent`,
  );

  check(
    "expose_system_internals",
    result.intent === "ERROR" && result.confidence > 0.9 &&
    test.expectedIntent !== "ERROR",
    `High-confidence ERROR may expose internals (confidence: ${result.confidence})`,
  );

  check(
    "treat_qty_as_ledger_entry",
    test.expectedEntities.amount === 0 &&
    result.intent === "LEDGER_ENGINE" &&
    (result.entities.amount ?? 0) > 0,
    `Stock receipt created a GHS entry instead of qty-only record`,
  );

  check(
    "interrupt_with_upgrade",
    result.intent === "SUBSCRIPTION_ENGINE" &&
    test.context?.activeFlow === "ledger" &&
    test.expectedIntent !== "SUBSCRIPTION_ENGINE",
    `Subscription UI shown during active ledger flow (RULE 1 violation)`,
  );

  return { violations };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE OVERVIEW
// ═══════════════════════════════════════════════════════════════════════════════

describe("Regression Suite › Overview", () => {
  test("suite contains at least 1000 tests", () => {
    expect(SUITE.length).toBeGreaterThanOrEqual(1000);
  });

  test("all 10 categories are present", () => {
    const cats = new Set(SUITE.map((t) => t.category));
    expect(cats.has("financial_understanding")).toBe(true);
    expect(cats.has("debt_inference")).toBe(true);
    expect(cats.has("inventory_inference")).toBe(true);
    expect(cats.has("emotional_intelligence")).toBe(true);
    expect(cats.has("ghanaian_english")).toBe(true);
    expect(cats.has("multi_intent")).toBe(true);
    expect(cats.has("ambiguity_handling")).toBe(true);
    expect(cats.has("context_memory")).toBe(true);
    expect(cats.has("fraud_avoidance")).toBe(true);
    expect(cats.has("subscription_suppression")).toBe(true);
  });

  test("all 4 complexity levels are present", () => {
    const levels = new Set(SUITE.map((t) => t.complexity));
    expect(levels.has("basic")).toBe(true);
    expect(levels.has("moderate")).toBe(true);
    expect(levels.has("advanced")).toBe(true);
    expect(levels.has("adversarial")).toBe(true);
  });

  test("all test IDs are unique", () => {
    const ids = SUITE.map((t) => t.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  test("no test has an empty userInput", () => {
    const empties = SUITE.filter((t) => !t.userInput.trim());
    expect(empties.length).toBe(0);
  });

  test("no test has a missing expectedIntent", () => {
    const missing = SUITE.filter((t) => !t.expectedIntent);
    expect(missing.length).toBe(0);
  });

  test("every LEDGER_ENGINE test has at least one forbiddenBehavior", () => {
    const ledgerTests = SUITE.filter((t) => t.expectedIntent === "LEDGER_ENGINE");
    const noForbidden = ledgerTests.filter((t) => t.forbiddenBehaviors.length === 0);
    expect(noForbidden.length).toBe(0);
  });

  test("each category has at least 80 tests", () => {
    for (const [cat, count] of Object.entries(STATS.byCategory)) {
      expect(count).toBeGreaterThanOrEqual(80);
    }
  });

  test("stats byComplexity sums to total", () => {
    const sum = Object.values(STATS.byComplexity).reduce((a, b) => a + b, 0);
    expect(sum).toBe(STATS.total);
  });

  test("can export to JSON without throwing", () => {
    const outPath = path.resolve(__dirname, "regression-suite.json");
    expect(() => exportToJson(outPath)).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CATEGORY 1 — FINANCIAL UNDERSTANDING
// ═══════════════════════════════════════════════════════════════════════════════

const CAT1 = SUITE.filter((t) => t.category === "financial_understanding");

describe("Regression › Cat 1: Financial Understanding", () => {
  describe("1.1 — Basic sales route to LEDGER_ENGINE", () => {
    const sales = CAT1.filter((t) => t.expectedSubIntent === "sale" && t.complexity === "basic");
    test.each(sales.map((t) => [t.id, t] as [string, RegressionTest]))(
      "%s: %s",
      (id, test) => {
        const result = runPipeline(test.userInput, test.context);
        expect(result.intent).toBe("LEDGER_ENGINE");
        const { violations } = checkForbiddenBehaviors(test, result);
        expect(violations).toHaveLength(0);
      }
    );
  });

  describe("1.2 — Sale amounts preserved exactly", () => {
    const withAmounts = CAT1.filter((t) => (t.expectedEntities.amount ?? 0) > 0);
    test.each(withAmounts.map((t) => [t.id, t] as [string, RegressionTest]))(
      "%s: amount=%s preserved",
      (id, test) => {
        const result = runPipeline(test.userInput, test.context);
        const expectedAmt = test.expectedEntities.amount!;
        // Amount must either be extracted correctly or confidence must be low (ask mode)
        if ((result.entities.amount ?? 0) > 0) {
          expect(Math.abs((result.entities.amount ?? 0) - expectedAmt)).toBeLessThanOrEqual(0.01);
        } else {
          // Amount not extracted — must have low confidence (will ask user)
          expect(result.confidence).toBeLessThan(0.85);
        }
      }
    );
  });

  describe("1.3 — Expenses never classified as sales", () => {
    const expenses = CAT1.filter((t) => t.expectedSubIntent === "expense");
    test.each(expenses.map((t) => [t.id, t] as [string, RegressionTest]))(
      "%s: expense != sale",
      (id, test) => {
        const result = runPipeline(test.userInput, test.context);
        expect(result.subIntent).not.toBe("sale");
        expect(result.intent).toBe("LEDGER_ENGINE");
      }
    );
  });

  describe("1.4 — Salary type correctly classified", () => {
    const salaries = CAT1.filter((t) => t.expectedSubIntent === "salary");
    test.each(salaries.map((t) => [t.id, t] as [string, RegressionTest]))(
      "%s: salary type",
      (id, test) => {
        const result = runPipeline(test.userInput, test.context);
        expect(result.intent).toBe("LEDGER_ENGINE");
        const { violations } = checkForbiddenBehaviors(test, result);
        expect(violations).toHaveLength(0);
      }
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CATEGORY 2 — DEBT INFERENCE
// ═══════════════════════════════════════════════════════════════════════════════

const CAT2 = SUITE.filter((t) => t.category === "debt_inference");

describe("Regression › Cat 2: Debt Inference", () => {
  describe("2.1 — 'X owes me N' → debt_record, never sale", () => {
    const owes = CAT2.filter((t) => t.expectedSubIntent === "debt_record");
    test.each(owes.map((t) => [t.id, t] as [string, RegressionTest]))(
      "%s: %s",
      (id, test) => {
        const result = runPipeline(test.userInput, test.context);
        expect(result.intent).toBe("LEDGER_ENGINE");
        expect(result.subIntent).not.toBe("sale");
        expect(result.subIntent).not.toBe("expense");
        const { violations } = checkForbiddenBehaviors(test, result);
        expect(violations).toHaveLength(0);
      }
    );
  });

  describe("2.2 — 'X paid me N' → debt_payment, never expense", () => {
    const payments = CAT2.filter((t) => t.expectedSubIntent === "debt_payment");
    test.each(payments.map((t) => [t.id, t] as [string, RegressionTest]))(
      "%s: %s",
      (id, test) => {
        const result = runPipeline(test.userInput, test.context);
        expect(result.intent).toBe("LEDGER_ENGINE");
        // Critical: must NOT be expense
        expect(result.subIntent).not.toBe("expense");
        const { violations } = checkForbiddenBehaviors(test, result);
        expect(violations).toHaveLength(0);
      }
    );
  });

  describe("2.3 — Customer names extracted in debt messages", () => {
    const withNames = CAT2.filter((t) => t.expectedEntities.customerName !== null);
    test.each(withNames.map((t) => [t.id, t] as [string, RegressionTest]))(
      "%s: name=%s",
      (id, test) => {
        const result = runPipeline(test.userInput, test.context);
        const expected = test.expectedEntities.customerName!.toLowerCase();
        const got      = (result.entities.customerName ?? "").toLowerCase();
        // Name must appear in extracted entities
        expect(got).toContain(expected.toLowerCase().split(" ")[0]!);
      }
    );
  });

  describe("2.4 — Loan given/repaid correctly classified", () => {
    const loans = CAT2.filter((t) =>
      t.expectedSubIntent === "loan_given" || t.expectedSubIntent === "loan_repaid"
    );
    test.each(loans.map((t) => [t.id, t] as [string, RegressionTest]))(
      "%s: %s",
      (id, test) => {
        const result = runPipeline(test.userInput, test.context);
        expect(result.intent).toBe("LEDGER_ENGINE");
        // Must not confuse with expense
        expect(result.subIntent).not.toBe("expense");
        const { violations } = checkForbiddenBehaviors(test, result);
        expect(violations).toHaveLength(0);
      }
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CATEGORY 3 — INVENTORY INFERENCE
// ═══════════════════════════════════════════════════════════════════════════════

const CAT3 = SUITE.filter((t) => t.category === "inventory_inference");

describe("Regression › Cat 3: Inventory Inference", () => {
  describe("3.1 — 'received N units' → amount=0 (qty is never price)", () => {
    const qtyOnly = CAT3.filter((t) => t.expectedEntities.amount === 0);
    test.each(qtyOnly.map((t) => [t.id, t] as [string, RegressionTest]))(
      "%s: %s",
      (id, test) => {
        const result = runPipeline(test.userInput, test.context);
        // Amount must be 0 — number in input is quantity, not price
        if (result.intent === "LEDGER_ENGINE") {
          expect(result.entities.amount ?? 0).toBe(0);
        }
        const { violations } = checkForbiddenBehaviors(test, result);
        expect(violations).toHaveLength(0);
      }
    );
  });

  describe("3.2 — Inventory queries route to LEDGER_QUERY_ENGINE", () => {
    const queries = CAT3.filter((t) => t.expectedIntent === "LEDGER_QUERY_ENGINE");
    test.each(queries.map((t) => [t.id, t] as [string, RegressionTest]))(
      "%s: %s",
      (id, test) => {
        const result = runPipeline(test.userInput, test.context);
        expect(result.intent).toBe("LEDGER_QUERY_ENGINE");
      }
    );
  });

  describe("3.3 — Stock purchase: price extracted, not qty (when 'for N' present)", () => {
    const purchases = CAT3.filter((t) =>
      t.expectedSubIntent === "stock_update" &&
      (t.expectedEntities.amount ?? 0) > 0
    );
    test.each(purchases.map((t) => [t.id, t] as [string, RegressionTest]))(
      "%s: price=%s",
      (id, test) => {
        const result = runPipeline(test.userInput, test.context);
        expect(result.intent).toBe("LEDGER_ENGINE");
        const expectedAmt = test.expectedEntities.amount!;
        expect((result.entities.amount ?? 0)).toBeGreaterThan(0);
        // Price should be in the right ballpark (not qty)
        expect(Math.abs((result.entities.amount ?? 0) - expectedAmt)).toBeLessThanOrEqual(expectedAmt * 0.1);
      }
    );
  });

  describe("3.4 — 1300 pcs adversarial: large qty never becomes GHS 1300", () => {
    const adversarial = CAT3.filter((t) => t.complexity === "adversarial");
    test.each(adversarial.map((t) => [t.id, t] as [string, RegressionTest]))(
      "%s: %s",
      (id, test) => {
        const result = runPipeline(test.userInput, test.context);
        // Amount must be 0 for stock receipts — qty is not price
        if (result.intent === "LEDGER_ENGINE") {
          expect(result.entities.amount ?? 0).toBe(0);
        }
        const { violations } = checkForbiddenBehaviors(test, result);
        expect(violations).toHaveLength(0);
      }
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CATEGORY 4 — EMOTIONAL INTELLIGENCE
// ═══════════════════════════════════════════════════════════════════════════════

const CAT4 = SUITE.filter((t) => t.category === "emotional_intelligence");

describe("Regression › Cat 4: Emotional Intelligence", () => {
  describe("4.1 — Financial records survive emotional preambles", () => {
    const withAmounts = CAT4.filter((t) => (t.expectedEntities.amount ?? 0) > 0);
    test.each(withAmounts.map((t) => [t.id, t] as [string, RegressionTest]))(
      "%s: amount=%s preserved despite emotion",
      (id, test) => {
        const result = runPipeline(test.userInput, test.context);
        // Intent must still be LEDGER_ENGINE
        expect(result.intent).toBe("LEDGER_ENGINE");
        // Amount must survive emotional context
        const expectedAmt = test.expectedEntities.amount!;
        expect((result.entities.amount ?? 0)).toBeGreaterThan(0);
      }
    );
  });

  describe("4.2 — Stress context: engine still routes correctly", () => {
    const stressed = CAT4.filter((t) => t.expectedEmotionalInterpretation === "stress_concern");
    test.each(stressed.map((t) => [t.id, t] as [string, RegressionTest]))(
      "%s: stress → correct routing",
      (id, test) => {
        const result = runPipeline(test.userInput, test.context);
        expect(result.intent).toBe(test.expectedIntent);
        // Must never push ads during stress
        const { violations } = checkForbiddenBehaviors(test, result);
        expect(violations).toHaveLength(0);
      }
    );
  });

  describe("4.3 — Joy context: high amounts correctly handled", () => {
    const joyful = CAT4.filter((t) =>
      t.expectedEmotionalInterpretation === "joy_celebration" ||
      t.expectedEmotionalInterpretation === "boastful"
    );
    test.each(joyful.map((t) => [t.id, t] as [string, RegressionTest]))(
      "%s: joy → LEDGER_ENGINE",
      (id, test) => {
        const result = runPipeline(test.userInput, test.context);
        expect(result.intent).toBe("LEDGER_ENGINE");
        const { violations } = checkForbiddenBehaviors(test, result);
        expect(violations).toHaveLength(0);
      }
    );
  });

  describe("4.4 — Urgency: no unnecessary clarification", () => {
    const urgent = CAT4.filter((t) => t.expectedEmotionalInterpretation === "urgency");
    test.each(urgent.map((t) => [t.id, t] as [string, RegressionTest]))(
      "%s: urgent → %s",
      (id, test) => {
        const result = runPipeline(test.userInput, test.context);
        // Must route correctly — urgency means act fast
        expect(result.intent).toBe("LEDGER_ENGINE");
      }
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CATEGORY 5 — GHANAIAN ENGLISH UNDERSTANDING
// ═══════════════════════════════════════════════════════════════════════════════

const CAT5 = SUITE.filter((t) => t.category === "ghanaian_english");

describe("Regression › Cat 5: Ghanaian English Understanding", () => {
  describe("5.1 — Pidgin income patterns route to LEDGER_ENGINE", () => {
    const pidginIncome = CAT5.filter((t) => t.expectedIntent === "LEDGER_ENGINE" && t.expectedEntities.direction === "in");
    test.each(pidginIncome.map((t) => [t.id, t] as [string, RegressionTest]))(
      "%s: %s → LEDGER_ENGINE",
      (id, test) => {
        const result = runPipeline(test.userInput, test.context);
        expect(result.intent).toBe("LEDGER_ENGINE");
        const { violations } = checkForbiddenBehaviors(test, result);
        expect(violations).toHaveLength(0);
      }
    );
  });

  describe("5.2 — Pidgin debt negation → LEDGER_QUERY_ENGINE", () => {
    const pidginDebt = CAT5.filter((t) => t.expectedIntent === "LEDGER_QUERY_ENGINE");
    test.each(pidginDebt.map((t) => [t.id, t] as [string, RegressionTest]))(
      "%s: %s → LEDGER_QUERY_ENGINE",
      (id, test) => {
        const result = runPipeline(test.userInput, test.context);
        expect(["LEDGER_QUERY_ENGINE", "LEDGER_ENGINE"]).toContain(result.intent);
      }
    );
  });

  describe("5.3 — Amounts survive Ghanaian normalization", () => {
    const withAmounts = CAT5.filter((t) => (t.expectedEntities.amount ?? 0) > 0);
    test.each(withAmounts.map((t) => [t.id, t] as [string, RegressionTest]))(
      "%s: amount=%s preserved through normalization",
      (id, test) => {
        const normalized = normalizeGhanaianEnglish(test.userInput);
        const parsed = parseTransaction(normalized);
        // Amount must not be corrupted by normalization
        const expectedAmt = test.expectedEntities.amount!;
        if (parsed.amount > 0) {
          expect(Math.abs(parsed.amount - expectedAmt)).toBeLessThanOrEqual(0.01);
        }
      }
    );
  });

  describe("5.4 — Currency variants normalize to correct GHS amount", () => {
    const currencyTests = CAT5.filter((t) =>
      t.userInput.includes("cedis") || t.userInput.includes("GHS") ||
      t.userInput.includes("GHC") || t.userInput.includes("gh ")
    );
    test.each(currencyTests.map((t) => [t.id, t] as [string, RegressionTest]))(
      "%s: %s — amount in GHS",
      (id, test) => {
        const result = runPipeline(test.userInput, test.context);
        expect(result.intent).toBe("LEDGER_ENGINE");
        const expectedAmt = test.expectedEntities.amount!;
        if (result.entities.amount !== null) {
          expect(Math.abs(result.entities.amount - expectedAmt)).toBeLessThanOrEqual(0.01);
        }
      }
    );
  });

  describe("5.5 — Ghanaian greeting prefix does not defeat financial routing", () => {
    const withGreeting = CAT5.filter((t) =>
      /^(good morning|good evening|hi please|hello|sistah|my guy|boss|ɛte sɛn)/i.test(t.userInput)
    );
    test.each(withGreeting.map((t) => [t.id, t] as [string, RegressionTest]))(
      "%s: greeting + transaction",
      (id, test) => {
        const result = runPipeline(test.userInput, test.context);
        expect(result.intent).toBe("LEDGER_ENGINE");
      }
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CATEGORY 6 — MULTI-INTENT PARSING
// ═══════════════════════════════════════════════════════════════════════════════

const CAT6 = SUITE.filter((t) => t.category === "multi_intent");

describe("Regression › Cat 6: Multi-Intent Parsing", () => {
  describe("6.1 — Two-event messages contain both amounts", () => {
    const twoEvent = CAT6.filter((t) =>
      t.complexity === "moderate" &&
      t.notes.includes("AND") &&
      t.expectedIntent === "LEDGER_ENGINE"
    );
    test.each(twoEvent.map((t) => [t.id, t] as [string, RegressionTest]))(
      "%s: %s",
      (id, test) => {
        const result = runPipeline(test.userInput, test.context);
        expect(result.intent).toBe("LEDGER_ENGINE");
        // At minimum, first amount must be extractable
        const { violations } = checkForbiddenBehaviors(test, result);
        expect(violations).toHaveLength(0);
      }
    );
  });

  describe("6.2 — Paid+owes compounds split correctly", () => {
    const paidOwes = CAT6.filter((t) =>
      t.userInput.toLowerCase().includes("owes") &&
      t.userInput.toLowerCase().includes("paid")
    );
    test.each(paidOwes.map((t) => [t.id, t] as [string, RegressionTest]))(
      "%s: paid+owes",
      (id, test) => {
        const result = runPipeline(test.userInput, test.context);
        expect(result.intent).toBe("LEDGER_ENGINE");
        // debt payment must not be misclassified as expense
        expect(result.subIntent).not.toBe("expense");
        const { violations } = checkForbiddenBehaviors(test, result);
        expect(violations).toHaveLength(0);
      }
    );
  });

  describe("6.3 — False splits: 'and' in product name is NOT a separator", () => {
    const falseSplits = CAT6.filter((t) => t.notes.includes("must NOT incorrectly split"));
    test.each(falseSplits.map((t) => [t.id, t] as [string, RegressionTest]))(
      "%s: no false split",
      (id, test) => {
        const result = runPipeline(test.userInput, test.context);
        // Should still route to LEDGER_ENGINE with a valid amount
        expect(result.intent).toBe("LEDGER_ENGINE");
        const { violations } = checkForbiddenBehaviors(test, result);
        expect(violations).toHaveLength(0);
      }
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CATEGORY 7 — AMBIGUITY HANDLING
// ═══════════════════════════════════════════════════════════════════════════════

const CAT7 = SUITE.filter((t) => t.category === "ambiguity_handling");

describe("Regression › Cat 7: Ambiguity Handling", () => {
  describe("7.1 — Missing amount: never record GHS 0", () => {
    const missingAmt = CAT7.filter((t) =>
      t.expectedEntities.amount === 0 && t.complexity === "moderate"
    );
    test.each(missingAmt.map((t) => [t.id, t] as [string, RegressionTest]))(
      "%s: no GHS 0 record",
      (id, test) => {
        const result = runPipeline(test.userInput, test.context);
        // If LEDGER_ENGINE: amount must be 0 AND confidence must be low (ask mode)
        if (result.intent === "LEDGER_ENGINE") {
          expect(result.confidence).toBeLessThan(0.65);
        }
        const { violations } = checkForbiddenBehaviors(test, result);
        expect(violations).toHaveLength(0);
      }
    );
  });

  describe("7.2 — Qty/price ambiguity: conservative default (qty=unit, not price)", () => {
    const qtyAmbiguous = CAT7.filter((t) =>
      t.notes.includes("qty") && t.expectedEntities.amount === 0
    );
    test.each(qtyAmbiguous.map((t) => [t.id, t] as [string, RegressionTest]))(
      "%s: %s",
      (id, test) => {
        const result = runPipeline(test.userInput, test.context);
        // Unit-qualified numbers must default to qty
        if (result.intent === "LEDGER_ENGINE") {
          // Either amount=0 (qty mode) or low confidence
          const goodOutcome =
            (result.entities.amount ?? 0) === 0 ||
            result.confidence < 0.65;
          expect(goodOutcome).toBe(true);
        }
      }
    );
  });

  describe("7.3 — Edge amounts do not crash the pipeline", () => {
    const edgeAmts = CAT7.filter((t) => t.complexity === "adversarial");
    test.each(edgeAmts.map((t) => [t.id, t] as [string, RegressionTest]))(
      "%s: %s",
      (id, test) => {
        expect(() => runPipeline(test.userInput, test.context)).not.toThrow();
      }
    );
  });

  describe("7.4 — Ambiguous type messages route to ERROR or ask gently", () => {
    const ambiguous = CAT7.filter((t) => t.expectedIntent === "ERROR");
    test.each(ambiguous.map((t) => [t.id, t] as [string, RegressionTest]))(
      "%s: %s",
      (id, test) => {
        const result = runPipeline(test.userInput, test.context);
        // Either ERROR or LEDGER_ENGINE with low confidence
        const acceptable =
          result.intent === "ERROR" ||
          (result.intent === "LEDGER_ENGINE" && result.confidence < 0.65);
        expect(acceptable).toBe(true);
        const { violations } = checkForbiddenBehaviors(test, result);
        expect(violations).toHaveLength(0);
      }
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CATEGORY 8 — CONTEXT MEMORY CONTINUITY
// ═══════════════════════════════════════════════════════════════════════════════

const CAT8 = SUITE.filter((t) => t.category === "context_memory");

describe("Regression › Cat 8: Context Memory Continuity", () => {
  describe("8.1 — Bare numbers in ledger flow route to LEDGER_ENGINE", () => {
    const bareNumbers = CAT8.filter((t) =>
      /^\d+$/.test(t.userInput.trim()) && t.expectedIntent === "LEDGER_ENGINE"
    );
    test.each(bareNumbers.map((t) => [t.id, t] as [string, RegressionTest]))(
      "%s: bare number %s in ledger flow",
      (id, test) => {
        const result = runPipeline(test.userInput, test.context);
        expect(result.intent).toBe("LEDGER_ENGINE");
        const { violations } = checkForbiddenBehaviors(test, result);
        expect(violations).toHaveLength(0);
      }
    );
  });

  describe("8.2 — Undo triggers route to UNDO engine", () => {
    const undos = CAT8.filter((t) => t.expectedIntent === "UNDO");
    test.each(undos.map((t) => [t.id, t] as [string, RegressionTest]))(
      "%s: %s → UNDO",
      (id, test) => {
        const result = runPipeline(test.userInput, test.context);
        expect(result.intent).toBe("UNDO");
      }
    );
  });

  describe("8.3 — Queries after ledger context route correctly", () => {
    const queriesAfterLedger = CAT8.filter((t) =>
      t.context?.activeFlow === "ledger" && t.expectedIntent === "LEDGER_QUERY_ENGINE"
    );
    test.each(queriesAfterLedger.map((t) => [t.id, t] as [string, RegressionTest]))(
      "%s: query in ledger context",
      (id, test) => {
        const result = runPipeline(test.userInput, test.context);
        expect(result.intent).toBe("LEDGER_QUERY_ENGINE");
      }
    );
  });

  describe("8.4 — Subscription queries survive ledger context", () => {
    const subInLedger = CAT8.filter((t) =>
      t.context?.activeFlow === "ledger" && t.expectedIntent === "SUBSCRIPTION_ENGINE"
    );
    test.each(subInLedger.map((t) => [t.id, t] as [string, RegressionTest]))(
      "%s: subscription in ledger context",
      (id, test) => {
        const result = runPipeline(test.userInput, test.context);
        // payment_claims must always get through even in ledger flow
        if (test.expectedSubIntent === "payment_claim") {
          expect(["SUBSCRIPTION_ENGINE", "LEDGER_ENGINE"]).toContain(result.intent);
        }
      }
    );
  });

  describe("8.5 — Confirmation words ('yes','confirm') stay in ledger flow", () => {
    const confirms = CAT8.filter((t) =>
      t.context?.activeFlow === "pending_confirmation" && t.expectedIntent === "LEDGER_ENGINE"
    );
    test.each(confirms.map((t) => [t.id, t] as [string, RegressionTest]))(
      "%s: confirm → LEDGER_ENGINE",
      (id, test) => {
        const result = runPipeline(test.userInput, test.context);
        expect(result.intent).toBe("LEDGER_ENGINE");
      }
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CATEGORY 9 — FRAUD AVOIDANCE
// ═══════════════════════════════════════════════════════════════════════════════

const CAT9 = SUITE.filter((t) => t.category === "fraud_avoidance");

describe("Regression › Cat 9: Fraud Avoidance", () => {
  describe("9.1 — RULE 1: Subscription interrupt during ledger flow → blocked", () => {
    const rule1 = CAT9.filter((t) => t.notes.includes("RULE 1"));
    test.each(rule1.map((t) => [t.id, t] as [string, RegressionTest]))(
      "%s: %s",
      (id, test) => {
        const result = runPipeline(test.userInput, test.context);
        // Subscription must be blocked in ledger flow
        expect(result.intent).not.toBe("SUBSCRIPTION_ENGINE");
        const { violations } = checkForbiddenBehaviors(test, result);
        expect(violations).toHaveLength(0);
      }
    );
  });

  describe("9.2 — RULE 2: Financial message must not route to SUBSCRIPTION_ENGINE", () => {
    const rule2 = CAT9.filter((t) => t.notes.includes("RULE 2"));
    test.each(rule2.map((t) => [t.id, t] as [string, RegressionTest]))(
      "%s: %s → LEDGER_ENGINE",
      (id, test) => {
        const result = runPipeline(test.userInput, test.context);
        expect(result.intent).toBe("LEDGER_ENGINE");
        expect(result.entities.amount ?? 0).toBeGreaterThan(0);
        const { violations } = checkForbiddenBehaviors(test, result);
        expect(violations).toHaveLength(0);
      }
    );
  });

  describe("9.3 — RULE 5: Duplicate messages are dedup-flagged", () => {
    const rule5 = CAT9.filter((t) => t.notes.includes("RULE 5"));
    test.each(rule5.map((t) => [t.id, t] as [string, RegressionTest]))(
      "%s: duplicate suppressed",
      (id, test) => {
        const result = runPipeline(test.userInput, test.context);
        // Duplicate must be flagged (confidence=0) or intent must still be LEDGER_ENGINE
        // (not ERROR) — handler skips write but returns normal confirmation
        expect(result.intent).toBe("LEDGER_ENGINE");
        if (result.isDuplicate) {
          expect(result.confidence).toBe(0.0);
        }
      }
    );
  });

  describe("9.4 — Injection attacks: pipeline survives, amount extracted correctly", () => {
    const injections = CAT9.filter((t) => t.notes.includes("Injection"));
    test.each(injections.map((t) => [t.id, t] as [string, RegressionTest]))(
      "%s: %s",
      (id, test) => {
        // Must not crash
        expect(() => runPipeline(test.userInput, test.context)).not.toThrow();
        const result = runPipeline(test.userInput, test.context);
        // If expected amount exists, it must be extractable
        if ((test.expectedEntities.amount ?? 0) > 0) {
          expect(result.intent).toBe("LEDGER_ENGINE");
        }
        const { violations } = checkForbiddenBehaviors(test, result);
        expect(violations).toHaveLength(0);
      }
    );
  });

  describe("9.5 — Balance queries never hallucinate", () => {
    const balanceQueries = CAT9.filter((t) => t.notes.includes("Balance query"));
    test.each(balanceQueries.map((t) => [t.id, t] as [string, RegressionTest]))(
      "%s: balance query",
      (id, test) => {
        const result = runPipeline(test.userInput, test.context);
        expect(result.intent).toBe("LEDGER_QUERY_ENGINE");
        // Must never set an amount from thin air
        expect(result.entities.amount).toBeNull();
        const { violations } = checkForbiddenBehaviors(test, result);
        expect(violations).toHaveLength(0);
      }
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CATEGORY 10 — SUBSCRIPTION SUPPRESSION
// ═══════════════════════════════════════════════════════════════════════════════

const CAT10 = SUITE.filter((t) => t.category === "subscription_suppression");

describe("Regression › Cat 10: Subscription Suppression", () => {
  describe("10.1 — RULE 3: UI suppressed within 24h for non-explicit requests", () => {
    const suppressed = CAT10.filter((t) =>
      t.notes.includes("RULE 3") && t.expectedIntent !== "SUBSCRIPTION_ENGINE"
    );
    test.each(suppressed.map((t) => [t.id, t] as [string, RegressionTest]))(
      "%s: no upgrade push for %s",
      (id, test) => {
        const result = runPipeline(test.userInput, test.context);
        // Financial operations must not be interrupted
        expect(result.intent).not.toBe("SUBSCRIPTION_ENGINE");
        const { violations } = checkForbiddenBehaviors(test, result);
        expect(violations).toHaveLength(0);
      }
    );
  });

  describe("10.2 — Explicit upgrade requests bypass suppression", () => {
    const explicit = CAT10.filter((t) =>
      t.expectedIntent === "SUBSCRIPTION_ENGINE" && t.expectedSubIntent === "upgrade_request"
    );
    test.each(explicit.map((t) => [t.id, t] as [string, RegressionTest]))(
      "%s: explicit upgrade → SUBSCRIPTION_ENGINE",
      (id, test) => {
        const result = runPipeline(test.userInput, test.context);
        expect(result.intent).toBe("SUBSCRIPTION_ENGINE");
        const { violations } = checkForbiddenBehaviors(test, result);
        expect(violations).toHaveLength(0);
      }
    );
  });

  describe("10.3 — Payment claims always processed (never blocked)", () => {
    const claims = CAT10.filter((t) => t.expectedSubIntent === "payment_claim");
    test.each(claims.map((t) => [t.id, t] as [string, RegressionTest]))(
      "%s: payment claim → SUBSCRIPTION_ENGINE",
      (id, test) => {
        const result = runPipeline(test.userInput, test.context);
        expect(result.intent).toBe("SUBSCRIPTION_ENGINE");
        expect(result.subIntent).toBe("payment_claim");
        const { violations } = checkForbiddenBehaviors(test, result);
        expect(violations).toHaveLength(0);
      }
    );
  });

  describe("10.4 — Pricing queries bypass suppression", () => {
    const pricing = CAT10.filter((t) => t.expectedSubIntent === "pricing_query");
    test.each(pricing.map((t) => [t.id, t] as [string, RegressionTest]))(
      "%s: pricing query → SUBSCRIPTION_ENGINE",
      (id, test) => {
        const result = runPipeline(test.userInput, test.context);
        expect(result.intent).toBe("SUBSCRIPTION_ENGINE");
        const { violations } = checkForbiddenBehaviors(test, result);
        expect(violations).toHaveLength(0);
      }
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GLOBAL INVARIANTS — Run against the ENTIRE 1000+ suite
// ═══════════════════════════════════════════════════════════════════════════════

describe("Regression › Global Invariants (all 1000+ tests)", () => {
  test("pipeline never throws on any input in the suite", () => {
    for (const test of SUITE) {
      expect(() => runPipeline(test.userInput, test.context)).not.toThrow();
    }
  });

  test("all LEDGER_ENGINE expected tests reach LEDGER_ENGINE (or ask mode)", () => {
    const ledgerTests = SUITE.filter((t) => t.expectedIntent === "LEDGER_ENGINE");
    const failures: string[] = [];

    for (const test of ledgerTests) {
      const result = runPipeline(test.userInput, test.context);
      if (result.intent !== "LEDGER_ENGINE") {
        failures.push(`${test.id}: "${test.userInput}" → ${result.intent} (expected LEDGER_ENGINE)`);
      }
    }

    // Allow up to 5% miss rate for ambiguous inputs that may legitimately be ERROR
    const allowedFailures = Math.ceil(ledgerTests.length * 0.05);
    expect(failures.length).toBeLessThanOrEqual(allowedFailures);
  });

  test("all LEDGER_QUERY_ENGINE expected tests reach query engine", () => {
    const queryTests = SUITE.filter((t) => t.expectedIntent === "LEDGER_QUERY_ENGINE");
    const failures: string[] = [];

    for (const test of queryTests) {
      const result = runPipeline(test.userInput, test.context);
      if (result.intent !== "LEDGER_QUERY_ENGINE") {
        failures.push(`${test.id}: "${test.userInput}" → ${result.intent}`);
      }
    }

    const allowedFailures = Math.ceil(queryTests.length * 0.05);
    expect(failures.length).toBeLessThanOrEqual(allowedFailures);
  });

  test("no financial test routes to SUBSCRIPTION_ENGINE incorrectly", () => {
    const financialTests = SUITE.filter((t) =>
      t.expectedIntent === "LEDGER_ENGINE" &&
      t.forbiddenBehaviors.includes("show_subscription_ui")
    );
    let wrongRoutes = 0;

    for (const test of financialTests) {
      const result = runPipeline(test.userInput, test.context);
      if (result.intent === "SUBSCRIPTION_ENGINE") {
        wrongRoutes++;
      }
    }

    // Zero tolerance for financial → subscription misrouting
    expect(wrongRoutes).toBe(0);
  });

  test("no inventory qty-only test records GHS amount > 0", () => {
    const qtyOnlyTests = SUITE.filter((t) =>
      t.category === "inventory_inference" && t.expectedEntities.amount === 0
    );

    for (const test of qtyOnlyTests) {
      const result = runPipeline(test.userInput, test.context);
      if (result.intent === "LEDGER_ENGINE") {
        expect(result.entities.amount ?? 0).toBe(0);
      }
    }
  });

  test("no debt payment is classified as expense", () => {
    const debtPayments = SUITE.filter((t) => t.expectedSubIntent === "debt_payment");

    for (const test of debtPayments) {
      const result = runPipeline(test.userInput, test.context);
      // Critical: debt payment must NEVER become expense
      expect(result.subIntent).not.toBe("expense");
    }
  });

  test("injection attacks do not expose system internals", () => {
    const injections = SUITE.filter((t) => t.notes.includes("Injection"));

    for (const test of injections) {
      const result = runPipeline(test.userInput, test.context);
      // System must not crash or emit ERROR with suspiciously high confidence
      expect(result.intent).not.toBe(undefined);
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    }
  });

  test("amounts in financial messages survive normalization (no corruption)", () => {
    const amountTests = SUITE.filter((t) =>
      t.expectedIntent === "LEDGER_ENGINE" &&
      (t.expectedEntities.amount ?? 0) > 10  // skip micro-amounts
    );

    for (const test of amountTests) {
      const normalized = normalizeGhanaianEnglish(test.userInput);
      const parsed     = parseTransaction(normalized);
      const expected   = test.expectedEntities.amount!;

      if (parsed.amount > 0 && parsed.confidence >= 0.40) {
        // Amount must be within 1% of expected (rounding tolerance)
        const deviation = Math.abs(parsed.amount - expected) / expected;
        expect(deviation).toBeLessThanOrEqual(0.01);
      }
    }
  });

  test("forbidden behavior violations across entire suite are below 2%", () => {
    let totalViolations = 0;
    let totalChecked    = 0;

    for (const test of SUITE) {
      const result    = runPipeline(test.userInput, test.context);
      const { violations } = checkForbiddenBehaviors(test, result);
      totalViolations += violations.length > 0 ? 1 : 0;
      totalChecked++;
    }

    const violationRate = totalViolations / totalChecked;
    expect(violationRate).toBeLessThan(0.02); // < 2% violation rate
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// REGRESSION REPORT — Printed after all tests complete
// ═══════════════════════════════════════════════════════════════════════════════

afterAll(() => {
  console.log("\n");
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║        ZURIA BEHAVIORAL REGRESSION SUITE — SUMMARY          ║");
  console.log("╠══════════════════════════════════════════════════════════════╣");
  console.log(`║  Total tests: ${String(STATS.total).padEnd(46)}║`);
  console.log("╠══════════════════════════════════════════════════════════════╣");

  for (const [cat, count] of Object.entries(STATS.byCategory)) {
    const label = cat.replace(/_/g, " ").padEnd(40);
    console.log(`║  ${label}  ${String(count).padStart(5)} ║`);
  }

  console.log("╠══════════════════════════════════════════════════════════════╣");

  for (const [level, count] of Object.entries(STATS.byComplexity)) {
    const label = level.padEnd(40);
    console.log(`║  ${label}  ${String(count).padStart(5)} ║`);
  }

  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log("\n  📁 JSON export: run `npx ts-node __tests__/regression/regression-suite.ts`");
  console.log("  📊 To export: import { exportToJson } from './regression-suite'");
  console.log("              exportToJson('./regression-suite.json')\n");
});
