/**
 * INTEGRATION TESTS — Payment Reconciler
 *
 * Tests the reconciliation engine which runs on a schedule (cron) to:
 *  - Detect payments stuck in "pending" that Paystack already confirmed
 *  - Activate missed subscriptions (webhook delivery failure)
 *  - Mark failed/abandoned payments with a PAYMENT_FAILED ledger entry
 *  - Detect and report referral balance drift
 *
 * Adversarial focus:
 *  - Pending payment with Paystack success → activated (orphan repair)
 *  - Pending payment with Paystack failure → marked failed + ledger
 *  - Payment doc stuck pending but ledger already shows success → doc-only repair
 *  - Pending payment still genuinely pending → skipped (no false activation)
 *  - Zero pending payments → report is clean (0 scanned)
 *  - Firestore query failure → error captured in report, not crash
 *  - Referral balance drift detection
 */

import {
  reconcileRecentPayments,
  reconcileReferralBalances,
  type ReconciliationReport,
} from "@/lib/reconciliation/payment-reconciler";
import { createMockDb, type MockDb } from "../helpers/firestore-mock";

// ─── Module-level mocks ────────────────────────────────────────────────────────

const mockDb = createMockDb();
let mockVerifyResult: { ok: boolean; status: string } = { ok: true, status: "success" };

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
  verifyTransaction: jest.fn().mockImplementation(() => Promise.resolve(mockVerifyResult)),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Create a timestamp that falls in the stale window (default: 30 minutes ago) */
function staleTs(minutesAgo = 30) {
  return new Date(Date.now() - minutesAgo * 60_000).toISOString();
}

/** Create a timestamp that's too recent for reconciliation (e.g., 2 minutes ago) */
function freshTs(minutesAgo = 2) {
  return new Date(Date.now() - minutesAgo * 60_000).toISOString();
}

function seedPendingPayment(
  db: MockDb,
  ref: string,
  userId: string,
  opts: { plan?: string; amountGHS?: number; minutesAgo?: number } = {},
) {
  const { plan = "growth", amountGHS = 30, minutesAgo = 30 } = opts;
  db.seed(`payments/${ref}`, {
    userId,
    plan,
    annual: false,
    amountGHS,
    status: "pending",
    reference: ref,
    createdAt: staleTs(minutesAgo),
  });
}

