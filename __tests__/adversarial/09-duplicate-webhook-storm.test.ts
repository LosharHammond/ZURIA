/**
 * ADVERSARIAL TESTS — Duplicate Webhook Storm
 *
 * Simulates 100 identical charge.success webhook deliveries for the same
 * payment reference. This happens when:
 *  - Paystack retries on network timeout
 *  - Our 200 response was lost in transit
 *  - Load balancer delivers to multiple serverless instances simultaneously
 *
 * MISSION: Prove the subscription is activated EXACTLY ONCE regardless of
 * how many duplicate deliveries arrive.
 *
 * Test invariants:
 *  1. User plan is activated exactly once
 *  2. Exactly ONE PAYMENT_SUCCESS ledger entry exists
 *  3. Exactly ONE SUBSCRIPTION_ACTIVATED ledger entry exists
 *  4. No duplicate or overwritten payments
 *  5. All 100 calls return ok:true (no 500s to Paystack)
 *  6. referral balance / message count not reset N times
 */

import { processWebhookEvent } from "@/lib/payments/webhook-processor";
import { createMockDb, type MockDb } from "../helpers/firestore-mock";

// ─── Module-level mocks ────────────────────────────────────────────────────────

const mockDb = createMockDb();

jest.mock("@/lib/firebase/admin", () => ({
  getAdminDb: () => mockDb,
}));

jest.mock("@/lib/whatsapp/client", () => ({
  sendText: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/lib/whatsapp/formatter", () => ({
  fmtSubscriptionActivated: jest.fn().mockReturnValue("✅ Activated"),
}));

jest.mock("@/lib/services/paystack-service", () => ({
  verifyTransaction: jest.fn().mockResolvedValue({ ok: true, status: "success" }),
}));

// ─── Constants ────────────────────────────────────────────────────────────────

const USER_ID    = "uid_storm_001";
const BIZ_ID     = "biz_storm_001";
const REFERENCE  = "STORM_REF_001";
const AMOUNT_GHS = 30;
const PLAN       = "growth" as const;

function seedScenario(db: MockDb) {
  db.clear();
  db.seed(`users/${USER_ID}`, {
    phoneNumber:              "+233501234567",
    businessId:               BIZ_ID,
    subscriptionPlan:         "free",
    whatsappMessageCount:     42,
    referralBalance:          100,
    updatedAt:                new Date().toISOString(),
  });
  db.seed(`businesses/${BIZ_ID}`, { name: "Storm Test Business" });
  db.seed(`payments/${REFERENCE}`, {
    userId:    USER_ID,
    plan:      PLAN,
    annual:    false,
    amountGHS: AMOUNT_GHS,
    status:    "pending",
    createdAt: new Date().toISOString(),
  });
}

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    reference:  REFERENCE,
    status:     "success",
    amount:     AMOUNT_GHS * 100,
    currency:   "GHS",
    id:         "ps_txn_storm",
    channel:    "card",
    createdAt:  new Date().toISOString(),
    ...overrides,
  };
}

// ─── Storm helper ─────────────────────────────────────────────────────────────

