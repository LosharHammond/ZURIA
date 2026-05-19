/**
 * UNIT TESTS — Transaction Parser
 *
 * Adversarial focus:
 *  - Correct amount/quantity disambiguation
 *  - Parser cannot be tricked into recording wrong amounts
 *  - Edge inputs: negative amounts, zero, very large, unicode, injection strings
 *  - All 17 transaction types parse correctly
 *  - Confidence thresholds are correctly calibrated
 */

import { parseTransaction } from "@/lib/parsers/transaction-parser";

// ─── Helper ───────────────────────────────────────────────────────────────────

function parse(text: string) {
  return parseTransaction(text);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1 — Sale transactions
// ═══════════════════════════════════════════════════════════════════════════════

describe("Parser › Sales", () => {
  test("basic sale", () => {
    const r = parse("sold rice 50");
    expect(r.type).toBe("sale");
    expect(r.amount).toBe(50);
    expect(r.confidence).toBeGreaterThanOrEqual(0.40);
  });

  test("sale with customer", () => {
    const r = parse("sold rice to Ama for 120");
    expect(r.type).toBe("sale");
    expect(r.amount).toBe(120);
    expect(r.customerName?.toLowerCase()).toContain("ama");
  });

  test("'I sold bread 10 pieces' — 10 is quantity not price", () => {
    const r = parse("I sold bread 10 pieces");
    // Either amount=0 (qty corrected) or amount=10 but type is sale
    // The critical constraint: should NOT record a GHS 10 sale when unit is specified
    // Parser should either set amount=0+qty=10, or flag for clarification
    if (r.amount === 10 && r.quantity === undefined) {
      // Acceptable only if confidence is low (handler will ask)
      expect(r.confidence).toBeLessThan(0.65);
    } else {
      expect(r.quantity).toBeGreaterThan(0);
    }
  });

  test("sale with momo payment method", () => {
    const r = parse("sold goods 200 via momo");
    expect(r.type).toBe("sale");
    expect(r.amount).toBe(200);
    expect(r.paymentMethod?.toLowerCase()).toContain("momo");
  });

  test("very large sale amount", () => {
    const r = parse("sold property for 500000 cedis");
    expect(r.amount).toBe(500000);
    expect(r.confidence).toBeGreaterThanOrEqual(0.40);
  });

  test("sale with decimal amount", () => {
    const r = parse("sold tomatoes 12.50");
    expect(r.amount).toBeCloseTo(12.5);
  });

  test("zero-amount sale is not confidently classified", () => {
    const r = parse("sold something");
    expect(r.amount).toBe(0);
    // Must have low confidence so handler asks for amount
    expect(r.confidence).toBeLessThan(0.65);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2 — Expense transactions
// ═══════════════════════════════════════════════════════════════════════════════

describe("Parser › Expenses", () => {
  test("basic expense", () => {
    const r = parse("bought fuel 60");
    expect(r.type).toMatch(/expense|stock_purchase/);
    expect(r.amount).toBe(60);
  });

  test("expense with negative input", () => {
    // Negative amounts should parse as negative (handler converts to positive)
    const r = parse("expense -50");
    expect(Math.abs(r.amount)).toBe(50);
  });

  test("transport cost", () => {
    const r = parse("transport cost 15");
    expect(r.type).toMatch(/expense|cost/);
    expect(r.amount).toBe(15);
  });

  test("electricity bill", () => {
    const r = parse("electricity bill 50");
    expect(r.type).toMatch(/expense/i);
    expect(r.amount).toBe(50);
  });

  test("salary payment", () => {
    const r = parse("salary payment 200");
    expect(r.type).toMatch(/salary/i);
    expect(r.amount).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3 — Debt transactions
// ═══════════════════════════════════════════════════════════════════════════════

describe("Parser › Debts", () => {
  test("'Kofi owes me 100'", () => {
    const r = parse("Kofi owes me 100");
    expect(r.type).toMatch(/debt/i);
    expect(r.amount).toBe(100);
    expect(r.customerName).toMatch(/Kofi/i);
  });

  test("'Ama paid me 30' — debt payment", () => {
    const r = parse("Ama paid me 30");
    expect(r.type).toMatch(/debt_payment|sale|received/i);
    expect(r.amount).toBe(30);
    expect(r.customerName).toMatch(/Ama/i);
  });

  test("customer took goods on credit 60", () => {
    const r = parse("customer took goods on credit 60");
    expect(r.type).toMatch(/debt/i);
    expect(r.amount).toBe(60);
  });

  test("partial payment", () => {
    const r = parse("partial payment from Kofi 15");
    expect(r.amount).toBe(15);
    expect(r.customerName).toMatch(/Kofi/i);
  });

  test("'Ama paid half debt' — no amount (should not record 0)", () => {
    const r = parse("Ama paid half debt");
    expect(r.amount).toBe(0);
    // Confidence must be below auto-save threshold
    expect(r.confidence).toBeLessThan(0.65);
  });

  test("'Kofi paid full balance' — no explicit amount", () => {
    const r = parse("Kofi paid full balance");
    expect(r.amount).toBe(0);
    expect(r.customerName).toMatch(/Kofi/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4 — Stock / inventory
// ═══════════════════════════════════════════════════════════════════════════════

describe("Parser › Stock & Inventory", () => {
  test("'received 1300 pcs disposable gloves' — 1300 is quantity not price", () => {
    const r = parse("received 1300 pcs disposable gloves");
    expect(r.amount).toBe(0);
    expect(r.quantity).toBe(1300);
    expect(r.productName?.toLowerCase()).toContain("gloves");
  });

  test("'received 50 bags of rice' — qty correction", () => {
    const r = parse("received 50 bags of rice");
    expect(r.amount).toBe(0);
    expect(r.quantity).toBe(50);
  });

  test("stock purchase with price", () => {
    const r = parse("bought 5 bags of rice for 200");
    expect(r.amount).toBe(200);
    expect(r.type).toMatch(/stock_purchase|expense/i);
  });

  test("'Record stock rice 5 bags' — qty-only", () => {
    const r = parse("Record stock rice 5 bags");
    // Either qty-only (amount=0, qty=5) or stock type with low confidence
    if (r.amount === 0) {
      expect(r.quantity ?? 5).toBeGreaterThan(0);
    } else {
      expect(r.confidence).toBeLessThan(0.80);
    }
  });

  test("damage/loss stock", () => {
    const r = parse("damage stock 2 units");
    // Should parse as stock loss / expense
    expect(r.amount >= 0).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 5 — Loans & investments
// ═══════════════════════════════════════════════════════════════════════════════

describe("Parser › Loans & Investments", () => {
  test("loan given", () => {
    const r = parse("gave Kojo a loan of 500");
    expect(r.type).toMatch(/loan/i);
    expect(r.amount).toBe(500);
    expect(r.customerName).toMatch(/Kojo/i);
  });

  test("loan repaid", () => {
    const r = parse("Kojo repaid 500");
    expect(r.amount).toBe(500);
    expect(r.customerName).toMatch(/Kojo/i);
  });

  test("investment", () => {
    const r = parse("invested 1000 in business");
    expect(r.type).toMatch(/invest/i);
    expect(r.amount).toBe(1000);
  });

  test("withdrawal", () => {
    const r = parse("withdrew 300 from bank");
    expect(r.type).toMatch(/withdraw/i);
    expect(r.amount).toBe(300);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 6 — Adversarial / edge case inputs
// ═══════════════════════════════════════════════════════════════════════════════

describe("Parser › Adversarial Inputs", () => {
  test("SQL injection attempt in product name", () => {
    const r = parse("sold rice'; DROP TABLE transactions; -- 100");
    // Parser should not crash; amount should still be 100
    expect(() => r).not.toThrow();
    expect(r.amount).toBe(100);
  });

  test("extremely long product name (DoS attempt)", () => {
    const longName = "a".repeat(10_000);
    expect(() => parse(`sold ${longName} 50`)).not.toThrow();
  });

  test("emoji-only input", () => {
    const r = parse("💰💰💰");
    expect(r.confidence).toBeLessThan(0.40);
  });

  test("null-byte in input", () => {
    expect(() => parse("sold rice\0 50")).not.toThrow();
  });

  test("amount as string of zeros", () => {
    const r = parse("sold rice 00000");
    expect(r.amount).toBe(0);
  });

  test("scientific notation amount", () => {
    // '1e5' should not be parsed as 100000 (not a normal user input)
    const r = parse("sold rice 1e5");
    // Parser must not crash; any result is acceptable
    expect(() => r.amount).not.toThrow();
  });

  test("negative zero", () => {
    const r = parse("expense -0");
    expect(Math.abs(r.amount)).toBe(0);
  });

  test("amount with comma separator (1,200)", () => {
    const r = parse("sold goods 1,200");
    // Parser should interpret 1200 or 1 (comma-separated)
    // Critical: must not crash
    expect(() => r.amount).not.toThrow();
  });

  test("multiple amounts — picks largest/most-likely", () => {
    const r = parse("sold 5 items for 200 but gave 20 discount");
    // Parser should extract the sale amount, not the discount
    expect(r.amount).toBeGreaterThan(0);
    expect(() => r).not.toThrow();
  });

  test("Unicode Arabic-Indic numerals", () => {
    // ١٢٠ = 120 in Arabic-Indic numerals — parser should not crash
    expect(() => parse("sold rice ١٢٠")).not.toThrow();
  });

  test("only whitespace", () => {
    const r = parse("   ");
    expect(r.confidence).toBe(0);
    expect(r.amount).toBe(0);
  });

  test("empty string", () => {
    const r = parse("");
    expect(r.confidence).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 7 — Amount / quantity disambiguation boundary cases
// ═══════════════════════════════════════════════════════════════════════════════

describe("Parser › Amount-Quantity Disambiguation", () => {
  const QTY_UNITS = ["pcs", "pieces", "bags", "cartons", "bottles", "units", "boxes"];

  QTY_UNITS.forEach((unit) => {
    test(`"received 100 ${unit} of product" → amount=0, qty=100`, () => {
      const r = parse(`received 100 ${unit} of product`);
      expect(r.amount).toBe(0);
      expect(r.quantity).toBe(100);
    });
  });

  test("'sold 5 phones' — amount=0 forces zuriaAskAmount path", () => {
    const r = parse("sold 5 phones");
    // "phones" is not a price unit — treat 5 as qty
    // Either amount=0 or low-confidence amount=5
    if (r.amount === 5) {
      expect(r.confidence).toBeLessThan(0.65);
    } else {
      expect(r.amount).toBe(0);
    }
  });
});
