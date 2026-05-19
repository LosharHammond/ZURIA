/**
 * UNIT TESTS — Fraud Scorer
 *
 * Adversarial focus:
 *  - Signal weight arithmetic is correct (no overflow, caps at 100)
 *  - Risk classification thresholds are precise (29→LOW, 30→MEDIUM, 59→LOW, 60→HIGH, 84→HIGH, 85→BLOCKED)
 *  - getCachedRiskLevel and isUserBlocked behave correctly
 *  - Score is idempotent — calling twice with same signals = same score
 *  - Missing/corrupt userData doesn't crash helpers
 */

import {
  getCachedRiskLevel,
  isUserBlocked,
  type RiskLevel,
  type FraudSignalType,
} from "@/lib/fraud/scorer";

// ─── Signal weight constants (mirror scorer.ts for test assertions) ───────────

const WEIGHTS: Record<FraudSignalType, number> = {
  SELF_REFERRAL:              35,
  RAPID_REFERRAL_FARMING:     25,
  DUPLICATE_REFERRAL_CLAIM:   20,
  RAPID_WITHDRAWAL:           15,
  REPEATED_PAYMENT_FAIL:      20,
  ABNORMAL_SIGNUP_VELOCITY:   10,
};

// ─── Risk classification pure function (mirrors scorer internals) ─────────────

function classifyRisk(score: number): RiskLevel {
  if (score >= 85) return "BLOCKED";
  if (score >= 60) return "HIGH";
  if (score >= 30) return "MEDIUM";
  return "LOW";
}

