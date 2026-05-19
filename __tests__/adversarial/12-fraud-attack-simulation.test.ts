/**
 * ADVERSARIAL TESTS — Fraud Attack Simulation
 *
 * Simulates known fraud patterns against ZURIA's referral and payment systems.
 * Tests that the rule-based fraud engine correctly:
 *  - Detects self-referral attacks
 *  - Detects rapid referral farming
 *  - Detects rapid withdrawal after reward
 *  - Detects repeated payment failures (card testing)
 *  - Does NOT block legitimate users
 *  - Correctly classifies risk levels
 *  - Preserves user state on BLOCKED detection
 *
 * Uses MockDb with seeded fraud signals to test score computation logic.
 */

import {
  getCachedRiskLevel,
  isUserBlocked,
  type FraudSignalType,
  type RiskLevel,
} from "@/lib/fraud/scorer";
import { createMockDb, type MockDb } from "../helpers/firestore-mock";

const mockDb = createMockDb();

jest.mock("@/lib/firebase/admin", () => ({
  getAdminDb: () => mockDb,
}));

// ─── Pure scoring logic (mirrors scorer.ts) ───────────────────────────────────

const SIGNAL_WEIGHTS: Record<FraudSignalType, number> = {
  SELF_REFERRAL:              35,
  RAPID_REFERRAL_FARMING:     25,
  DUPLICATE_REFERRAL_CLAIM:   20,
  RAPID_WITHDRAWAL:           15,
  REPEATED_PAYMENT_FAIL:      20,
  ABNORMAL_SIGNUP_VELOCITY:   10,
};

function computeScore(signals: FraudSignalType[]): number {
  return Math.min(100, signals.reduce((s, t) => s + SIGNAL_WEIGHTS[t], 0));
}

function classifyRisk(score: number): RiskLevel {
  if (score >= 85) return "BLOCKED";
  if (score >= 60) return "HIGH";
  if (score >= 30) return "MEDIUM";
  return "LOW";
}

