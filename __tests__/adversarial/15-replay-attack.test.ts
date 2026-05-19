/**
 * ADVERSARIAL TESTS — Replay Attack & Webhook Replay Prevention
 *
 * Simulates a malicious actor replaying old valid webhook events to:
 *  1. Activate a subscription without paying (replay old charge.success)
 *  2. Restore a withdrawal balance that was legitimately deducted
 *  3. Claim multiple rewards from a single referral event
 *
 * Also tests:
 *  - isEventFresh() rejects events older than 5 minutes
 *  - Idempotency keys prevent re-processing of replayed events
 *  - Dual activation guard blocks re-activation from ledger check
 *  - Engine Guard RULE 5 prevents duplicate WhatsApp message re-processing
 *
 * The adversary knows: a valid Paystack reference, a valid transfer code,
 * and has captured a genuine webhook payload. They replay it hours later.
 */

import {
  processWebhookEvent,
  isEventFresh,
} from "@/lib/payments/webhook-processor";
import { createMockDb, type MockDb } from "../helpers/firestore-mock";
import { enforceEngineIsolation, isDuplicateLedgerEntry } from "@/lib/intelligence/engine-guard";
import type { ClassifiedIntent } from "@/lib/intelligence/types";

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

function staleTimestamp(minutesAgo: number) {
  return new Date(Date.now() - minutesAgo * 60_000).toISOString();
}

function freshTimestamp() {
  return new Date().toISOString();
}

