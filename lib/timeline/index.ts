/**
 * lib/timeline/index.ts
 *
 * Business Timeline Engine.
 *
 * A chronological operational intelligence layer that tracks significant
 * business events. Users can "scroll through business history."
 *
 * Tracks: inventory restocks, debt increases, revenue shifts, supplier changes,
 * operational anomalies, cash warnings, milestones, risk events.
 *
 * This is emotionally sticky, operationally powerful, and highly differentiated.
 *
 * Server-only.
 */

import { getAdminDb } from "@/lib/firebase/admin";
import type { Transaction, Debt } from "@/types/domain";

// ─── Types ────────────────────────────────────────────────────────────────────

export type TimelineEventType =
  | "revenue_milestone"    // Best day/week ever
  | "revenue_decline"      // Revenue dropped significantly
  | "debt_created"         // New customer debt
  | "debt_cleared"         // Debt fully paid
  | "debt_milestone"       // Total debt crossed a threshold
  | "inventory_restock"    // Stock purchased
  | "inventory_low"        // Low stock warning
  | "cash_warning"         // Cash flow concern
  | "expense_spike"        // Unusual expense
  | "new_supplier"         // First transaction with a new supplier
  | "new_customer"         // First transaction with a new customer
  | "operational_anomaly"  // Transaction pattern deviation
  | "business_milestone"   // General achievement
  | "risk_alert";          // High-risk signal