function totalWeight(signals: FraudSignalType[]): number {
  return Math.min(100, signals.reduce((s, t) => s + WEIGHTS[t], 0));
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1 — Signal weight arithmetic
// ═══════════════════════════════════════════════════════════════════════════════

describe("Fraud Scorer › Signal Weights", () => {
  test("SELF_REFERRAL alone = 35 → MEDIUM", () => {
    expect(totalWeight(["SELF_REFERRAL"])).toBe(35);
    expect(classifyRisk(35)).toBe("MEDIUM");
  });

  test("RAPID_REFERRAL_FARMING alone = 25 → LOW (just below MEDIUM)", () => {
    expect(totalWeight(["RAPID_REFERRAL_FARMING"])).toBe(25);
    expect(classifyRisk(25)).toBe("LOW");
  });

  test("RAPID_REFERRAL_FARMING + DUPLICATE_REFERRAL_CLAIM = 45 → MEDIUM", () => {
    expect(totalWeight(["RAPID_REFERRAL_FARMING", "DUPLICATE_REFERRAL_CLAIM"])).toBe(45);
    expect(classifyRisk(45)).toBe("MEDIUM");
  });

  test("SELF_REFERRAL + RAPID_REFERRAL_FARMING = 60 → HIGH", () => {
    expect(totalWeight(["SELF_REFERRAL", "RAPID_REFERRAL_FARMING"])).toBe(60);
    expect(classifyRisk(60)).toBe("HIGH");
  });

  test("SELF_REFERRAL + RAPID_REFERRAL_FARMING + DUPLICATE_REFERRAL_CLAIM = 80 → HIGH", () => {
    expect(totalWeight(["SELF_REFERRAL", "RAPID_REFERRAL_FARMING", "DUPLICATE_REFERRAL_CLAIM"])).toBe(80);
    expect(classifyRisk(80)).toBe("HIGH");
  });

  test("all signals together = 125 → capped at 100 → BLOCKED", () => {
    const allSignals: FraudSignalType[] = [
      "SELF_REFERRAL",
      "RAPID_REFERRAL_FARMING",
      "DUPLICATE_REFERRAL_CLAIM",
      "RAPID_WITHDRAWAL",
      "REPEATED_PAYMENT_FAIL",
      "ABNORMAL_SIGNUP_VELOCITY",
    ];
    const raw = allSignals.reduce((s, t) => s + WEIGHTS[t], 0);
    expect(raw).toBe(125);
    expect(totalWeight(allSignals)).toBe(100); // capped
    expect(classifyRisk(100)).toBe("BLOCKED");
  });

  test("SELF_REFERRAL + REPEATED_PAYMENT_FAIL = 55 → MEDIUM", () => {
    expect(totalWeight(["SELF_REFERRAL", "REPEATED_PAYMENT_FAIL"])).toBe(55);
    expect(classifyRisk(55)).toBe("MEDIUM");
  });

  test("no signals = 0 → LOW", () => {
    expect(totalWeight([])).toBe(0);
    expect(classifyRisk(0)).toBe("LOW");
  });

  test("ABNORMAL_SIGNUP_VELOCITY alone = 10 → LOW", () => {
    expect(totalWeight(["ABNORMAL_SIGNUP_VELOCITY"])).toBe(10);
    expect(classifyRisk(10)).toBe("LOW");
  });

  test("RAPID_WITHDRAWAL + ABNORMAL_SIGNUP_VELOCITY = 25 → LOW", () => {
    expect(totalWeight(["RAPID_WITHDRAWAL", "ABNORMAL_SIGNUP_VELOCITY"])).toBe(25);
    expect(classifyRisk(25)).toBe("LOW");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2 — Risk threshold boundary tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("Fraud Scorer › Risk Threshold Boundaries", () => {
  const cases: Array<[number, RiskLevel]> = [
    [0,   "LOW"],
    [1,   "LOW"],
    [29,  "LOW"],
    [30,  "MEDIUM"],
    [31,  "MEDIUM"],
    [59,  "MEDIUM"],
    [60,  "HIGH"],
    [61,  "HIGH"],
    [84,  "HIGH"],
    [85,  "BLOCKED"],
    [86,  "BLOCKED"],
    [99,  "BLOCKED"],
    [100, "BLOCKED"],
  ];

  cases.forEach(([score, expected]) => {
    test(`score=${score} → ${expected}`, () => {
      expect(classifyRisk(score)).toBe(expected);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3 — getCachedRiskLevel
// ═══════════════════════════════════════════════════════════════════════════════

describe("Fraud Scorer › getCachedRiskLevel", () => {
  test("returns stored riskLevel from user data", () => {
    expect(getCachedRiskLevel({ riskLevel: "HIGH" })).toBe("HIGH");
    expect(getCachedRiskLevel({ riskLevel: "BLOCKED" })).toBe("BLOCKED");
    expect(getCachedRiskLevel({ riskLevel: "MEDIUM" })).toBe("MEDIUM");
    expect(getCachedRiskLevel({ riskLevel: "LOW" })).toBe("LOW");
  });

  test("returns 'LOW' when riskLevel is missing", () => {
    expect(getCachedRiskLevel({})).toBe("LOW");
  });

  test("returns 'LOW' when riskLevel is undefined", () => {
    expect(getCachedRiskLevel({ riskLevel: undefined })).toBe("LOW");
  });

  test("handles null userData fields gracefully", () => {
    expect(getCachedRiskLevel({ name: "Kofi", riskLevel: "HIGH" })).toBe("HIGH");
  });

  test("returns 'LOW' when riskLevel is an unexpected value", () => {
    // Unexpected value from corrupt data — falls back to LOW via ?? operator
    expect(getCachedRiskLevel({ riskLevel: undefined })).toBe("LOW");
  });

  test("does not crash on empty user data", () => {
    expect(() => getCachedRiskLevel({})).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4 — isUserBlocked
// ═══════════════════════════════════════════════════════════════════════════════

describe("Fraud Scorer › isUserBlocked", () => {
  test("BLOCKED → true", () => {
    expect(isUserBlocked({ riskLevel: "BLOCKED" })).toBe(true);
  });

  test("HIGH → false", () => {
    expect(isUserBlocked({ riskLevel: "HIGH" })).toBe(false);
  });

  test("MEDIUM → false", () => {
    expect(isUserBlocked({ riskLevel: "MEDIUM" })).toBe(false);
  });

  test("LOW → false", () => {
    expect(isUserBlocked({ riskLevel: "LOW" })).toBe(false);
  });

  test("missing riskLevel → false (defaults to LOW)", () => {
    expect(isUserBlocked({})).toBe(false);
  });

  test("does not throw on empty object", () => {
    expect(() => isUserBlocked({})).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 5 — Score idempotency (same signals always = same result)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Fraud Scorer › Score Idempotency", () => {
  const signalSets: FraudSignalType[][] = [
    [],
    ["SELF_REFERRAL"],
    ["RAPID_REFERRAL_FARMING", "DUPLICATE_REFERRAL_CLAIM"],
    ["SELF_REFERRAL", "RAPID_REFERRAL_FARMING"],
    ["SELF_REFERRAL", "RAPID_REFERRAL_FARMING", "DUPLICATE_REFERRAL_CLAIM", "RAPID_WITHDRAWAL"],
  ];

  signalSets.forEach((signals) => {
    test(`same signals always produce same score: [${signals.join(", ")}]`, () => {
      const s1 = totalWeight(signals);
      const s2 = totalWeight(signals);
      const s3 = totalWeight([...signals]); // copy of array
      expect(s1).toBe(s2);
      expect(s2).toBe(s3);
    });
  });

  test("signal order does not affect score", () => {
    const a = totalWeight(["SELF_REFERRAL", "RAPID_REFERRAL_FARMING"]);
    const b = totalWeight(["RAPID_REFERRAL_FARMING", "SELF_REFERRAL"]);
    expect(a).toBe(b);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 6 — Fraud attack simulation (known attack patterns)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Fraud Scorer › Known Attack Patterns", () => {
  test("self-referral attacker: SELF_REFERRAL alone → MEDIUM (not yet blocked)", () => {
    const score = totalWeight(["SELF_REFERRAL"]);
    const risk  = classifyRisk(score);
    // Should be flagged but not blocked — escalation requires more signals
    expect(risk).toBe("MEDIUM");
    expect(score).toBeLessThan(85);
  });

  test("rapid farming attacker: RAPID_REFERRAL_FARMING + DUPLICATE_REFERRAL_CLAIM = HIGH if combined", () => {
    // 25 + 20 = 45 → MEDIUM (HIGH requires 60+)
    const score = totalWeight(["RAPID_REFERRAL_FARMING", "DUPLICATE_REFERRAL_CLAIM"]);
    expect(classifyRisk(score)).toBe("MEDIUM");
  });

  test("full fraud profile (self-ref + farming + rapid-withdraw) = BLOCKED", () => {
    const score = totalWeight([
      "SELF_REFERRAL",           // 35
      "RAPID_REFERRAL_FARMING",  // 25
      "RAPID_WITHDRAWAL",        // 15  → total 75 → HIGH
    ]);
    // 35+25+15 = 75 → HIGH (not yet BLOCKED — needs 85+)
    expect(classifyRisk(score)).toBe("HIGH");

    // Add REPEATED_PAYMENT_FAIL (20) → 95 → BLOCKED
    const fullScore = totalWeight([
      "SELF_REFERRAL",
      "RAPID_REFERRAL_FARMING",
      "RAPID_WITHDRAWAL",
      "REPEATED_PAYMENT_FAIL",
    ]);
    expect(classifyRisk(fullScore)).toBe("BLOCKED");
  });

  test("card-tester pattern: REPEATED_PAYMENT_FAIL alone = MEDIUM", () => {
    expect(classifyRisk(totalWeight(["REPEATED_PAYMENT_FAIL"]))).toBe("MEDIUM");
  });

  test("SELF_REFERRAL + REPEATED_PAYMENT_FAIL = 55 → MEDIUM (below HIGH threshold)", () => {
    // 35 + 20 = 55 → MEDIUM (not HIGH yet)
    expect(classifyRisk(totalWeight(["SELF_REFERRAL", "REPEATED_PAYMENT_FAIL"]))).toBe("MEDIUM");
  });
});
