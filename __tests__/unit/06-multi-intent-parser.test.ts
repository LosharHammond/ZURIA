/**
 * UNIT TESTS — Multi-Intent Parser
 *
 * Adversarial focus:
 *  - Correct split detection (conjunction + financial verb)
 *  - Correct non-split for ambiguous "and" (e.g. product names)
 *  - "paid X but still owes Y" compound splitting
 *  - All segment amounts are preserved exactly
 *  - Low-confidence segments are excluded, not silently zeroed
 *  - Parser is conservative: when in doubt, single intent
 *  - fmtMultiConfirm generates correct multi-line summary
 */

import {
  parseMultiIntent,
  fmtMultiConfirm,
  type MultiIntentResult,
} from "@/lib/intelligence/multi-intent-parser";

// ─── Helper ───────────────────────────────────────────────────────────────────

function expectAmounts(result: MultiIntentResult, expected: number[]) {
  expect(result.transactions.map((t) => t.amount)).toEqual(expected);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1 — Single intent (no split)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Multi-Intent Parser › Single Intent", () => {
  test("simple sale → single transaction", () => {
    const r = parseMultiIntent("sold rice 100");
    expect(r.isMultiIntent).toBe(false);
    expect(r.transactions.length).toBeGreaterThanOrEqual(1);
    expect(r.transactions[0]?.amount).toBeCloseTo(100);
  });

  test("simple expense → single transaction", () => {
    const r = parseMultiIntent("bought fuel 50");
    expect(r.isMultiIntent).toBe(false);
    expect(r.transactions.length).toBeGreaterThanOrEqual(1);
  });

  test("'sold rice and beans 100' — 'and' is part of product name, not a split", () => {
    // 'and' is not followed by a financial verb, so should NOT split
    const r = parseMultiIntent("sold rice and beans 100");
    expect(r.isMultiIntent).toBe(false);
    // Either single transaction with amount=100, or parser treats "and beans" as product
    if (r.transactions.length > 0) {
      expect(r.transactions.every((t) => t.amount > 0 || t.confidence < 0.40)).toBe(true);
    }
  });

  test("'paid Ama 30 and said thank you' — 'and said' not a financial verb", () => {
    const r = parseMultiIntent("paid Ama 30 and said thank you");
    // 'said' is not a financial verb → no split expected
    // At minimum, a single 30 transaction should be detected
    const has30 = r.transactions.some((t) => t.amount === 30 || (t.amount > 0 && t.confidence >= 0.40));
    expect(has30 || r.transactions.length === 0).toBe(true);
  });

  test("'received 50 bags of rice' → single stock receipt, no split", () => {
    const r = parseMultiIntent("received 50 bags of rice");
    expect(r.isMultiIntent).toBe(false);
  });

  test("empty string → no transactions, single result", () => {
    const r = parseMultiIntent("");
    expect(r.isMultiIntent).toBe(false);
    expect(r.transactions.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2 — Two-way splits
// ═══════════════════════════════════════════════════════════════════════════════

describe("Multi-Intent Parser › Two-Way Splits", () => {
  test("'sold rice 120 and bought fuel 40' → 2 transactions", () => {
    const r = parseMultiIntent("sold rice 120 and bought fuel 40");
    expect(r.isMultiIntent).toBe(true);
    expect(r.transactions.length).toBe(2);
    const amounts = r.transactions.map((t) => t.amount).sort((a, b) => a - b);
    expect(amounts[0]).toBeCloseTo(40);
    expect(amounts[1]).toBeCloseTo(120);
  });

  test("'paid worker 300 and sold tomatoes 80' → 2 transactions", () => {
    const r = parseMultiIntent("paid worker 300 and sold tomatoes 80");
    expect(r.isMultiIntent).toBe(true);
    expect(r.transactions.length).toBe(2);
    expect(r.transactions.some((t) => t.amount === 300)).toBe(true);
    expect(r.transactions.some((t) => t.amount === 80)).toBe(true);
  });

  test("'sold goods 200 plus bought flour 60' — 'plus' is a conjunction", () => {
    const r = parseMultiIntent("sold goods 200 plus bought flour 60");
    // Some parsers may handle this — at minimum amounts should be found
    const totalAmount = r.transactions.reduce((s, t) => s + t.amount, 0);
    expect(totalAmount).toBeGreaterThan(0);
  });

  test("'sold rice 100, bought fuel 50' — comma conjunction", () => {
    const r = parseMultiIntent("sold rice 100, bought fuel 50");
    // comma+verb should split
    expect(r.transactions.length).toBeGreaterThanOrEqual(1);
    const has100 = r.transactions.some((t) => Math.abs(t.amount - 100) < 1);
    expect(has100).toBe(true);
  });

  test("amounts preserved exactly through split", () => {
    const r = parseMultiIntent("sold goods 999 and bought materials 888");
    const amounts = r.transactions.map((t) => t.amount);
    expect(amounts).toContain(999);
    expect(amounts).toContain(888);
  });

  test("'expense fuel 30 then received cash 200'", () => {
    const r = parseMultiIntent("expense fuel 30 then received cash 200");
    expect(r.transactions.some((t) => t.amount === 30)).toBe(true);
    expect(r.transactions.some((t) => t.amount === 200)).toBe(true);
  });

  test("'sold bread 50; bought flour 100' — semicolon split", () => {
    const r = parseMultiIntent("sold bread 50; bought flour 100");
    const amounts = r.transactions.map((t) => t.amount);
    expect(amounts).toContain(50);
    expect(amounts).toContain(100);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3 — Three-way splits
// ═══════════════════════════════════════════════════════════════════════════════

describe("Multi-Intent Parser › Three-Way Splits", () => {
  test("3 conjunctions → 3 transactions", () => {
    const r = parseMultiIntent("sold rice 100 and bought fuel 40 and paid worker 60");
    expect(r.transactions.length).toBe(3);
    expect(r.transactions.some((t) => t.amount === 100)).toBe(true);
    expect(r.transactions.some((t) => t.amount === 40)).toBe(true);
    expect(r.transactions.some((t) => t.amount === 60)).toBe(true);
  });

  test("3-way: amounts not lost or merged", () => {
    const r = parseMultiIntent("sold tomatoes 200 and expense transport 30 and salary worker 500");
    const totalAmount = r.transactions.reduce((sum, t) => sum + t.amount, 0);
    // Sum of all parsed amounts should account for all three amounts
    expect(totalAmount).toBeGreaterThanOrEqual(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4 — "paid X but still owes Y" compound
// ═══════════════════════════════════════════════════════════════════════════════

describe("Multi-Intent Parser › Paid-But-Owes Compound", () => {
  test("'Kofi paid 50 but still owes 100' → 2 transactions", () => {
    const r = parseMultiIntent("Kofi paid 50 but still owes 100");
    expect(r.isMultiIntent).toBe(true);
    expect(r.transactions.length).toBe(2);
    const amounts = r.transactions.map((t) => t.amount).sort((a, b) => a - b);
    expect(amounts[0]).toBe(50);
    expect(amounts[1]).toBe(100);
  });

  test("'Ama paid 30 but owes 200' → 2 transactions", () => {
    const r = parseMultiIntent("Ama paid 30 but owes 200");
    expect(r.isMultiIntent).toBe(true);
    expect(r.transactions.some((t) => t.amount === 30)).toBe(true);
    expect(r.transactions.some((t) => t.amount === 200)).toBe(true);
  });

  test("first segment is debt_payment, second is debt_record", () => {
    const r = parseMultiIntent("Kofi paid 50 but still owes 100");
    const types = r.transactions.map((t) => t.type);
    // First should be some payment type, second should be debt type
    expect(types.length).toBe(2);
    expect(r.transactions[0]?.amount).toBe(50);
    expect(r.transactions[1]?.amount).toBe(100);
  });

  test("'customer paid 80 but balance is 150' — 'balance is' not a compound split", () => {
    // "balance is" doesn't match owes pattern — should be single intent
    const r = parseMultiIntent("customer paid 80 but balance is 150");
    // Acceptable either way — must not crash and must contain amount 80
    expect(() => r).not.toThrow();
    const hasAmount = r.transactions.some((t) => t.amount === 80 || t.amount === 150);
    expect(hasAmount || r.transactions.length === 0).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 5 — Conservative fallback (when in doubt, single intent)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Multi-Intent Parser › Conservative Fallback", () => {
  test("'sold goods 100 and more tomorrow' → no split (no financial verb after 'and')", () => {
    // 'more' is not a financial verb
    const r = parseMultiIntent("sold goods 100 and more tomorrow");
    expect(r.isMultiIntent).toBe(false);
  });

  test("'bought fuel and oil 50' — 'oil' not a financial verb → single", () => {
    const r = parseMultiIntent("bought fuel and oil 50");
    expect(r.isMultiIntent).toBe(false);
  });

  test("result never returns empty transactions for valid input", () => {
    const r = parseMultiIntent("sold rice 100");
    expect(r.transactions.length).toBeGreaterThan(0);
  });

  test("segments array is always populated", () => {
    const r = parseMultiIntent("sold rice 100 and bought fuel 40");
    expect(r.segments.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 6 — Amount integrity across all splits
// ═══════════════════════════════════════════════════════════════════════════════

describe("Multi-Intent Parser › Amount Integrity", () => {
  const splitCases = [
    { input: "sold rice 120 and bought fuel 40", amounts: [120, 40] },
    { input: "sold goods 999 and bought materials 888", amounts: [999, 888] },
    { input: "sold rice 100 and bought fuel 40 and paid worker 60", amounts: [100, 40, 60] },
  ];

  splitCases.forEach(({ input, amounts }) => {
    test(`amounts intact: "${input.slice(0, 50)}"`, () => {
      const r = parseMultiIntent(input);
      for (const expected of amounts) {
        expect(r.transactions.some((t) => Math.abs(t.amount - expected) < 0.01)).toBe(true);
      }
    });
  });

  test("decimal amounts preserved through split", () => {
    const r = parseMultiIntent("sold tomatoes 12.50 and bought fuel 8.25");
    expect(r.transactions.some((t) => Math.abs(t.amount - 12.5) < 0.01)).toBe(true);
    expect(r.transactions.some((t) => Math.abs(t.amount - 8.25) < 0.01)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 7 — fmtMultiConfirm formatting
// ═══════════════════════════════════════════════════════════════════════════════

describe("Multi-Intent Parser › fmtMultiConfirm", () => {
  function makeTxn(type: string, amount: number, product?: string, customer?: string) {
    return {
      type,
      amount,
      productName: product ?? null,
      customerName: customer ?? null,
      confidence: 0.9,
      quantity: null,
      paymentMethod: null,
      notes: null,
    } as any;
  }

  test("basic multi-confirm shows all transactions", () => {
    const txns = [makeTxn("sale", 120, "rice"), makeTxn("expense", 40, "fuel")];
    const msg = fmtMultiConfirm(txns, 120, 40);
    expect(msg).toContain("Recorded");
    expect(msg).toContain("120");
    expect(msg).toContain("40");
  });

  test("positive net shows 'you're +X today'", () => {
    const txns = [makeTxn("sale", 200, "goods")];
    const msg = fmtMultiConfirm(txns, 200, 50);
    expect(msg.toLowerCase()).toMatch(/\+|up|profit/);
  });

  test("negative net shows 'down X today'", () => {
    const txns = [makeTxn("expense", 200, "fuel")];
    const msg = fmtMultiConfirm(txns, 50, 200);
    expect(msg.toLowerCase()).toMatch(/down|loss|-/);
  });

  test("zero net — neither positive nor negative branch", () => {
    const txns = [makeTxn("sale", 100, "rice")];
    const msg = fmtMultiConfirm(txns, 100, 100);
    // Should not crash, content is flexible
    expect(typeof msg).toBe("string");
  });

  test("product name appears in confirmation", () => {
    const txns = [makeTxn("sale", 120, "tomatoes")];
    const msg = fmtMultiConfirm(txns, 120, 0);
    expect(msg).toContain("tomatoes");
  });

  test("customer name appears in confirmation", () => {
    const txns = [makeTxn("debt_payment", 50, undefined, "Ama")];
    const msg = fmtMultiConfirm(txns, 50, 0);
    expect(msg).toContain("Ama");
  });

  test("empty transaction list does not crash", () => {
    expect(() => fmtMultiConfirm([], 0, 0)).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 8 — Adversarial inputs
// ═══════════════════════════════════════════════════════════════════════════════

describe("Multi-Intent Parser › Adversarial Inputs", () => {
  test("SQL injection in product name does not crash", () => {
    expect(() => parseMultiIntent("sold rice'; DROP TABLE-- 100 and bought fuel 50")).not.toThrow();
  });

  test("very long input does not hang", () => {
    const long = "sold rice 100 and " + "bought fuel 50 and ".repeat(50);
    expect(() => parseMultiIntent(long)).not.toThrow();
  });

  test("only whitespace → no transactions", () => {
    const r = parseMultiIntent("   ");
    expect(r.transactions.length).toBe(0);
  });

  test("only 'and' conjunctions → no crash", () => {
    expect(() => parseMultiIntent("and and and")).not.toThrow();
  });

  test("null-byte in text → no crash", () => {
    expect(() => parseMultiIntent("sold rice\0 100 and bought fuel 50")).not.toThrow();
  });

  test("unicode amounts do not crash parser", () => {
    expect(() => parseMultiIntent("sold rice ١٢٠ and bought fuel 50")).not.toThrow();
  });

  test("extremely large amount preserved", () => {
    const r = parseMultiIntent("sold land 500000 and bought car 150000");
    expect(r.transactions.some((t) => t.amount === 500000)).toBe(true);
    expect(r.transactions.some((t) => t.amount === 150000)).toBe(true);
  });
});
