/**
 * UNIT TESTS — Ghanaian Normalizer
 *
 * Adversarial focus:
 *  - Every normalization rule transforms correctly
 *  - Rules are idempotent (running twice = same result)
 *  - Rules do NOT corrupt amounts or names
 *  - Pidgin inputs are correctly bridged to parser-recognizable English
 *  - Implicit multi-intent conjunctions are inserted correctly
 */

import { normalizeGhanaianEnglish } from "@/lib/intelligence/ghanaian-normalizer";

const n = normalizeGhanaianEnglish;

// ─── Idempotency ──────────────────────────────────────────────────────────────

describe("Normalizer › Idempotency", () => {
  const cases = [
    "sold rice 100",
    "Ama paid me 50",
    "Kofi owes me 200",
    "I received 10 bags of flour",
    "expense fuel 30",
  ];

  cases.forEach((text) => {
    test(`"${text}" is idempotent`, () => {
      const once = n(text);
      const twice = n(once);
      expect(twice).toBe(once);
    });
  });
});

// ─── Income / received ────────────────────────────────────────────────────────

describe("Normalizer › Income / Received", () => {
  test("'dash me' → 'gave me'", () => {
    expect(n("Kofi dash me 50")).toContain("gave me 50");
  });

  test("'momo came in' → 'received momo'", () => {
    expect(n("momo came in 200")).toContain("received momo");
  });

  test("'customer send momo' → 'customer paid via momo'", () => {
    expect(n("customer send momo 100")).toContain("customer paid via momo");
  });

  test("amount preserved through normalization", () => {
    const result = n("Ama dash me 750");
    expect(result).toContain("750");
    expect(result).not.toContain("dash");
  });
});

// ─── Debt repayment ───────────────────────────────────────────────────────────

describe("Normalizer › Debt Repayment", () => {
  test("'X clear small' → 'X paid partial'", () => {
    expect(n("Ama clear small")).toContain("paid partial");
  });

  test("'X clear the debt' → 'X paid debt'", () => {
    expect(n("Kofi clear the debt")).toContain("paid debt");
  });

  test("'X clear all' → 'X paid everything'", () => {
    expect(n("John clear all")).toContain("paid everything");
  });

  test("'X pay me back 50' → 'X repaid me 50'", () => {
    const r = n("Ama pay me back 50");
    expect(r).toContain("repaid me");
    expect(r).toContain("50");
  });

  test("'Mark Ama debt as cleared' → 'Ama clear debt'", () => {
    const r = n("Mark Ama debt as cleared");
    expect(r).toContain("Ama");
    expect(r.toLowerCase()).toContain("paid");
  });

  test("'Reduce Kofi debt by 20' → 'Kofi paid 20'", () => {
    const r = n("Reduce Kofi debt by 20");
    expect(r.toLowerCase()).toContain("kofi");
    expect(r).toContain("20");
    expect(r.toLowerCase()).toContain("paid");
  });

  test("customer name preserved in debt normalization", () => {
    const r = n("Abena clear the debt");
    expect(r).toContain("Abena");
  });
});

// ─── Pidgin debt negation ─────────────────────────────────────────────────────

describe("Normalizer › Pidgin Debt Negation", () => {
  test("'Kofi no pay me' → 'Kofi hasn't paid me'", () => {
    const r = n("Kofi no pay me");
    expect(r.toLowerCase()).toContain("hasn't paid");
  });

  test("'Ama no gree pay' → 'Ama hasn't paid me'", () => {
    const r = n("Ama no gree pay");
    expect(r.toLowerCase()).toContain("paid");
  });

  test("name is preserved in pidgin negation", () => {
    const r = n("Kwame no pay me");
    expect(r).toContain("Kwame");
  });
});

// ─── Stock intake ─────────────────────────────────────────────────────────────

describe("Normalizer › Stock Intake (I have N units)", () => {
  const unitCases: [string, number][] = [
    ["I have 10 bags of rice", 10],
    ["I have 50 pcs of gloves", 50],
    ["I have 3 cartons of drinks", 3],
    ["I have 100 bottles of water", 100],
  ];

  unitCases.forEach(([input, qty]) => {
    test(`"${input}" → recognized as stock receipt`, () => {
      const r = n(input);
      expect(r.toLowerCase()).toContain("received");
      expect(r).toContain(String(qty));
    });
  });

  test("amount not corrupted when it appears after the unit phrase", () => {
    const r = n("I have 10 bags of rice worth 200");
    expect(r).toContain("200");
  });
});

// ─── Discount ────────────────────────────────────────────────────────────────

describe("Normalizer › Discount", () => {
  test("'gave discount 10 cedis' → 'expense discount 10'", () => {
    const r = n("gave discount 10 cedis");
    expect(r.toLowerCase()).toContain("expense");
    expect(r).toContain("10");
  });

  test("amount in discount preserved", () => {
    expect(n("gave a discount of 25")).toContain("25");
  });
});

// ─── Pidgin queries ───────────────────────────────────────────────────────────

describe("Normalizer › Pidgin Query Normalization", () => {
  test("'wetin i get today' → 'what I have today'", () => {
    const r = n("wetin i get today");
    expect(r.toLowerCase()).toContain("what");
    expect(r.toLowerCase()).toContain("have");
  });

  test("'how e dey' → 'how is it'", () => {
    expect(n("how e dey").toLowerCase()).toContain("how is it");
  });

  test("'my cash don finish' → 'my cash is finished'", () => {
    const r = n("my cash don finish");
    expect(r.toLowerCase()).toContain("finished");
  });

  test("'I wan check my money' → balance query", () => {
    const r = n("I wan check my money");
    expect(r.toLowerCase()).toContain("balance");
  });
});

// ─── Multi-intent implicit conjunction ────────────────────────────────────────

describe("Normalizer › Implicit Multi-Intent Conjunction", () => {
  test("'sold rice 100 bought fuel 20' → adds 'and' between transactions", () => {
    const r = n("sold rice 100 bought fuel 20");
    expect(r.toLowerCase()).toContain("and bought");
    expect(r).toContain("100");
    expect(r).toContain("20");
  });

  test("3-way transaction chain gets 2 conjunctions", () => {
    const r = n("sold rice 100 bought fuel 20 paid worker 30");
    const andCount = (r.match(/\band\b/gi) ?? []).length;
    expect(andCount).toBeGreaterThanOrEqual(2);
    expect(r).toContain("100");
    expect(r).toContain("20");
    expect(r).toContain("30");
  });

  test("normal text with number is not incorrectly split", () => {
    // "paid 100 for rice" — 'for' is not a financial verb
    const r = n("paid 100 for rice");
    expect(r).not.toContain("and for");
  });

  test("amounts preserved exactly through conjunction insertion", () => {
    const r = n("sold goods 999 bought materials 888");
    expect(r).toContain("999");
    expect(r).toContain("888");
  });
});

// ─── Safety: rules must not corrupt numbers or names ─────────────────────────

describe("Normalizer › Amount / Name Safety", () => {
  const criticalInputs = [
    "Ama paid 500",
    "sold rice 1234.56",
    "Kofi owes me 99999",
    "received 7 bags of flour",
    "expense electricity 450",
  ];

  criticalInputs.forEach((input) => {
    test(`amounts/names intact: "${input}"`, () => {
      const r = n(input);
      // Extract all numbers from input and confirm they appear in output
      const nums = input.match(/\d+(?:\.\d+)?/g) ?? [];
      nums.forEach((num) => {
        expect(r).toContain(num);
      });
    });
  });
});