function seedUser(db: MockDb, userId: string, plan = "free", balance = 0) {
  db.seed(`users/${userId}`, {
    subscriptionPlan: plan,
    whatsappMessageCount: 0,
    referralBalance: balance,
    updatedAt: new Date().toISOString(),
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1 — No pending payments
// ═══════════════════════════════════════════════════════════════════════════════

describe("Payment Reconciler › No Pending Payments", () => {
  beforeEach(() => {
    mockDb.clear();
    mockVerifyResult = { ok: true, status: "success" };
  });

  test("empty database → report shows 0 scanned", async () => {
    const report = await reconcileRecentPayments();
    expect(report.scannedPayments).toBe(0);
    expect(report.repairedPayments).toBe(0);
    expect(report.failedPayments).toBe(0);
    expect(report.errors.length).toBe(0);
  });

  test("only non-pending payments → report shows 0 scanned", async () => {
    seedUser(mockDb, "u1");
    mockDb.seed("payments/ref_success", {
      userId: "u1", plan: "growth", annual: false, amountGHS: 30,
      status: "success", reference: "ref_success", createdAt: staleTs(30),
    });
    const report = await reconcileRecentPayments();
    expect(report.scannedPayments).toBe(0);
  });

  test("report always has ranAt timestamp", async () => {
    const report = await reconcileRecentPayments();
    expect(report.ranAt).toBeTruthy();
    expect(typeof report.ranAt).toBe("string");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2 — Orphaned success (Paystack confirmed, webhook missed)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Payment Reconciler › Orphaned Success Repair", () => {
  beforeEach(() => {
    mockDb.clear();
    mockVerifyResult = { ok: true, status: "success" };
  });

  test("pending payment + Paystack success → subscription activated", async () => {
    seedUser(mockDb, "user_orphan", "free");
    seedPendingPayment(mockDb, "ORPHAN_REF_001", "user_orphan");

    const report = await reconcileRecentPayments();
    expect(report.scannedPayments).toBe(1);
    expect(report.repairedPayments).toBe(1);
  });

  test("orphaned success: user plan upgraded to growth", async () => {
    seedUser(mockDb, "user_orphan2", "free");
    seedPendingPayment(mockDb, "ORPHAN_REF_002", "user_orphan2");

    await reconcileRecentPayments();

    const user = mockDb.read("users/user_orphan2");
    expect(user?.subscriptionPlan).toBe("growth");
  });

  test("orphaned success: PAYMENT_SUCCESS ledger entry written", async () => {
    seedUser(mockDb, "user_orphan3", "free");
    seedPendingPayment(mockDb, "ORPHAN_REF_003", "user_orphan3");

    await reconcileRecentPayments();

    expect(mockDb.exists("payment_events/ORPHAN_REF_003_PAYMENT_SUCCESS")).toBe(true);
  });

  test("multiple orphaned successes all repaired", async () => {
    for (let i = 0; i < 5; i++) {
      seedUser(mockDb, `multi_user_${i}`, "free");
      seedPendingPayment(mockDb, `MULTI_REF_${i}`, `multi_user_${i}`);
    }

    mockVerifyResult = { ok: true, status: "success" };
    const report = await reconcileRecentPayments();
    expect(report.scannedPayments).toBe(5);
    expect(report.repairedPayments).toBe(5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3 — Doc-only repair (ledger exists but payment doc still pending)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Payment Reconciler › Doc-Only Repair", () => {
  beforeEach(() => {
    mockDb.clear();
    mockVerifyResult = { ok: true, status: "success" };
  });

  test("ledger success entry exists → payment doc status set to success (no API call)", async () => {
    seedUser(mockDb, "user_doconly", "growth");
    seedPendingPayment(mockDb, "DOCONLY_REF", "user_doconly");

    // Simulate: ledger was written but payment doc status update failed
    mockDb.seed("payment_events/DOCONLY_REF_PAYMENT_SUCCESS", {
      id: "DOCONLY_REF_PAYMENT_SUCCESS",
      paystackReference: "DOCONLY_REF",
      userId: "user_doconly",
      eventType: "PAYMENT_SUCCESS",
      _immutable: true,
    });

    const report = await reconcileRecentPayments();
    expect(report.repairedPayments).toBe(1);

    const payment = mockDb.read("payments/DOCONLY_REF");
    expect(payment?.status).toBe("success");
  });

  test("doc-only repair: repairedAt timestamp set", async () => {
    seedUser(mockDb, "user_doconly2", "growth");
    seedPendingPayment(mockDb, "DOCONLY_REF2", "user_doconly2");
    mockDb.seed("payment_events/DOCONLY_REF2_PAYMENT_SUCCESS", {
      id: "DOCONLY_REF2_PAYMENT_SUCCESS",
      eventType: "PAYMENT_SUCCESS",
      _immutable: true,
    });

    await reconcileRecentPayments();

    const payment = mockDb.read("payments/DOCONLY_REF2");
    expect(payment?.repairedAt).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4 — Failed/abandoned payments
// ═══════════════════════════════════════════════════════════════════════════════

describe("Payment Reconciler › Failed Payment Handling", () => {
  beforeEach(() => {
    mockDb.clear();
  });

  test("pending payment + Paystack failed → payment marked failed", async () => {
    seedUser(mockDb, "user_failed", "free");
    seedPendingPayment(mockDb, "FAILED_REF_001", "user_failed");
    mockVerifyResult = { ok: true, status: "failed" };

    const report = await reconcileRecentPayments();
    expect(report.failedPayments).toBe(1);

    const payment = mockDb.read("payments/FAILED_REF_001");
    expect(payment?.status).toBe("failed");
  });

  test("failed payment: PAYMENT_FAILED ledger entry written with _immutable=true", async () => {
    seedUser(mockDb, "user_failed2", "free");
    seedPendingPayment(mockDb, "FAILED_REF_002", "user_failed2");
    mockVerifyResult = { ok: false, status: "failed" };

    await reconcileRecentPayments();

    const entry = mockDb.read("payment_events/FAILED_REF_002_PAYMENT_FAILED");
    expect(entry).toBeTruthy();
    expect(entry?._immutable).toBe(true);
    expect(entry?.eventType).toBe("PAYMENT_FAILED");
  });

  test("abandoned payment → same outcome as failed", async () => {
    seedUser(mockDb, "user_abandoned", "free");
    seedPendingPayment(mockDb, "ABANDONED_REF", "user_abandoned");
    mockVerifyResult = { ok: true, status: "abandoned" };

    const report = await reconcileRecentPayments();
    expect(report.failedPayments).toBe(1);

    const payment = mockDb.read("payments/ABANDONED_REF");
    expect(payment?.status).toBe("abandoned");
  });

  test("failed payment: user plan NOT changed", async () => {
    seedUser(mockDb, "user_failed3", "free");
    seedPendingPayment(mockDb, "FAILED_REF_003", "user_failed3");
    mockVerifyResult = { ok: false, status: "failed" };

    await reconcileRecentPayments();

    expect(mockDb.read("users/user_failed3")?.subscriptionPlan).toBe("free");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 5 — Genuinely pending (no action taken)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Payment Reconciler › Still-Pending Payments (No Action)", () => {
  beforeEach(() => {
    mockDb.clear();
    mockVerifyResult = { ok: true, status: "pending" };
  });

  test("Paystack still pending → not repaired, not failed", async () => {
    seedUser(mockDb, "user_stillpending", "free");
    seedPendingPayment(mockDb, "STILLPENDING_REF", "user_stillpending");

    const report = await reconcileRecentPayments();
    expect(report.repairedPayments).toBe(0);
    expect(report.failedPayments).toBe(0);
    expect(report.errors.length).toBe(0);
  });

  test("still-pending: user plan unchanged", async () => {
    seedUser(mockDb, "user_stillpending2", "free");
    seedPendingPayment(mockDb, "STILLPENDING_REF2", "user_stillpending2");

    await reconcileRecentPayments();

    expect(mockDb.read("users/user_stillpending2")?.subscriptionPlan).toBe("free");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 6 — Mixed scenario (some repaired, some failed, some pending)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Payment Reconciler › Mixed Scenario", () => {
  test("3 pending: 1 repaired, 1 failed, 1 pending → correct report counts", async () => {
    mockDb.clear();

    seedUser(mockDb, "mix_u1", "free");
    seedUser(mockDb, "mix_u2", "free");
    seedUser(mockDb, "mix_u3", "free");
    seedPendingPayment(mockDb, "MIX_REF_1", "mix_u1");
    seedPendingPayment(mockDb, "MIX_REF_2", "mix_u2");
    seedPendingPayment(mockDb, "MIX_REF_3", "mix_u3");

    // Paystack returns different results per reference
    const { verifyTransaction } = require("@/lib/services/paystack-service");
    verifyTransaction
      .mockResolvedValueOnce({ ok: true,  status: "success" })
      .mockResolvedValueOnce({ ok: false, status: "failed" })
      .mockResolvedValueOnce({ ok: true,  status: "pending" });

    const report = await reconcileRecentPayments();
    expect(report.scannedPayments).toBe(3);
    expect(report.repairedPayments).toBe(1);
    expect(report.failedPayments).toBe(1);
    expect(report.errors.length).toBe(0);

    // Restore default
    verifyTransaction.mockResolvedValue({ ok: true, status: "success" });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 7 — Error resilience
// ═══════════════════════════════════════════════════════════════════════════════

describe("Payment Reconciler › Error Resilience", () => {
  beforeEach(() => {
    mockDb.clear();
  });

  test("verifyTransaction throws → error captured in report, not crash", async () => {
    seedUser(mockDb, "user_vt_throw", "free");
    seedPendingPayment(mockDb, "VT_THROW_REF", "user_vt_throw");

    const { verifyTransaction } = require("@/lib/services/paystack-service");
    verifyTransaction.mockRejectedValueOnce(new Error("Network timeout"));

    const report = await reconcileRecentPayments();
    expect(report.errors.length).toBeGreaterThan(0);
    expect(report.errors[0]).toContain("Network timeout");
    expect(report.repairedPayments).toBe(0);

    // Restore
    verifyTransaction.mockResolvedValue({ ok: true, status: "success" });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 8 — Referral balance drift detection
// ═══════════════════════════════════════════════════════════════════════════════

describe("Payment Reconciler › Referral Balance Drift", () => {
  beforeEach(() => {
    mockDb.clear();
  });

  test("user with correct balance → no drift", async () => {
    // User earned 50 GHS, withdrew 20 GHS → balance should be 30 GHS
    mockDb.seed("referral_events/evt1", { referrerId: "user_drift", amount: 50 });
    mockDb.seed("withdrawal_events/wd1", {
      userId: "user_drift", amountGHS: 20, eventType: "WITHDRAWAL_REQUESTED",
    });
    mockDb.seed("users/user_drift", { referralBalance: 30 });

    const result = await reconcileReferralBalances();
    expect(result.checked).toBe(1);
    expect(result.drifted.length).toBe(0);
  });

  test("user balance too high → drift detected", async () => {
    mockDb.seed("referral_events/evt2", { referrerId: "user_high", amount: 50 });
    mockDb.seed("users/user_high", { referralBalance: 100 }); // should be 50

    const result = await reconcileReferralBalances();
    const drifted = result.drifted.find((d) => d.userId === "user_high");
    expect(drifted).toBeDefined();
    expect(drifted?.drift).toBe(50); // actual(100) - expected(50) = 50
  });

  test("user balance too low → drift detected", async () => {
    mockDb.seed("referral_events/evt3", { referrerId: "user_low", amount: 80 });
    mockDb.seed("users/user_low", { referralBalance: 30 }); // should be 80

    const result = await reconcileReferralBalances();
    const drifted = result.drifted.find((d) => d.userId === "user_low");
    expect(drifted).toBeDefined();
    expect(drifted?.drift).toBeLessThan(0); // actual(30) - expected(80) = -50
  });

  test("no referral events → checked=0, no drift", async () => {
    const result = await reconcileReferralBalances();
    expect(result.checked).toBe(0);
    expect(result.drifted.length).toBe(0);
  });

  test("multiple users: correctly detects only drifted ones", async () => {
    // user_ok: earned 30, balance 30 → ok
    // user_bad: earned 30, balance 60 → drift=30
    mockDb.seed("referral_events/ok1", { referrerId: "user_ok", amount: 30 });
    mockDb.seed("referral_events/bad1", { referrerId: "user_bad", amount: 30 });
    mockDb.seed("users/user_ok", { referralBalance: 30 });
    mockDb.seed("users/user_bad", { referralBalance: 60 });

    const result = await reconcileReferralBalances();
    expect(result.checked).toBe(2);
    expect(result.drifted.length).toBe(1);
    expect(result.drifted[0]?.userId).toBe("user_bad");
  });
});