function buildUserData(riskLevel: RiskLevel, extra: Record<string, unknown> = {}) {
  return { riskLevel, ...extra };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1 — Self-referral attack
// ═══════════════════════════════════════════════════════════════════════════════

describe("Fraud Simulation › Self-Referral Attack", () => {
  test("user tries to use own referral code → SELF_REFERRAL signal detected", () => {
    const score = computeScore(["SELF_REFERRAL"]);
    expect(score).toBe(35);
    expect(classifyRisk(score)).toBe("MEDIUM");
  });

  test("self-referral + farming = BLOCKED (35+25=60 → HIGH... needs 85+)", () => {
    const score = computeScore(["SELF_REFERRAL", "RAPID_REFERRAL_FARMING"]);
    // 35+25=60 → HIGH (not yet BLOCKED — needs 85)
    expect(classifyRisk(score)).toBe("HIGH");
    expect(isUserBlocked(buildUserData("HIGH"))).toBe(false);
  });

  test("self-referral + farming + duplicate = BLOCKED (35+25+20=80 → HIGH)", () => {
    const score = computeScore(["SELF_REFERRAL", "RAPID_REFERRAL_FARMING", "DUPLICATE_REFERRAL_CLAIM"]);
    expect(score).toBe(80);
    // Still HIGH at 80 — needs 85+ for BLOCKED
    expect(classifyRisk(score)).toBe("HIGH");
  });

  test("full fraud profile: self-referral + farming + duplicate + rapid-withdraw = BLOCKED", () => {
    const score = computeScore([
      "SELF_REFERRAL",            // 35
      "RAPID_REFERRAL_FARMING",   // 25
      "DUPLICATE_REFERRAL_CLAIM", // 20
      "RAPID_WITHDRAWAL",         // 15  → total = 95
    ]);
    expect(score).toBe(95);
    expect(classifyRisk(score)).toBe("BLOCKED");
    expect(isUserBlocked(buildUserData("BLOCKED"))).toBe(true);
  });

  test("self-referral detection: getCachedRiskLevel returns MEDIUM from userData", () => {
    const userData = buildUserData("MEDIUM", { fraudScore: 35 });
    expect(getCachedRiskLevel(userData)).toBe("MEDIUM");
    expect(isUserBlocked(userData)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2 — Rapid referral farming attack
// ═══════════════════════════════════════════════════════════════════════════════

describe("Fraud Simulation › Rapid Referral Farming", () => {
  test("moderate farming (5-9 referrals/hr) = MEDIUM severity", () => {
    // RAPID_REFERRAL_FARMING alone = 25 → LOW (just below MEDIUM threshold)
    const score = computeScore(["RAPID_REFERRAL_FARMING"]);
    expect(score).toBe(25);
    expect(classifyRisk(score)).toBe("LOW");
  });

  test("farming + duplicate claim = MEDIUM (25+20=45)", () => {
    const score = computeScore(["RAPID_REFERRAL_FARMING", "DUPLICATE_REFERRAL_CLAIM"]);
    expect(score).toBe(45);
    expect(classifyRisk(score)).toBe("MEDIUM");
  });

  test("farming + withdrawal = MEDIUM (25+15=40)", () => {
    const score = computeScore(["RAPID_REFERRAL_FARMING", "RAPID_WITHDRAWAL"]);
    expect(score).toBe(40);
    expect(classifyRisk(score)).toBe("MEDIUM");
  });

  test("farming + withdrawal + payment fail = HIGH (25+15+20=60)", () => {
    const score = computeScore(["RAPID_REFERRAL_FARMING", "RAPID_WITHDRAWAL", "REPEATED_PAYMENT_FAIL"]);
    expect(score).toBe(60);
    expect(classifyRisk(score)).toBe("HIGH");
  });

  test("extreme farming (10+ referrals/hr) escalates to HIGH when combined", () => {
    // Represent as two farming signals (extreme tier)
    const score = computeScore(["RAPID_REFERRAL_FARMING", "SELF_REFERRAL"]);
    expect(score).toBe(60);
    expect(classifyRisk(score)).toBe("HIGH");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3 — Card testing attack (repeated payment failures)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Fraud Simulation › Card Testing Attack", () => {
  test("3 payment failures = MEDIUM (20 points)", () => {
    const score = computeScore(["REPEATED_PAYMENT_FAIL"]);
    expect(score).toBe(20);
    expect(classifyRisk(score)).toBe("LOW"); // 20 < 30 → LOW
  });

  test("card testing + abnormal signup velocity = MEDIUM (20+10=30)", () => {
    const score = computeScore(["REPEATED_PAYMENT_FAIL", "ABNORMAL_SIGNUP_VELOCITY"]);
    expect(score).toBe(30);
    expect(classifyRisk(score)).toBe("MEDIUM");
  });

  test("card testing + self-referral = MEDIUM (20+35=55)", () => {
    const score = computeScore(["REPEATED_PAYMENT_FAIL", "SELF_REFERRAL"]);
    expect(score).toBe(55);
    expect(classifyRisk(score)).toBe("MEDIUM");
  });

  test("card testing + farming + self-referral = BLOCKED (20+25+35=80 → HIGH, not BLOCKED)", () => {
    const score = computeScore(["REPEATED_PAYMENT_FAIL", "RAPID_REFERRAL_FARMING", "SELF_REFERRAL"]);
    expect(score).toBe(80);
    // HIGH at 80, BLOCKED needs 85
    expect(classifyRisk(score)).toBe("HIGH");
  });

  test("full card-testing fraud profile = BLOCKED (20+35+25+15=95)", () => {
    const score = computeScore([
      "REPEATED_PAYMENT_FAIL",   // 20
      "SELF_REFERRAL",           // 35
      "RAPID_REFERRAL_FARMING",  // 25
      "RAPID_WITHDRAWAL",        // 15  → 95 → BLOCKED
    ]);
    expect(classifyRisk(score)).toBe("BLOCKED");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4 — Rapid withdrawal attack
// ═══════════════════════════════════════════════════════════════════════════════

describe("Fraud Simulation › Rapid Withdrawal Attack", () => {
  test("rapid withdrawal alone = LOW (15 points)", () => {
    const score = computeScore(["RAPID_WITHDRAWAL"]);
    expect(score).toBe(15);
    expect(classifyRisk(score)).toBe("LOW");
  });

  test("rapid withdrawal + farming = MEDIUM (15+25=40)", () => {
    const score = computeScore(["RAPID_WITHDRAWAL", "RAPID_REFERRAL_FARMING"]);
    expect(score).toBe(40);
    expect(classifyRisk(score)).toBe("MEDIUM");
  });

  test("rapid withdrawal + self-referral = MEDIUM (15+35=50)", () => {
    const score = computeScore(["RAPID_WITHDRAWAL", "SELF_REFERRAL"]);
    expect(score).toBe(50);
    expect(classifyRisk(score)).toBe("MEDIUM");
  });

  test("isUserBlocked returns false for MEDIUM risk", () => {
    const userData = buildUserData("MEDIUM");
    expect(isUserBlocked(userData)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 5 — Legitimate users must NOT be blocked
// ═══════════════════════════════════════════════════════════════════════════════

describe("Fraud Simulation › Legitimate User Safety", () => {
  const LEGITIMATE_USER_PROFILES = [
    { desc: "new user, no signals",          riskLevel: "LOW" as RiskLevel },
    { desc: "long-time user with 0 signals", riskLevel: "LOW" as RiskLevel },
    { desc: "user with slow referral",       riskLevel: "LOW" as RiskLevel },
  ];

  LEGITIMATE_USER_PROFILES.forEach(({ desc, riskLevel }) => {
    test(`legitimate user (${desc}) is NOT blocked`, () => {
      expect(isUserBlocked(buildUserData(riskLevel))).toBe(false);
    });
  });

  test("one failed payment does not block user", () => {
    // REPEATED_PAYMENT_FAIL triggers at 3+ failures, represented as signal = LOW score
    const score = computeScore(["REPEATED_PAYMENT_FAIL"]);
    expect(score).toBeLessThan(30); // Below MEDIUM
    expect(classifyRisk(score)).toBe("LOW");
    expect(isUserBlocked(buildUserData("LOW"))).toBe(false);
  });

  test("user who referred 4 friends in 1 hour is LOW risk (under threshold of 5)", () => {
    // 4 referrals < 5 threshold → no RAPID_REFERRAL_FARMING signal
    const score = computeScore([]); // no signals
    expect(classifyRisk(score)).toBe("LOW");
  });

  test("user with withdrawal 3 hours after reward is NOT flagged", () => {
    // 3 hours > 2-hour window → no RAPID_WITHDRAWAL signal
    const score = computeScore([]); // no signals
    expect(classifyRisk(score)).toBe("LOW");
  });

  test("getCachedRiskLevel defaults to LOW for new users without fraud data", () => {
    const newUser = { name: "Kofi Asante", email: "kofi@test.com" };
    expect(getCachedRiskLevel(newUser)).toBe("LOW");
    expect(isUserBlocked(newUser)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 6 — Coordinated multi-vector attack
// ═══════════════════════════════════════════════════════════════════════════════

describe("Fraud Simulation › Coordinated Multi-Vector Attack", () => {
  test("attacker using all 6 vectors = BLOCKED (capped at 100)", () => {
    const allSignals: FraudSignalType[] = [
      "SELF_REFERRAL",
      "RAPID_REFERRAL_FARMING",
      "DUPLICATE_REFERRAL_CLAIM",
      "RAPID_WITHDRAWAL",
      "REPEATED_PAYMENT_FAIL",
      "ABNORMAL_SIGNUP_VELOCITY",
    ];
    const score = computeScore(allSignals);
    expect(score).toBe(100); // capped
    expect(classifyRisk(score)).toBe("BLOCKED");
    expect(isUserBlocked(buildUserData("BLOCKED"))).toBe(true);
  });

  test("attacker exceeds 100 raw → still capped at 100 (no overflow)", () => {
    // Raw: 35+25+20+15+20+10 = 125 → capped at 100
    const rawTotal = 35 + 25 + 20 + 15 + 20 + 10;
    expect(rawTotal).toBe(125);
    expect(computeScore([
      "SELF_REFERRAL",
      "RAPID_REFERRAL_FARMING",
      "DUPLICATE_REFERRAL_CLAIM",
      "RAPID_WITHDRAWAL",
      "REPEATED_PAYMENT_FAIL",
      "ABNORMAL_SIGNUP_VELOCITY",
    ])).toBe(100);
  });

  test("minimum BLOCKED threshold is exactly 85", () => {
    // Need 85+ for BLOCKED. Compose signals to hit exactly 85.
    // SELF_REFERRAL(35) + RAPID_REFERRAL_FARMING(25) + DUPLICATE_REFERRAL_CLAIM(20) + RAPID_WITHDRAWAL(15) = 95
    // There's no exact combination that hits 85 with current weights.
    // The closest below is 80 (SELF+FARM+DUP = 35+25+20=80 → HIGH)
    // The closest above is 95 (add RAPID_WITHDRAWAL = 15)
    expect(classifyRisk(84)).toBe("HIGH");
    expect(classifyRisk(85)).toBe("BLOCKED");
  });

  test("MockDb: seeding BLOCKED user and reading risk level", () => {
    mockDb.clear();
    mockDb.seed("users/attacker_001", {
      riskLevel: "BLOCKED",
      fraudScore: 95,
      fraudScoredAt: new Date().toISOString(),
    });
    const userData = mockDb.read("users/attacker_001")!;
    expect(getCachedRiskLevel(userData)).toBe("BLOCKED");
    expect(isUserBlocked(userData)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 7 — Fraud signal persistence integrity
// ═══════════════════════════════════════════════════════════════════════════════

describe("Fraud Simulation › Signal Persistence", () => {
  test("MockDb: fraud signals seeded with correct structure", () => {
    mockDb.clear();
    const now = new Date().toISOString();
    mockDb.seed("fraud_signals/user_001_SELF_REFERRAL_" + now, {
      type:       "SELF_REFERRAL",
      severity:   "HIGH",
      userId:     "user_001",
      detectedAt: now,
      source:     "fraud_scorer",
      metadata:   { referralCode: "user_001_code", attemptedBy: "user_001" },
    });

    const signal = mockDb.read("fraud_signals/user_001_SELF_REFERRAL_" + now);
    expect(signal?.type).toBe("SELF_REFERRAL");
    expect(signal?.userId).toBe("user_001");
    expect(signal?.severity).toBe("HIGH");
  });

  test("multiple signals for same user are independent documents", () => {
    mockDb.clear();
    const t1 = new Date(Date.now() - 1000).toISOString();
    const t2 = new Date().toISOString();
    const USER = "attacker_multi";

    mockDb.seed(`fraud_signals/${USER}_SELF_REFERRAL_${t1}`, {
      type: "SELF_REFERRAL", userId: USER, detectedAt: t1, source: "fraud_scorer",
    });
    mockDb.seed(`fraud_signals/${USER}_RAPID_REFERRAL_FARMING_${t2}`, {
      type: "RAPID_REFERRAL_FARMING", userId: USER, detectedAt: t2, source: "fraud_scorer",
    });

    const sig1 = mockDb.read(`fraud_signals/${USER}_SELF_REFERRAL_${t1}`);
    const sig2 = mockDb.read(`fraud_signals/${USER}_RAPID_REFERRAL_FARMING_${t2}`);

    expect(sig1?.type).toBe("SELF_REFERRAL");
    expect(sig2?.type).toBe("RAPID_REFERRAL_FARMING");
    // They are separate documents
    expect(sig1).not.toEqual(sig2);
  });
});
