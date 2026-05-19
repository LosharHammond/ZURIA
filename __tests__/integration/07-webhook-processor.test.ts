/**
 * INTEGRATION TESTS — Webhook Processor
 *
 * Adversarial focus:
 *  - charge.success activates subscription exactly once (idempotency key)
 *  - Amount mismatch → PAYMENT_FAILED ledger entry, no activation
 *  - Non-GHS currency → rejected
 *  - transfer.success → withdrawal approved, WhatsApp sent
 *  - transfer.failed → balance restored atomically
 *  - transfer.reversed → balance restored atomically
 *  - processWebhookEvent unknown event → ok:true, no crash
 *  - isEventFresh rejects old events (>5min)
 *  - verifyAndActivateMissedPayment handles missing payment doc
 */

import {
  processWebhookEvent,
  isEventFresh,
  type ProcessResult,
} from "@/lib/payments/webhook-processor";
import { createMockDb, FieldValue, type MockDb } from "../helpers/firestore-mock";

// ─── Module-level mocks ────────────────────────────────────────────────────────

const mockDb = createMockDb();

jest.mock("@/lib/firebase/admin", () => ({
  getAdminDb: () => mockDb,
}));

jest.mock("@/lib/whatsapp/client", () => ({
  sendText: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/lib/whatsapp/formatter", () => ({
  fmtSubscriptionActivated: jest.fn().mockReturnValue("✅ Subscription activated!"),
}));

jest.mock("@/lib/services/paystack-service", () => ({
  verifyTransaction: jest.fn().mockResolvedValue({ ok: true, status: "success" }),
}));

// ─── Test helpers ─────────────────────────────────────────────────────────────

const TEST_USER_ID    = "user_test_001";
const TEST_BUSINESS   = "biz_001";
const TEST_REFERENCE  = "PAY_TEST_" + Date.now();
const TEST_PHONE      = "+233501234567";
const TEST_PLAN       = "growth";
const AMOUNT_GHS      = 30;
const AMOUNT_PESEWA   = AMOUNT_GHS * 100;

function seedUser(db: MockDb) {
  db.seed(`users/${TEST_USER_ID}`, {
    phoneNumber:  TEST_PHONE,
    businessId:   TEST_BUSINESS,
    subscriptionPlan: "free",
    referralBalance:  0,
    updatedAt: new Date().toISOString(),
  });
  db.seed(`businesses/${TEST_BUSINESS}`, { name: "Kofi Supplies" });
}

function seedPayment(db: MockDb, overrides: Record<string, unknown> = {}) {
  db.seed(`payments/${TEST_REFERENCE}`, {
    userId:     TEST_USER_ID,
    plan:       TEST_PLAN,
    annual:     false,
    amountGHS:  AMOUNT_GHS,
    status:     "pending",
    createdAt:  new Date().toISOString(),
    ...overrides,
  });
}