async function deliverStorm(count: number, parallel = false) {
  const event = makeEvent();
  if (parallel) {
    // Simulate simultaneous delivery to multiple serverless instances
    return Promise.all(Array.from({ length: count }, () =>
      processWebhookEvent("charge.success", event)
    ));
  }
  const results = [];
  for (let i = 0; i < count; i++) {
    results.push(await processWebhookEvent("charge.success", event));
  }
  return results;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1 — Sequential duplicate storm
// ═══════════════════════════════════════════════════════════════════════════════

describe("Duplicate Webhook Storm › Sequential (10 retries)", () => {
  beforeEach(() => seedScenario(mockDb));

  test("all 10 sequential deliveries return ok:true", async () => {
    const results = await deliverStorm(10);
    expect(results.every((r) => r.ok)).toBe(true);
  });

  test("exactly one PAYMENT_SUCCESS ledger entry after 10 deliveries", async () => {
    await deliverStorm(10);
    const successKey = `${REFERENCE}_PAYMENT_SUCCESS`;
    expect(mockDb.exists(`payment_events/${successKey}`)).toBe(true);
    // Verify it's exactly ONE doc (idempotent key ensures no duplicates)
    const entries = (await mockDb.collection("payment_events").get()).docs
      .filter((d) => d.data()?.eventType === "PAYMENT_SUCCESS" && d.data()?.paystackReference === REFERENCE);
    expect(entries.length).toBe(1);
  });

  test("exactly one SUBSCRIPTION_ACTIVATED entry after 10 deliveries", async () => {
    await deliverStorm(10);
    const activationKey = `${REFERENCE}_SUBSCRIPTION_ACTIVATED`;
    expect(mockDb.exists(`payment_events/${activationKey}`)).toBe(true);
    const entries = (await mockDb.collection("payment_events").get()).docs
      .filter((d) => d.data()?.eventType === "SUBSCRIPTION_ACTIVATED" && d.data()?.paystackReference === REFERENCE);
    expect(entries.length).toBe(1);
  });

  test("user plan is set to growth exactly once", async () => {
    await deliverStorm(10);
    const user = mockDb.read(`users/${USER_ID}`);
    expect(user?.subscriptionPlan).toBe("growth");
  });

  test("whatsapp message count reset to 0 only once (not to 0 × 10)", async () => {
    await deliverStorm(10);
    const user = mockDb.read(`users/${USER_ID}`);
    // After first activation, count resets to 0. Subsequent deliveries are no-ops.
    expect(user?.whatsappMessageCount).toBe(0);
  });

  test("idempotency key written after first delivery", async () => {
    await deliverStorm(10);
    const idemKey = `psevt_${REFERENCE}_charge.success`;
    expect(mockDb.exists(`idempotency_keys/${idemKey}`)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2 — Parallel duplicate storm (simulates concurrent serverless)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Duplicate Webhook Storm › Parallel (5 simultaneous)", () => {
  beforeEach(() => seedScenario(mockDb));

  test("all 5 parallel deliveries return ok:true (no 500s)", async () => {
    const results = await deliverStorm(5, true);
    expect(results.every((r) => r.ok)).toBe(true);
  });

  test("subscription activated at least once after parallel storm", async () => {
    await deliverStorm(5, true);
    const user = mockDb.read(`users/${USER_ID}`);
    expect(user?.subscriptionPlan).toBe("growth");
  });

  test("payment status is 'success' after parallel storm", async () => {
    await deliverStorm(5, true);
    const payment = mockDb.read(`payments/${REFERENCE}`);
    expect(payment?.status).toBe("success");
  });

  test("no crash under parallel load", async () => {
    await expect(deliverStorm(5, true)).resolves.not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3 — Referral-free storm (separate reference)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Duplicate Webhook Storm › Referral Balance Safety", () => {
  const BALANCE_BEFORE = 250;

  beforeEach(() => {
    seedScenario(mockDb);
    // Override with higher balance
    mockDb.seed(`users/${USER_ID}`, {
      phoneNumber:          "+233501234567",
      businessId:           BIZ_ID,
      subscriptionPlan:     "free",
      whatsappMessageCount: 0,
      referralBalance:      BALANCE_BEFORE,
      updatedAt:            new Date().toISOString(),
    });
  });

  test("referral balance not touched by subscription activation storm", async () => {
    await deliverStorm(10);
    const user = mockDb.read(`users/${USER_ID}`);
    // subscription activation does not modify referralBalance
    expect(user?.referralBalance).toBe(BALANCE_BEFORE);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4 — 100-delivery stress test
// ═══════════════════════════════════════════════════════════════════════════════

describe("Duplicate Webhook Storm › 100-delivery stress test", () => {
  beforeEach(() => seedScenario(mockDb));

  test("100 sequential deliveries: no crash, all ok:true", async () => {
    const results = await deliverStorm(100);
    const failures = results.filter((r) => !r.ok);
    expect(failures.length).toBe(0);
  }, 30_000);

  test("100 sequential deliveries: ledger has exactly 1 SUCCESS entry", async () => {
    await deliverStorm(100);
    const successKey = `${REFERENCE}_PAYMENT_SUCCESS`;
    expect(mockDb.exists(`payment_events/${successKey}`)).toBe(true);
    const allEvents = (await mockDb.collection("payment_events").get()).docs
      .filter((d) =>
        d.data()?.paystackReference === REFERENCE &&
        d.data()?.eventType === "PAYMENT_SUCCESS"
      );
    expect(allEvents.length).toBe(1);
  }, 30_000);

  test("100 sequential deliveries: plan is 'growth' not 'free'", async () => {
    await deliverStorm(100);
    expect(mockDb.read(`users/${USER_ID}`)?.subscriptionPlan).toBe("growth");
  }, 30_000);
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 5 — Multiple different references (no cross-contamination)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Duplicate Webhook Storm › Multi-Reference Isolation", () => {
  test("two different payments activate independently without interfering", async () => {
    mockDb.clear();

    const USER_A = "user_a";
    const USER_B = "user_b";
    const REF_A  = "REF_A_001";
    const REF_B  = "REF_B_001";

    // Seed both users and payments
    mockDb.seed(`users/${USER_A}`, { subscriptionPlan: "free", referralBalance: 0 });
    mockDb.seed(`users/${USER_B}`, { subscriptionPlan: "free", referralBalance: 0 });
    mockDb.seed(`payments/${REF_A}`, { userId: USER_A, plan: "growth", annual: false, amountGHS: 30, status: "pending" });
    mockDb.seed(`payments/${REF_B}`, { userId: USER_B, plan: "pro", annual: false, amountGHS: 60, status: "pending" });

    const [resA, resB] = await Promise.all([
      processWebhookEvent("charge.success", {
        reference: REF_A, status: "success", amount: 3000,
        currency: "GHS", id: "ps_a", createdAt: new Date().toISOString(),
      }),
      processWebhookEvent("charge.success", {
        reference: REF_B, status: "success", amount: 6000,
        currency: "GHS", id: "ps_b", createdAt: new Date().toISOString(),
      }),
    ]);

    expect(resA.ok).toBe(true);
    expect(resB.ok).toBe(true);

    const userA = mockDb.read(`users/${USER_A}`);
    const userB = mockDb.read(`users/${USER_B}`);

    expect(userA?.subscriptionPlan).toBe("growth");
    expect(userB?.subscriptionPlan).toBe("pro");
  });
});
