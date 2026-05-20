/**
 * lib/billing/index.ts
 *
 * Unified billing facade — aggregates payment stats, webhook queue health,
 * subscription metrics, and recovery data for the admin billing dashboard.
 *
 * Server-only: firebase-admin.
 */

import { getAdminDb } from "@/lib/firebase/admin";
import { collections } from "@/lib/firebase/collections";
import { getWebhookQueueStats } from "./webhooks";
import { getRecentFailedPayments, findRecoveryCandidates } from "./recovery";
import type { PaystackPayment } from "@/types/domain";
import type { WebhookQueueStats } from "./webhooks";
import type { FailedPaymentRecord, RecoveryCandidate } from "./recovery";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PaymentSummary {
  total: number;
  successful: number;
  pending: number;
  failed: number;
  totalRevenueGHS: number;
}

export interface SubscriptionBreakdown {
  free: number;
  growth: number;
  pro: number;
  enterprise: number;
  total: number;
  activePaid: number;
}

export interface BillingDashboardData {
  generatedAt: string;
  paymentStats: {
    today: PaymentSummary;
    thisWeek: PaymentSummary;
    thisMonth: PaymentSummary;
  };
  subscriptions: SubscriptionBreakdown;
  webhookQueue: WebhookQueueStats;
  failedPayments: FailedPaymentRecord[];
  recoveryCandidates: RecoveryCandidate[];
  recentActivations: RecentActivation[];
}

export interface RecentActivation {
  reference: string;
  userId: string;
  plan: string;
  amountGHS: number;
  activatedAt: string;
  channel?: string;
  source: string;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function buildSummary(payments: PaystackPayment[]): PaymentSummary {
  let successful = 0, pending = 0, failed = 0, totalRevenueGHS = 0;
  for (const p of payments) {
    if      (p.status === "success") { successful++; totalRevenueGHS += p.amountGHS; }
    else if (p.status === "pending") { pending++; }
    else                              { failed++; }
  }
  return { total: payments.length, successful, pending, failed, totalRevenueGHS };
}

async function fetchPaymentsSince(db: ReturnType<typeof getAdminDb>, since: string): Promise<PaystackPayment[]> {
  const snap = await db
    .collection(collections.payments)
    .where("createdAt", ">=", since)
    .orderBy("createdAt", "desc")
    .limit(500)
    .get();
  return snap.docs.map((d) => d.data() as PaystackPayment);
}

// ─── Main Aggregator ──────────────────────────────────────────────────────────

/**
 * Build the complete billing dashboard data.
 * Runs all queries in parallel. Never throws.
 */
export async function getBillingDashboardData(): Promise<BillingDashboardData> {
  const generatedAt = new Date().toISOString();
  const now = new Date();

  const todayStart  = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const weekStart   = new Date(now.getTime() - 7  * 86_400_000).toISOString();
  const monthStart  = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

  const db = getAdminDb();

  const [
    todayPayments,
    weekPayments,
    monthPayments,
    usersSnap,
    webhookQueue,
    failedPayments,
    recoveryCandidates,
    activationsSnap,
  ] = await Promise.allSettled([
    fetchPaymentsSince(db, todayStart),
    fetchPaymentsSince(db, weekStart),
    fetchPaymentsSince(db, monthStart),
    db.collection(collections.users).select("subscriptionPlan", "subscriptionExpiresAt").get(),
    getWebhookQueueStats(),
    getRecentFailedPayments(20),
    findRecoveryCandidates(15, 24),
    db.collection(collections.paymentEvents)
      .where("eventType", "==", "SUBSCRIPTION_ACTIVATED")
      .orderBy("createdAt", "desc")
      .limit(20)
      .get(),
  ]);

  // Payment stats
  const todayPmts   = todayPayments.status  === "fulfilled" ? todayPayments.value  : [];
  const weekPmts    = weekPayments.status   === "fulfilled" ? weekPayments.value   : [];
  const monthPmts   = monthPayments.status  === "fulfilled" ? monthPayments.value  : [];

  // Subscription breakdown
  const subs: SubscriptionBreakdown = { free: 0, growth: 0, pro: 0, enterprise: 0, total: 0, activePaid: 0 };
  if (usersSnap.status === "fulfilled") {
    for (const doc of usersSnap.value.docs) {
      const d    = doc.data() as { subscriptionPlan?: string; subscriptionExpiresAt?: string | null };
      const plan = d.subscriptionPlan ?? "free";
      subs.total++;
      if      (plan === "growth")     subs.growth++;
      else if (plan === "pro")        subs.pro++;
      else if (plan === "enterprise") subs.enterprise++;
      else                            subs.free++;

      if (plan !== "free") {
        const exp = d.subscriptionExpiresAt;
        if (!exp || new Date(exp) > now) subs.activePaid++;
      }
    }
  }

  // Recent activations
  const recentActivations: RecentActivation[] = [];
  if (activationsSnap.status === "fulfilled") {
    for (const doc of activationsSnap.value.docs) {
      const d = doc.data() as Record<string, unknown>;
      recentActivations.push({
        reference:   String(d.paystackReference ?? ""),
        userId:      String(d.userId            ?? ""),
        plan:        String(d.plan              ?? ""),
        amountGHS:   Number(d.amountGHS         ?? 0),
        activatedAt: String(d.createdAt         ?? ""),
        channel:     d.channel ? String(d.channel) : undefined,
        source:      String(d.source            ?? "webhook"),
      });
    }
  }

  return {
    generatedAt,
    paymentStats: {
      today:     buildSummary(todayPmts),
      thisWeek:  buildSummary(weekPmts),
      thisMonth: buildSummary(monthPmts),
    },
    subscriptions: subs,
    webhookQueue:  webhookQueue.status === "fulfilled" ? webhookQueue.value : {
      pending: 0, processing: 0, done: 0, dead: 0, failed: 0,
      total: 0, oldestPendingAt: null, deadLetters: [],
    },
    failedPayments:     failedPayments.status     === "fulfilled" ? failedPayments.value     : [],
    recoveryCandidates: recoveryCandidates.status === "fulfilled" ? recoveryCandidates.value : [],
    recentActivations,
  };
}