export interface TimelineEvent {
  id: string;
  businessId: string;
  userId: string;
  type: TimelineEventType;
  title: string;          // e.g. "Best sales day this month"
  description: string;    // e.g. "GH₵850 in sales — 34% above your daily average"
  metric?: number;        // The key number
  relatedEntityId?: string; // transactionId, debtId etc.
  severity: "positive" | "neutral" | "warning" | "critical";
  icon: string;           // emoji: "🏆", "⚠️", "📦", "💰", "🚨"
  occurredAt: string;     // ISO timestamp of when the event occurred
  createdAt: string;      // when we recorded it
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns the ISO date-only prefix "YYYY-MM-DD" for a given ISO timestamp. */
function toDateKey(isoTs: string): string {
  return isoTs.slice(0, 10);
}

/** Groups transactions by their date key. */
function groupByDay(transactions: Transaction[]): Map<string, Transaction[]> {
  const map = new Map<string, Transaction[]>();
  for (const t of transactions) {
    const key = toDateKey(t.createdAt);
    const list = map.get(key) ?? [];
    list.push(t);
    map.set(key, list);
  }
  return map;
}

/** Sum of transaction amounts for a given type subset. */
function sumAmounts(txns: Transaction[], types: string[]): number {
  return txns.reduce((acc, t) => (types.includes(t.type) ? acc + t.amount : acc), 0);
}

/** Generate a stable event id from its key properties (not cryptographically secure, but deterministic). */
function makeEventId(
  businessId: string,
  type: TimelineEventType,
  dateKey: string,
  extra = "",
): string {
  const raw = `${businessId}:${type}:${dateKey}:${extra}`;
  // Simple djb2 hash to generate a short numeric id segment
  let hash = 5381;
  for (let i = 0; i < raw.length; i++) {
    hash = ((hash << 5) + hash) ^ raw.charCodeAt(i);
    hash = hash >>> 0; // keep it unsigned 32-bit
  }
  return `tl_${hash.toString(36)}_${dateKey.replace(/-/g, "")}`;
}

// ─── buildTimelineFromTransactions ───────────────────────────────────────────

/**
 * Pure function. Scans transactions and debts to generate timeline events.
 * Returns sorted by occurredAt descending. Max 50 events. Never throws.
 */
export function buildTimelineFromTransactions(
  userId: string,
  businessId: string,
  transactions: Transaction[],
  debts: Debt[],
  avgDailyRevenue: number,
): TimelineEvent[] {
  try {
    const events: TimelineEvent[] = [];
    const now = new Date().toISOString();

    const revenueTypes = ["sale", "repayment"];
    const expenseTypes = ["expense", "cost", "salary", "tax"];

    const byDay = groupByDay(transactions);
    const sortedDayKeys = [...byDay.keys()].sort();

    // ── Revenue milestones & expense spikes ───────────────────────────────────
    for (const dayKey of sortedDayKeys) {
      const dayTxns = byDay.get(dayKey) ?? [];
      const dayRevenue = sumAmounts(dayTxns, revenueTypes);
      const dayExpenses = sumAmounts(dayTxns, expenseTypes);
      // Use midnight UTC for the day as the occurredAt timestamp
      const occurredAt = `${dayKey}T00:00:00.000Z`;

      // Revenue milestone: daily revenue > avgDailyRevenue * 1.5
      if (avgDailyRevenue > 0 && dayRevenue > avgDailyRevenue * 1.5) {
        const pct = Math.round(((dayRevenue - avgDailyRevenue) / avgDailyRevenue) * 100);
        events.push({
          id: makeEventId(businessId, "revenue_milestone", dayKey),
          businessId,
          userId,
          type: "revenue_milestone",
          title: "Outstanding sales day",
          description: `GH₵${dayRevenue.toFixed(2)} in sales — ${pct}% above your daily average`,
          metric: dayRevenue,
          severity: "positive",
          icon: "🏆",
          occurredAt,
          createdAt: now,
        });
      }

      // Expense spike: single day expenses > avgDailyRevenue * 0.3
      if (avgDailyRevenue > 0 && dayExpenses > avgDailyRevenue * 0.3) {
        events.push({
          id: makeEventId(businessId, "expense_spike", dayKey),
          businessId,
          userId,
          type: "expense_spike",
          title: "Unusual expense day",
          description: `GH₵${dayExpenses.toFixed(2)} in expenses — higher than normal for this day`,
          metric: dayExpenses,
          severity: "warning",
          icon: "⚠️",
          occurredAt,
          createdAt: now,
        });
      }
    }

    // ── Revenue decline: 3 consecutive days < avgDailyRevenue * 0.4 ──────────
    if (avgDailyRevenue > 0 && sortedDayKeys.length >= 3) {
      for (let i = 0; i <= sortedDayKeys.length - 3; i++) {
        const streak = sortedDayKeys.slice(i, i + 3);
        const allLow = streak.every((k) => {
          const dayTxns = byDay.get(k) ?? [];
          return sumAmounts(dayTxns, revenueTypes) < avgDailyRevenue * 0.4;
        });
        if (allLow) {
          const firstDay = streak[0];
          const occurredAt = `${firstDay}T00:00:00.000Z`;
          events.push({
            id: makeEventId(businessId, "revenue_decline", firstDay),
            businessId,
            userId,
            type: "revenue_decline",
            title: "3 low-revenue days in a row",
            description: `Revenue stayed below 40% of your daily average for 3 consecutive days from ${streak[0]} to ${streak[2]}`,
            severity: "warning",
            icon: "📉",
            occurredAt,
            createdAt: now,
          });
          // Only emit once per detected streak (skip overlapping windows for the same streak start)
          i += 2;
        }
      }
    }

    // ── Debt events ────────────────────────────────────────────────────────────
    const debtTransactions = transactions.filter((t) => t.type === "debt");
    for (const t of debtTransactions) {
      events.push({
        id: makeEventId(businessId, "debt_created", toDateKey(t.createdAt), t.id),
        businessId,
        userId,
        type: "debt_created",
        title: "New credit sale recorded",
        description: `GH₵${t.amount.toFixed(2)} owed${t.customerName ? ` by ${t.customerName}` : ""}`,
        metric: t.amount,
        relatedEntityId: t.id,
        severity: "neutral",
        icon: "📋",
        occurredAt: t.createdAt,
        createdAt: now,
      });
    }

    // Debt cleared events: debts with status "paid"
    const paidDebts = debts.filter((d) => d.status === "paid");
    for (const d of paidDebts) {
      events.push({
        id: makeEventId(businessId, "debt_cleared", toDateKey(d.lastActivityAt), d.id),
        businessId,
        userId,
        type: "debt_cleared",
        title: "Debt fully cleared",
        description: `GH₵${d.originalAmount.toFixed(2)} debt${d.customerName ? ` from ${d.customerName}` : ""} fully paid`,
        metric: d.originalAmount,
        relatedEntityId: d.id,
        severity: "positive",
        icon: "✅",
        occurredAt: d.lastActivityAt,
        createdAt: now,
      });
    }

    // Debt milestone: total outstanding crosses multiples of weekly avg revenue
    const weeklyRevenue = avgDailyRevenue * 7;
    if (weeklyRevenue > 0) {
      const totalOutstanding = debts
        .filter((d) => d.status === "open")
        .reduce((acc, d) => acc + d.outstandingAmount, 0);

      const multiplier = Math.floor(totalOutstanding / weeklyRevenue);
      if (multiplier >= 1) {
        const milestoneTs =
          debts.length > 0
            ? debts
                .filter((d) => d.status === "open")
                .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.createdAt ?? now
            : now;

        events.push({
          id: makeEventId(businessId, "debt_milestone", toDateKey(milestoneTs), `${multiplier}`),
          businessId,
          userId,
          type: "debt_milestone",
          title: `Total debt crossed ${multiplier}x weekly revenue`,
          description: `Outstanding debt of GH₵${totalOutstanding.toFixed(2)} has exceeded ${multiplier} weeks of revenue`,
          metric: totalOutstanding,
          severity: multiplier >= 3 ? "critical" : "warning",
          icon: "🚨",
          occurredAt: milestoneTs,
          createdAt: now,
        });
      }
    }

    // ── Inventory restocks ─────────────────────────────────────────────────────
    const restocks = transactions.filter((t) => t.type === "stock_purchase");
    for (const t of restocks) {
      events.push({
        id: makeEventId(businessId, "inventory_restock", toDateKey(t.createdAt), t.id),
        businessId,
        userId,
        type: "inventory_restock",
        title: "Stock purchased",
        description: `GH₵${t.amount.toFixed(2)} spent on${t.productName ? ` ${t.productName}` : " stock"}`,
        metric: t.amount,
        relatedEntityId: t.id,
        severity: "neutral",
        icon: "📦",
        occurredAt: t.createdAt,
        createdAt: now,
      });
    }

    // ── Sort descending, cap at 50 ─────────────────────────────────────────────
    events.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    return events.slice(0, 50);
  } catch {
    return [];
  }
}

// ─── saveTimelineEvent ────────────────────────────────────────────────────────

/** Fire-and-forget Firestore write to "business_timeline" collection. Never throws. */
export async function saveTimelineEvent(event: TimelineEvent): Promise<void> {
  try {
    const db = getAdminDb();
    await db.collection("business_timeline").doc(event.id).set(event, { merge: true });
  } catch {
    // silent
  }
}

// ─── getBusinessTimeline ──────────────────────────────────────────────────────

/**
 * Reads from Firestore "business_timeline" collection, ordered by occurredAt desc,
 * limited to last N days. Returns [] on error.
 */
export async function getBusinessTimeline(
  businessId: string,
  limitDays = 30,
): Promise<TimelineEvent[]> {
  try {
    const db = getAdminDb();
    const cutoff = new Date(Date.now() - limitDays * 24 * 60 * 60 * 1000).toISOString();
    const snap = await db
      .collection("business_timeline")
      .where("businessId", "==", businessId)
      .where("occurredAt", ">=", cutoff)
      .orderBy("occurredAt", "desc")
      .limit(50)
      .get();

    return snap.docs.map((d) => d.data() as TimelineEvent);
  } catch {
    return [];
  }
}

// ─── refreshTimeline ──────────────────────────────────────────────────────────

/**
 * Builds timeline events and saves new ones that don't exist yet (deduplicated by
 * day + type). Fire-and-forget, never throws.
 */
export async function refreshTimeline(
  userId: string,
  businessId: string,
  transactions: Transaction[],
  debts: Debt[],
  avgDailyRevenue: number,
): Promise<void> {
  try {
    const freshEvents = buildTimelineFromTransactions(
      userId,
      businessId,
      transactions,
      debts,
      avgDailyRevenue,
    );

    if (freshEvents.length === 0) return;

    // Fetch existing event ids for this business from the last 60 days
    const db = getAdminDb();
    const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    const existingSnap = await db
      .collection("business_timeline")
      .where("businessId", "==", businessId)
      .where("occurredAt", ">=", cutoff)
      .select("id")
      .get();

    const existingIds = new Set(existingSnap.docs.map((d) => (d.data() as { id: string }).id));

    // Save only the new ones (fire-and-forget, errors swallowed)
    await Promise.allSettled(
      freshEvents
        .filter((e) => !existingIds.has(e.id))
        .map((e) => saveTimelineEvent(e)),
    );
  } catch {
    // silent
  }
}