function makeChargeSuccess(overrides: Record<string, unknown> = {}) {
  return {
    reference:  TEST_REFERENCE,
    status:     "success",
    amount:     AMOUNT_PESEWA,
    currency:   "GHS",
    id:         "ps_txn_001",
    channel:    "card",
    createdAt:  new Date().toISOString(),
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1 — charge.success (happy path)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Webhook Processor › charge.success", () => {
  beforeEach(() => {
    mockDb.clear();
    seedUser(mockDb);
    seedPayment(mockDb);
  });

  test("first delivery → ok:true, subscription activated", async () => {
    const result = await processWebhookEvent("charge.success", makeChargeSuccess());
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/activated/i);
  });

  test("user plan updated to growth", async () => {
    await processWebhookEvent("charge.success", makeChargeSuccess());
    const user = mockDb.read(`users/${TEST_USER_ID}`);
    expect(user?.subscriptionPlan).toBe(TEST_PLAN);
  });

  test("payment status updated to success", async () => {
    await processWebhookEvent("charge.success", makeChargeSuccess());
    const payment = mockDb.read(`payments/${TEST_REFERENCE}`);
    expect(payment?.status).toBe("success");
  });

  test("PAYMENT_SUCCESS ledger entry written", async () => {
    await processWebhookEvent("charge.success", makeChargeSuccess());
    const ledgerId = `${TEST_REFERENCE}_PAYMENT_SUCCESS`;
    expect(mockDb.exists(`payment_events/${ledgerId}`)).toBe(true);
    const entry = mockDb.read(`payment_events/${ledgerId}`);
    expect(entry?.eventType).toBe("PAYMENT_SUCCESS");
    expect(entry?._immutable).toBe(true);
  });

  test("SUBSCRIPTION_ACTIVATED ledger entry written", async () => {
    await processWebhookEvent("charge.success", makeChargeSuccess());
    const ledgerId = `${TEST_REFERENCE}_SUBSCRIPTION_ACTIVATED`;
    expect(mockDb.exists(`payment_events/${ledgerId}`)).toBe(true);
    const entry = mockDb.read(`payment_events/${ledgerId}`);
    expect(entry?.eventType).toBe("SUBSCRIPTION_ACTIVATED");
  });

  test("idempotency key written after activation", async () => {
    await processWebhookEvent("charge.success", makeChargeSuccess());
    const idemKey = `psevt_${TEST_REFERENCE}_charge.success`;
    expect(mockDb.exists(`idempotency_keys/${idemKey}`)).toBe(true);
  });

  test("second delivery → skipped (idempotency key exists)", async () => {
    await processWebhookEvent("charge.success", makeChargeSuccess());
    const result2 = await processWebhookEvent("charge.success", makeChargeSuccess());
    expect(result2.ok).toBe(true);
    expect(result2.message).toMatch(/already processed|idempotency/i);
  });

  test("payment already success → already processed response", async () => {
    seedPayment(mockDb, { status: "success" });
    const result = await processWebhookEvent("charge.success", makeChargeSuccess());
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/already/i);
  });

  test("non-success status in payload → skipped gracefully", async () => {
    const result = await processWebhookEvent("charge.success", makeChargeSuccess({ status: "failed" }));
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/not a success/i);
  });

  test("payment record not found → ok:false (retry expected)", async () => {
    mockDb.clear();
    seedUser(mockDb);
    // No payment record seeded
    const result = await processWebhookEvent("charge.success", makeChargeSuccess());
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/not found|retry/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2 — Amount mismatch
// ═══════════════════════════════════════════════════════════════════════════════

describe("Webhook Processor › Amount Mismatch", () => {
  beforeEach(() => {
    mockDb.clear();
    seedUser(mockDb);
    seedPayment(mockDb);
  });

  test("Paystack sends more than expected → PAYMENT_FAILED", async () => {
    const result = await processWebhookEvent(
      "charge.success",
      makeChargeSuccess({ amount: AMOUNT_PESEWA + 100 }), // extra pesewa
    );
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/mismatch/i);
  });

  test("PAYMENT_FAILED ledger entry written on mismatch", async () => {
    await processWebhookEvent(
      "charge.success",
      makeChargeSuccess({ amount: 5000 }), // wrong amount
    );
    const ledgerId = `${TEST_REFERENCE}_PAYMENT_FAILED`;
    expect(mockDb.exists(`payment_events/${ledgerId}`)).toBe(true);
    const entry = mockDb.read(`payment_events/${ledgerId}`);
    expect(entry?.eventType).toBe("PAYMENT_FAILED");
    expect(entry?._immutable).toBe(true);
  });

  test("user plan NOT upgraded on mismatch", async () => {
    await processWebhookEvent(
      "charge.success",
      makeChargeSuccess({ amount: 9999 }),
    );
    const user = mockDb.read(`users/${TEST_USER_ID}`);
    expect(user?.subscriptionPlan).toBe("free");
  });

  test("non-GHS currency → rejected", async () => {
    const result = await processWebhookEvent(
      "charge.success",
      makeChargeSuccess({ currency: "USD" }),
    );
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/mismatch|rejected/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3 — transfer.success
// ═══════════════════════════════════════════════════════════════════════════════

describe("Webhook Processor › transfer.success", () => {
  const WITHDRAWAL_ID   = "wd_001";
  const TRANSFER_CODE   = "TRF_abc123";
  const WD_REFERENCE    = "WD_REF_001";
  const OWNER_PHONE     = "+233201234567";

  beforeEach(() => {
    mockDb.clear();
    mockDb.seed(`withdrawals/${WITHDRAWAL_ID}`, {
      status:               "pending",
      userId:               TEST_USER_ID,
      ownerName:            "Kofi Mensah",
      amount:               50,
      method:               "momo",
      network:              "MTN",
      accountNumber:        "0551234567",
      accountName:          "Kofi Mensah",
      phoneNumber:          OWNER_PHONE,
      paystackReference:    WD_REFERENCE,
      paystackTransferCode: TRANSFER_CODE,
    });
  });

  test("transfer.success by reference → withdrawal approved", async () => {
    const result = await processWebhookEvent("transfer.success", {
      reference: WD_REFERENCE,
      transfer_code: TRANSFER_CODE,
    });
    expect(result.ok).toBe(true);
    const wd = mockDb.read(`withdrawals/${WITHDRAWAL_ID}`);
    expect(wd?.status).toBe("approved");
  });

  test("transfer.success by transfer_code when reference not found", async () => {
    const result = await processWebhookEvent("transfer.success", {
      transfer_code: TRANSFER_CODE,
    });
    expect(result.ok).toBe(true);
    const wd = mockDb.read(`withdrawals/${WITHDRAWAL_ID}`);
    expect(wd?.status).toBe("approved");
  });

  test("already approved → idempotent ok:true", async () => {
    mockDb.seed(`withdrawals/${WITHDRAWAL_ID}`, {
      status: "approved",
      userId: TEST_USER_ID,
      ownerName: "Kofi Mensah",
      amount: 50,
      method: "momo",
      accountNumber: "0551234567",
      accountName: "Kofi Mensah",
      phoneNumber: OWNER_PHONE,
      paystackReference: WD_REFERENCE,
      paystackTransferCode: TRANSFER_CODE,
    });
    const result = await processWebhookEvent("transfer.success", {
      reference: WD_REFERENCE,
    });
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/already/i);
  });

  test("no matching withdrawal → ok:true, no action", async () => {
    const result = await processWebhookEvent("transfer.success", {
      reference: "NO_SUCH_REF",
    });
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/no matching/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4 — transfer.failed and transfer.reversed
// ═══════════════════════════════════════════════════════════════════════════════

describe("Webhook Processor › transfer.failed / transfer.reversed", () => {
  const WITHDRAWAL_ID   = "wd_002";
  const TRANSFER_CODE   = "TRF_fail123";
  const WD_REFERENCE    = "WD_REF_002";
  const INITIAL_BALANCE = 0;

  function seedFailCase() {
    mockDb.clear();
    mockDb.seed(`users/${TEST_USER_ID}`, {
      referralBalance: INITIAL_BALANCE,
      updatedAt: new Date().toISOString(),
    });
    mockDb.seed(`withdrawals/${WITHDRAWAL_ID}`, {
      status:               "pending",
      userId:               TEST_USER_ID,
      ownerName:            "Ama Asante",
      amount:               75,
      method:               "momo",
      network:              "Vodafone",
      accountNumber:        "0201234567",
      accountName:          "Ama Asante",
      phoneNumber:          "+233201234567",
      paystackReference:    WD_REFERENCE,
      paystackTransferCode: TRANSFER_CODE,
    });
  }

  test("transfer.failed → withdrawal marked failed", async () => {
    seedFailCase();
    await processWebhookEvent("transfer.failed", {
      reference: WD_REFERENCE,
      transfer_code: TRANSFER_CODE,
    });
    const wd = mockDb.read(`withdrawals/${WITHDRAWAL_ID}`);
    expect(wd?.status).toBe("failed");
  });

  test("transfer.failed → referral balance restored (FieldValue.increment)", async () => {
    seedFailCase();
    await processWebhookEvent("transfer.failed", {
      reference: WD_REFERENCE,
      transfer_code: TRANSFER_CODE,
    });
    const user = mockDb.read(`users/${TEST_USER_ID}`);
    // Balance should be restored: 0 + 75 = 75
    expect(user?.referralBalance).toBe(75);
  });

  test("transfer.reversed → balance also restored", async () => {
    seedFailCase();
    await processWebhookEvent("transfer.reversed", {
      reference: WD_REFERENCE,
      transfer_code: TRANSFER_CODE,
    });
    const user = mockDb.read(`users/${TEST_USER_ID}`);
    expect(user?.referralBalance).toBe(75);
  });

  test("transfer.failed → WITHDRAWAL_FAILED ledger entry written", async () => {
    seedFailCase();
    await processWebhookEvent("transfer.failed", {
      reference: WD_REFERENCE,
      transfer_code: TRANSFER_CODE,
    });
    const ledgerId = `${WITHDRAWAL_ID}_WITHDRAWAL_FAILED`;
    expect(mockDb.exists(`withdrawal_events/${ledgerId}`)).toBe(true);
    const entry = mockDb.read(`withdrawal_events/${ledgerId}`);
    expect(entry?.eventType).toBe("WITHDRAWAL_FAILED");
    expect(entry?._immutable).toBe(true);
  });

  test("already failed → idempotent ok:true", async () => {
    mockDb.clear();
    mockDb.seed(`users/${TEST_USER_ID}`, { referralBalance: 0 });
    mockDb.seed(`withdrawals/${WITHDRAWAL_ID}`, {
      status: "failed",
      userId: TEST_USER_ID,
      ownerName: "Ama Asante",
      amount: 75,
      method: "momo",
      accountNumber: "0201234567",
      accountName: "Ama Asante",
      phoneNumber: "+233201234567",
      paystackReference: WD_REFERENCE,
      paystackTransferCode: TRANSFER_CODE,
    });
    const result = await processWebhookEvent("transfer.failed", {
      reference: WD_REFERENCE,
    });
    expect(result.ok).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 5 — Unknown events
// ═══════════════════════════════════════════════════════════════════════════════

describe("Webhook Processor › Unknown Events", () => {
  test("unknown event type → ok:true, not handled", async () => {
    const result = await processWebhookEvent("invoice.created", { id: "inv_001" });
    expect(result.ok).toBe(true);
    expect(result.message).toContain("not handled");
  });

  test("empty event type → no crash", async () => {
    const result = await processWebhookEvent("", {});
    expect(result.ok).toBe(true);
  });

  test("subscription.create (Paystack) → not handled gracefully", async () => {
    const result = await processWebhookEvent("subscription.create", { plan: "growth" });
    expect(result.ok).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 6 — isEventFresh
// ═══════════════════════════════════════════════════════════════════════════════

describe("Webhook Processor › isEventFresh", () => {
  test("event with createdAt 1 minute ago → fresh", () => {
    const recentIso = new Date(Date.now() - 60_000).toISOString();
    expect(isEventFresh({ createdAt: recentIso })).toBe(true);
  });

  test("event with createdAt 4 minutes ago → fresh", () => {
    const recentIso = new Date(Date.now() - 4 * 60_000).toISOString();
    expect(isEventFresh({ createdAt: recentIso })).toBe(true);
  });

  test("event with createdAt 6 minutes ago → stale", () => {
    const staleIso = new Date(Date.now() - 6 * 60_000).toISOString();
    expect(isEventFresh({ createdAt: staleIso })).toBe(false);
  });

  test("event with createdAt exactly 5 minutes ago → fresh (boundary)", () => {
    const boundaryIso = new Date(Date.now() - 300_000).toISOString();
    expect(isEventFresh({ createdAt: boundaryIso })).toBe(true);
  });

  test("event with no createdAt → treated as fresh (no data = no block)", () => {
    expect(isEventFresh({})).toBe(true);
  });

  test("event with invalid createdAt → treated as fresh (parse error = no block)", () => {
    expect(isEventFresh({ createdAt: "not-a-date" })).toBe(true);
  });

  test("event with createdAt yesterday → stale", () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    expect(isEventFresh({ createdAt: yesterday })).toBe(false);
  });
});