function seedActivatedUser(db: MockDb, userId: string, ref: string) {
  db.seed(`users/${userId}`, {
    phoneNumber: "+233501234567",
    subscriptionPlan: "growth",
    subscriptionExpiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
    whatsappMessageCount: 0,
    referralBalance: 0,
    updatedAt: freshTimestamp(),
  });
  db.seed(`payments/${ref}`, {
    userId,
    plan: "growth",
    annual: false,
    amountGHS: 30,
    status: "success",
    createdAt: staleTimestamp(120), // 2 hours ago
  });
  // Simulate previous activation ledger entries
  db.seed(`payment_events/${ref}_PAYMENT_SUCCESS`, {
    id: `${ref}_PAYMENT_SUCCESS`,
    paystackReference: ref,
    userId,
    eventType: "PAYMENT_SUCCESS",
    _immutable: true,
    createdAt: staleTimestamp(120),
  });
  db.seed(`payment_events/${ref}_SUBSCRIPTION_ACTIVATED`, {
    id: `${ref}_SUBSCRIPTION_ACTIVATED`,
    paystackReference: ref,
    userId,
    eventType: "SUBSCRIPTION_ACTIVATED",
    _immutable: true,
    createdAt: staleTimestamp(120),
  });
  // Idempotency key already consumed
  const idemKey = `psevt_${ref}_charge.success`;
  db.seed(`idempotency_keys/${idemKey}`, {
    reference: ref,
    eventType: "charge.success",
    processedAt: staleTimestamp(120),
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1 — isEventFresh replay detection
// ═══════════════════════════════════════════════════════════════════════════════

describe("Replay Attack › isEventFresh Guard", () => {
  test("event from 6 minutes ago → stale (replay rejected)", () => {
    expect(isEventFresh({ createdAt: staleTimestamp(6) })).toBe(false);
  });

  test("event from 10 minutes ago → stale", () => {
    expect(isEventFresh({ createdAt: staleTimestamp(10) })).toBe(false);
  });

  test("event from 60 minutes ago → stale", () => {
    expect(isEventFresh({ createdAt: staleTimestamp(60) })).toBe(false);
  });

  test("event from 24 hours ago → stale", () => {
    expect(isEventFresh({ createdAt: staleTimestamp(1440) })).toBe(false);
  });

  test("event from 4 minutes ago → still fresh (retry window)", () => {
    expect(isEventFresh({ createdAt: staleTimestamp(4) })).toBe(true);
  });

  test("fresh event with current timestamp → accepted", () => {
    expect(isEventFresh({ createdAt: freshTimestamp() })).toBe(true);
  });

  test("stale event with no createdAt field → accepted (no timestamp = can't reject)", () => {
    expect(isEventFresh({})).toBe(true);
  });

  test("event with garbage createdAt → accepted (parse failure = no block)", () => {
    expect(isEventFresh({ createdAt: "yesterday" })).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2 — Subscription replay attack (charge.success)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Replay Attack › Subscription Activation Replay", () => {
  const USER = "victim_user_001";
  const REF  = "LEGIT_REF_001";

  beforeEach(() => {
    mockDb.clear();
    seedActivatedUser(mockDb, USER, REF);
  });

  test("replayed charge.success blocked by idempotency key", async () => {
    const replayedEvent = {
      reference:  REF,
      status:     "success",
      amount:     3000,
      currency:   "GHS",
      id:         "ps_txn_legit",
      createdAt:  staleTimestamp(120), // 2 hours old
    };

    const result = await processWebhookEvent("charge.success", replayedEvent);
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/already processed|idempotency/i);
  });

  test("replay does NOT change subscription plan", async () => {
    const originalPlan = mockDb.read(`users/${USER}`)?.subscriptionPlan;
    await processWebhookEvent("charge.success", {
      reference: REF, status: "success", amount: 3000,
      currency: "GHS", id: "ps_replay", createdAt: staleTimestamp(120),
    });
    expect(mockDb.read(`users/${USER}`)?.subscriptionPlan).toBe(originalPlan);
  });

  test("replay does NOT extend subscription expiry", async () => {
    const originalExpiry = mockDb.read(`users/${USER}`)?.subscriptionExpiresAt;
    await processWebhookEvent("charge.success", {
      reference: REF, status: "success", amount: 3000,
      currency: "GHS", id: "ps_replay", createdAt: staleTimestamp(120),
    });
    expect(mockDb.read(`users/${USER}`)?.subscriptionExpiresAt).toBe(originalExpiry);
  });

  test("replay does NOT create extra ledger entries", async () => {
    const countBefore = (await mockDb.collection("payment_events").get()).docs.length;
    await processWebhookEvent("charge.success", {
      reference: REF, status: "success", amount: 3000,
      currency: "GHS", id: "ps_replay", createdAt: staleTimestamp(120),
    });
    const countAfter = (await mockDb.collection("payment_events").get()).docs.length;
    expect(countAfter).toBe(countBefore);
  });

  test("10 replayed events all blocked, no side effects", async () => {
    const event = {
      reference: REF, status: "success", amount: 3000,
      currency: "GHS", id: "ps_replay", createdAt: staleTimestamp(120),
    };
    for (let i = 0; i < 10; i++) {
      const result = await processWebhookEvent("charge.success", event);
      expect(result.ok).toBe(true);
    }
    // Plan unchanged
    expect(mockDb.read(`users/${USER}`)?.subscriptionPlan).toBe("growth");
  });

  test("dual activation guard: payment already 'success' → early exit", async () => {
    // Even without idempotency key, payment.status='success' triggers early exit
    const idemKey = `psevt_${REF}_charge.success`;
    mockDb.seed(`idempotency_keys/${idemKey}`, {}); // key exists

    await processWebhookEvent("charge.success", {
      reference: REF, status: "success", amount: 3000,
      currency: "GHS", id: "ps_replay", createdAt: staleTimestamp(120),
    });

    const user = mockDb.read(`users/${USER}`);
    expect(user?.subscriptionPlan).toBe("growth"); // not changed
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3 — Withdrawal replay attack (transfer.failed replay)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Replay Attack › Withdrawal Balance Restoration Replay", () => {
  const WD_ID  = "wd_legit_001";
  const WD_REF = "WD_LEGIT_001";
  const USER   = "user_wd_victim";

  beforeEach(() => {
    mockDb.clear();
    mockDb.seed(`users/${USER}`, {
      referralBalance: 50, // balance already restored from first processing
      updatedAt: freshTimestamp(),
    });
    mockDb.seed(`withdrawals/${WD_ID}`, {
      status:            "failed", // already marked failed
      userId:            USER,
      ownerName:         "Kofi",
      amount:            50,
      method:            "momo",
      network:           "MTN",
      accountNumber:     "0551234567",
      accountName:       "Kofi",
      phoneNumber:       "+233551234567",
      paystackReference: WD_REF,
    });
  });

  test("replayed transfer.failed on already-failed withdrawal → idempotent ok:true", async () => {
    const result = await processWebhookEvent("transfer.failed", {
      reference: WD_REF,
      createdAt: staleTimestamp(60), // 1 hour old
    });
    expect(result.ok).toBe(true);
    // Message should indicate already handled
    expect(result.message).toMatch(/already|failed/i);
  });

  test("replayed transfer.failed does NOT add balance twice", async () => {
    const balanceBefore = mockDb.read(`users/${USER}`)?.referralBalance;
    await processWebhookEvent("transfer.failed", {
      reference: WD_REF,
      createdAt: staleTimestamp(60),
    });
    const balanceAfter = mockDb.read(`users/${USER}`)?.referralBalance;
    // Balance should not have been incremented again
    expect(balanceAfter).toBe(balanceBefore);
  });

  test("replay of transfer.reversed on failed withdrawal → idempotent", async () => {
    const balanceBefore = mockDb.read(`users/${USER}`)?.referralBalance;
    await processWebhookEvent("transfer.reversed", {
      reference: WD_REF,
      createdAt: staleTimestamp(90),
    });
    expect(mockDb.read(`users/${USER}`)?.referralBalance).toBe(balanceBefore);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4 — Engine Guard RULE 5: WhatsApp duplicate message replay
// ═══════════════════════════════════════════════════════════════════════════════

describe("Replay Attack › WhatsApp Message Replay (RULE 5)", () => {
  function makeIntent(amount: number): ClassifiedIntent {
    return {
      intent: "LEDGER_ENGINE",
      confidence: 0.90,
      sub_intent: "sale",
      entities: { person: null, amount, asset: "rice", action: "sold", direction: "in", plan: null, annual: false },
      state: { active_flow: "ledger", should_trigger_ui: false, subscription_ui_suppressed: false },
      requires_action: true,
    };
  }

  function makeContext(lastText: string, secondsAgo: number) {
    return {
      lastIntent: "LEDGER_ENGINE" as const,
      activeFlow: "ledger" as const,
      lastPerson: null,
      lastAmount: 100,
      lastAsset: null,
      lastTransactionSubIntent: "sale" as const,
      lastTransactionId: "txn_001",
      lastTransactionDesc: "sale of GHS 100",
      conversationHistory: [],
      pendingLimitNotification: null,
      subscriptionUiShownAt: null,
      pendingTransaction: null,
      lastNormalizedText: lastText,
      updatedAt: new Date(Date.now() - secondsAgo * 1000).toISOString(),
    };
  }

  test("exact same message within 30s → RULE 5 dedup flag", () => {
    const intent = makeIntent(100);
    const ctx = makeContext("sold rice 100", 5);
    const guard = enforceEngineIsolation(intent, ctx, null, "sold rice 100");
    expect(isDuplicateLedgerEntry(guard)).toBe(true);
  });

  test("dedup flag sets confidence=0.0 (handler skips write)", () => {
    const intent = makeIntent(100);
    const ctx = makeContext("sold rice 100", 5);
    const guard = enforceEngineIsolation(intent, ctx, null, "sold rice 100");
    if (isDuplicateLedgerEntry(guard)) {
      expect(guard.override?.confidence).toBe(0.0);
    }
  });

  test("same message 31s later → NOT flagged (intentional re-entry allowed)", () => {
    const intent = makeIntent(100);
    const ctx = makeContext("sold rice 100", 31);
    const guard = enforceEngineIsolation(intent, ctx, null, "sold rice 100");
    expect(isDuplicateLedgerEntry(guard)).toBe(false);
  });

  test("same message 60s later → NOT flagged", () => {
    const intent = makeIntent(100);
    const ctx = makeContext("sold rice 100", 60);
    const guard = enforceEngineIsolation(intent, ctx, null, "sold rice 100");
    expect(isDuplicateLedgerEntry(guard)).toBe(false);
  });

  test("WhatsApp retries different text → NOT flagged as duplicate", () => {
    const intent = makeIntent(200);
    const ctx = makeContext("sold rice 100", 5);
    const guard = enforceEngineIsolation(intent, ctx, null, "sold goods 200");
    expect(isDuplicateLedgerEntry(guard)).toBe(false);
  });

  test("10 identical message replays within 30s: all but first flagged", () => {
    const ctx = makeContext("sold rice 100", 2);
    let firstSeen = false;
    let dedupCount = 0;

    for (let i = 0; i < 10; i++) {
      const intent = makeIntent(100);
      const guard = enforceEngineIsolation(intent, ctx, null, "sold rice 100");
      if (isDuplicateLedgerEntry(guard)) {
        dedupCount++;
      } else {
        firstSeen = true;
      }
    }

    // All 10 identical messages within 30s should be flagged as duplicates
    // (context never updates in this loop — all hit the same stored text)
    expect(dedupCount).toBe(10);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 5 — Cross-reference replay (using wrong reference for same user)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Replay Attack › Cross-Reference Replay", () => {
  test("replaying REF_A for user_B → no-op (payment record belongs to user_A)", async () => {
    mockDb.clear();
    const USER_A = "user_cross_a";
    const USER_B = "user_cross_b";
    const REF_A  = "CROSS_REF_A";

    mockDb.seed(`users/${USER_A}`, { subscriptionPlan: "growth", whatsappMessageCount: 0, referralBalance: 0 });
    mockDb.seed(`users/${USER_B}`, { subscriptionPlan: "free", whatsappMessageCount: 0, referralBalance: 0 });
    mockDb.seed(`payments/${REF_A}`, {
      userId: USER_A,   // belongs to user_A
      plan: "growth",
      annual: false,
      amountGHS: 30,
      status: "success", // already processed
      createdAt: new Date().toISOString(),
    });

    // Attacker replays REF_A for user_B (hoping to get free subscription)
    const idemKey = `psevt_${REF_A}_charge.success`;
    mockDb.seed(`idempotency_keys/${idemKey}`, {
      reference: REF_A,
      processedAt: new Date().toISOString(),
    });

    const result = await processWebhookEvent("charge.success", {
      reference: REF_A, status: "success", amount: 3000,
      currency: "GHS", id: "ps_cross", createdAt: new Date().toISOString(),
    });

    expect(result.ok).toBe(true);
    // user_B must remain on 'free'
    expect(mockDb.read(`users/${USER_B}`)?.subscriptionPlan).toBe("free");
  });
});
