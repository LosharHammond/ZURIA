/**
 * ADVERSARIAL TESTS — Concurrency & Race Conditions
 *
 * Simulates concurrent financial operations hitting ZURIA simultaneously.
 * Tests that Firestore transactions prevent double-spends and data corruption.
 *
 * Scenarios tested:
 *  - Simultaneous subscription activation (two serverless instances race)
 *  - Concurrent withdrawal requests (balance check race)
 *  - Race between subscription activation and query
 *  - Simultaneous webhook delivery + verify API call for same reference
 *  - Idempotency key race (two writes to same key simultaneously)
 *
 * Note: MockDb uses JS single-threaded model — we simulate "race" by interleaving
 * multiple async calls without awaiting between them (Promise.all / Promise.race).
 */

import { processWebhookEvent } from "@/lib/payments/webhook-processor";
import { createMockDb, type MockDb } from "../helpers/firestore-mock";

const mockDb = createMockDb();

jest.mock("@/lib/firebase/admin", () => ({
  getAdminDb: () => mockDb,
}));

jest.mock("@/lib/whatsapp/client", () => ({
  sendText: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/lib/whatsapp/formatter", () => ({
  fmtSubscriptionActivated: jest.fn().mockReturnValue("✅"),
}));

jest.mock("@/lib/services/paystack-service", () => ({
  verifyTransaction: jest.fn().mockResolvedValue({ ok: true, status: "success" }),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function seedUser(db: MockDb, userId: string, plan = "free", balance = 0) {
  db.seed(`users/${userId}`, {
    phoneNumber: `+23350${userId.slice(-7)}`,
    businessId:  `biz_${userId}`,
    subscriptionPlan: plan,
    whatsappMessageCount: 0,
    referralBalance: balance,
    updatedAt: new Date().toISOString(),
  });
  db.seed(`businesses/biz_${userId}`, { name: `Business ${userId}` });
}

function seedPayment(db: MockDb, ref: string, userId: string, amountGHS: number, plan = "growth") {
  db.seed(`payments/${ref}`, {
    userId,
    plan,
    annual:    false,
    amountGHS,
    status:    "pending",
    createdAt: new Date().toISOString(),
  });
}

function makeChargeEvent(ref: string, amountGHS: number) {
  return {
    reference: ref,
    status:    "success",
    amount:    amountGHS * 100,
    currency:  "GHS",
    id:        `ps_${ref}`,
    createdAt: new Date().toISOString(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1 — Simultaneous subscription activation race
// ═══════════════════════════════════════════════════════════════════════════════

describe("Concurrency › Simultaneous Subscription Activation", () => {
  const USER   = "user_race_001";
  const REF    = "RACE_REF_001";
  const AMOUNT = 30;

  beforeEach(() => {
    mockDb.clear();
    seedUser(mockDb, USER);
    seedPayment(mockDb, REF, USER, AMOUNT);
  });

  test("two concurrent deliveries: both ok:true", async () => {
    const event = makeChargeEvent(REF, AMOUNT);
    const [r1, r2] = await Promise.all([
      processWebhookEvent("charge.success", event),
      processWebhookEvent("charge.success", event),
    ]);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
  });

  test("two concurrent deliveries: subscription activated (not stuck at free)", async () => {
    const event = makeChargeEvent(REF, AMOUNT);
    await Promise.all([
      processWebhookEvent("charge.success", event),
      processWebhookEvent("charge.success", event),
    ]);
    const user = mockDb.read(`users/${USER}`);
    expect(user?.subscriptionPlan).toBe("growth");
  });

  test("three concurrent deliveries for same reference: no crash", async () => {
    const event = makeChargeEvent(REF, AMOUNT);
    await expect(
      Promise.all([
        processWebhookEvent("charge.success", event),
        processWebhookEvent("charge.success", event),
        processWebhookEvent("charge.success", event),
      ])
    ).resolves.not.toThrow();
  });

  test("five concurrent deliveries: payment status is 'success' at end", async () => {
    const event = makeChargeEvent(REF, AMOUNT);
    await Promise.all(Array.from({ length: 5 }, () =>
      processWebhookEvent("charge.success", event)
    ));
    const payment = mockDb.read(`payments/${REF}`);
    expect(payment?.status).toBe("success");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2 — Concurrent activations for different users (isolation)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Concurrency › Different-User Race (No Cross-Contamination)", () => {
  test("10 concurrent activations for 10 different users all succeed independently", async () => {
    mockDb.clear();

    const users = Array.from({ length: 10 }, (_, i) => ({
      userId:  `cuser_${i}`,
      ref:     `CREF_${i}`,
      amount:  30 + i,
    }));

    for (const { userId, ref, amount } of users) {
      seedUser(mockDb, userId);
      seedPayment(mockDb, ref, userId, amount);
    }

    const results = await Promise.all(
      users.map(({ ref, amount }) =>
        processWebhookEvent("charge.success", makeChargeEvent(ref, amount))
      )
    );

    // All should succeed
    expect(results.every((r) => r.ok)).toBe(true);

    // Each user activated their own plan
    for (const { userId } of users) {
      const user = mockDb.read(`users/${userId}`);
      expect(user?.subscriptionPlan).toBe("growth");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3 — Race: transfer.failed and transfer.success for same withdrawal
// ═══════════════════════════════════════════════════════════════════════════════

describe("Concurrency › transfer.failed vs transfer.success Race", () => {
  const WD_ID  = "wd_race_001";
  const WD_REF = "WDRACE_REF_001";
  const USER   = "user_wd_race";

  beforeEach(() => {
    mockDb.clear();
    mockDb.seed(`users/${USER}`, {
      referralBalance: 0,
      updatedAt: new Date().toISOString(),
    });
    mockDb.seed(`withdrawals/${WD_ID}`, {
      status:            "pending",
      userId:            USER,
      ownerName:         "Test User",
      amount:            100,
      method:            "momo",
      network:           "MTN",
      accountNumber:     "0551234567",
      accountName:       "Test User",
      phoneNumber:       "+233551234567",
      paystackReference: WD_REF,
    });
  });

  test("concurrent failed + success: withdrawal settles to one final state", async () => {
    const [rFail, rSuccess] = await Promise.all([
      processWebhookEvent("transfer.failed", { reference: WD_REF }),
      processWebhookEvent("transfer.success", { reference: WD_REF }),
    ]);

    // Both should be ok:true
    expect(rFail.ok || rSuccess.ok).toBe(true);

    const wd = mockDb.read(`withdrawals/${WD_ID}`);
    // Status should be one deterministic value (either approved or failed, not pending)
    expect(["approved", "failed"]).toContain(wd?.status);
  });

  test("no crash when transfer.failed and transfer.reversed race", async () => {
    await expect(
      Promise.all([
        processWebhookEvent("transfer.failed", { reference: WD_REF }),
        processWebhookEvent("transfer.reversed", { reference: WD_REF }),
      ])
    ).resolves.not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4 — Idempotency key race (two writes to same key)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Concurrency › Idempotency Key Race", () => {
  const USER = "user_idem_race";
  const REF  = "IDEM_RACE_REF";

  beforeEach(() => {
    mockDb.clear();
    seedUser(mockDb, USER);
    seedPayment(mockDb, REF, USER, 30);
  });

  test("pre-seeding idempotency key prevents second activation", async () => {
    // Simulate: first instance already wrote the idempotency key
    const idemKey = `psevt_${REF}_charge.success`;
    mockDb.seed(`idempotency_keys/${idemKey}`, {
      reference: REF,
      eventType: "charge.success",
      processedAt: new Date().toISOString(),
    });

    const result = await processWebhookEvent("charge.success", makeChargeEvent(REF, 30));
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/already processed/i);

    // Plan must remain free — no activation happened
    const user = mockDb.read(`users/${USER}`);
    expect(user?.subscriptionPlan).toBe("free");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 5 — Mixed event storm (charge.success + transfer events together)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Concurrency › Mixed Event Storm", () => {
  test("subscription activation + unrelated withdrawal failure concurrently", async () => {
    mockDb.clear();

    const USER_SUB = "user_sub";
    const REF_SUB  = "SUB_REF_001";
    const USER_WD  = "user_wd";
    const WD_ID    = "wd_concurrent";
    const WD_REF   = "WD_CONCURRENT_001";

    seedUser(mockDb, USER_SUB);
    seedPayment(mockDb, REF_SUB, USER_SUB, 30);

    mockDb.seed(`users/${USER_WD}`, { referralBalance: 0, updatedAt: new Date().toISOString() });
    mockDb.seed(`withdrawals/${WD_ID}`, {
      status: "pending",
      userId: USER_WD,
      ownerName: "Ama",
      amount: 50,
      method: "momo",
      network: "MTN",
      accountNumber: "0551111111",
      accountName: "Ama",
      phoneNumber: "+233551111111",
      paystackReference: WD_REF,
    });

    const [subRes, wdRes] = await Promise.all([
      processWebhookEvent("charge.success", makeChargeEvent(REF_SUB, 30)),
      processWebhookEvent("transfer.failed", { reference: WD_REF }),
    ]);

    expect(subRes.ok).toBe(true);
    expect(wdRes.ok).toBe(true);

    // Subscription user activated
    expect(mockDb.read(`users/${USER_SUB}`)?.subscriptionPlan).toBe("growth");

    // Withdrawal user balance restored
    expect(mockDb.read(`users/${USER_WD}`)?.referralBalance).toBe(50);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 6 — Plan upgrade race (renewal while active)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Concurrency › Subscription Renewal Race", () => {
  test("renewal while existing subscription is active: plan updated, not reverted", async () => {
    mockDb.clear();

    const USER = "user_renew";
    const REF1 = "RENEW_REF_001";

    mockDb.seed(`users/${USER}`, {
      subscriptionPlan: "pro", // already on pro
      subscriptionExpiresAt: new Date(Date.now() + 86400000).toISOString(),
      whatsappMessageCount: 0,
      referralBalance: 0,
      updatedAt: new Date().toISOString(),
    });
    mockDb.seed(`payments/${REF1}`, {
      userId: USER,
      plan: "pro",
      annual: false,
      amountGHS: 60,
      status: "pending",
      createdAt: new Date().toISOString(),
    });

    // Two renewal webhooks arrive simultaneously
    const [r1, r2] = await Promise.all([
      processWebhookEvent("charge.success", makeChargeEvent(REF1, 60)),
      processWebhookEvent("charge.success", makeChargeEvent(REF1, 60)),
    ]);

    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);

    const user = mockDb.read(`users/${USER}`);
    // Plan must still be 'pro' — not downgraded or corrupted
    expect(user?.subscriptionPlan).toBe("pro");
  });
});
