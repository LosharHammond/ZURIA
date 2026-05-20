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
  | "revenue_milestone"       // Best day/week ever
  | "revenue_decline"         // Revenue dropped significantly
  | "debt_created"            // New customer debt
  | "debt_cleared"            // Debt fully paid
  | "debt_milestone"          // Total debt crossed a threshold
  | "inventory_restock"       // Stock purchased
  | "inventory_low"           // Low stock warning
  | "cash_warning"            // Cash flow concern
  | "expense_spike"           // Unusual expense
  | "new_supplier"            // First transaction with a new supplier
  | "new_customer"            // First transaction with a new customer
  | "operational_anomaly"     // Transaction pattern deviation
  | "business_milestone"      // General achievement
  | "risk_alert"              // High-risk signal
  // ── Retention Engine additions ────────────────────────────────────────────
  | "supplier_price_change"   // Supplier price moved ≥10% vs historical avg
  | "debt_recovery_milestone" // Recovered significant overdue debt amount
  | "stock_forecast_warning"  // AI predicts stock-out within N days
  | "expense_category_spike"  // One expense category jumps unusually
  | "customer_loyalty_milestone" // A customer hits a repeat-purchase milestone
  | "business_anniversary";   // 1-month, 3-month, 6-month, 1-year on ZURIA

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

    // ── Supplier price changes ─────────────────────────────────────────────────
    // Group stock_purchase by product, check if latest price differs ≥10% from avg
    const stockPurchases = transactions.filter((t) => t.type === "stock_purchase" && t.productName);
    const byProduct = new Map<string, Transaction[]>();
    for (const t of stockPurchases) {
      const key = t.productName!;
      const list = byProduct.get(key) ?? [];
      list.push(t);
      byProduct.set(key, list);
    }
    for (const [product, purchases] of byProduct.entries()) {
      if (purchases.length < 3) continue;
      const sorted = [...purchases].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const latest = sorted[sorted.length - 1]!;
      const prior = sorted.slice(0, -1);
      const priorAvg = prior.reduce((s, t) => s + t.amount, 0) / prior.length;
      const changePct = ((latest.amount - priorAvg) / priorAvg) * 100;
      if (Math.abs(changePct) < 10) continue;
      const direction = changePct > 0 ? "up" : "down";
      const emoji = changePct > 0 ? "📈" : "📉";
      events.push({
        id: makeEventId(businessId, "supplier_price_change", toDateKey(latest.createdAt), product),
        businessId,
        userId,
        type: "supplier_price_change",
        title: `${product} price ${direction} ${Math.round(Math.abs(changePct))}%`,
        description: `Latest purchase: GH₵${latest.amount.toFixed(2)} vs prior avg GH₵${priorAvg.toFixed(2)} (${changePct > 0 ? "+" : ""}${Math.round(changePct)}%)`,
        metric: latest.amount,
        relatedEntityId: latest.id,
        severity: Math.abs(changePct) >= 25 ? "warning" : "neutral",
        icon: emoji,
        occurredAt: latest.createdAt,
        createdAt: now,
      });
    }

    // ── Debt recovery milestones ───────────────────────────────────────────────
    // Surface when total repaid this month crosses significant thresholds
    const thisMonth = new Date().toISOString().slice(0, 7);
    const repaymentsTx = transactions.filter(
      (t) => t.type === "repayment" && t.createdAt.startsWith(thisMonth),
    );
    if (repaymentsTx.length > 0) {
      const monthlyRecovered = repaymentsTx.reduce((s, t) => s + t.amount, 0);
      if (avgDailyRevenue > 0 && monthlyRecovered >= avgDailyRevenue * 3) {
        const lastRepayment = repaymentsTx.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]!;
        events.push({
          id: makeEventId(businessId, "debt_recovery_milestone", thisMonth),
          businessId,
          userId,
          type: "debt_recovery_milestone",
          title: "Strong debt recovery this month",
          description: `GH₵${monthlyRecovered.toFixed(2)} collected from customers this month — ${repaymentsTx.length} payment${repaymentsTx.length > 1 ? "s" : ""} received`,
          metric: monthlyRecovered,
          severity: "positive",
          icon: "💚",
          occurredAt: lastRepayment.createdAt,
          createdAt: now,
        });
      }
    }

    // ── Expense category spikes ────────────────────────────────────────────────
    // Find if any single expense category exceeded 50% of total expenses in a day
    for (const dayKey of sortedDayKeys) {
      const dayTxns = byDay.get(dayKey) ?? [];
      const dayExpenses = dayTxns.filter(
        (t) => t.type === "expense" || t.type === "cost",
      );
      if (dayExpenses.length < 2) continue;
      const totalDayExpenses = dayExpenses.reduce((s, t) => s + t.amount, 0);
      const catTotals: Record<string, number> = {};
      for (const t of dayExpenses) {
        const cat = t.productName || t.category || "General";
        catTotals[cat] = (catTotals[cat] ?? 0) + t.amount;
      }
      for (const [cat, catTotal] of Object.entries(catTotals)) {
        const share = catTotal / totalDayExpenses;
        if (share >= 0.6 && catTotal >= 50) {
          events.push({
            id: makeEventId(businessId, "expense_category_spike", dayKey, cat),
            businessId,
            userId,
            type: "expense_category_spike",
            title: `${cat} dominated expenses`,
            description: `${cat} was ${Math.round(share * 100)}% of all expenses on ${dayKey} (GH₵${catTotal.toFixed(2)})`,
            metric: catTotal,
            severity: "warning",
            icon: "💸",
            occurredAt: `${dayKey}T00:00:00.000Z`,
            createdAt: now,
          });
        }
      }
    }

    // ── Customer loyalty milestones ───────────────────────────────────────────
    // Surface when a customer completes 5th, 10th, 20th purchase
    const salesByCustomer = new Map<string, Transaction[]>();
    for (const t of transactions.filter((t) => t.type === "sale" && t.customerName)) {
      const key = t.customerName!;
      const list = salesByCustomer.get(key) ?? [];
      list.push(t);
      salesByCustomer.set(key, list);
    }
    for (const [customer, cSales] of salesByCustomer.entries()) {
      const count = cSales.length;
      const milestones = [5, 10, 20, 50];
      for (const milestone of milestones) {
        if (count === milestone) {
          const lastSale = cSales.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]!;
          const totalSpent = cSales.reduce((s, t) => s + t.amount, 0);
          events.push({
            id: makeEventId(businessId, "customer_loyalty_milestone", toDateKey(lastSale.createdAt), `${customer}_${milestone}`),
            businessId,
            userId,
            type: "customer_loyalty_milestone",
            title: `${customer.split(" ")[0]} is a loyal customer 🌟`,
            description: `${customer} has made ${milestone} purchases with you, spending GH₵${totalSpent.toFixed(2)} total`,
            metric: totalSpent,
            severity: "positive",
            icon: "🌟",
            occurredAt: lastSale.createdAt,
            createdAt: now,
          });
        }
      }
    }

    // ── Business anniversary ──────────────────────────────────────────────────
    // Surface when the first ever transaction was 1, 3, 6, or 12 months ago
    if (transactions.length > 0) {
      const firstTx = [...transactions].sort((a, b) =>
        a.createdAt.localeCompare(b.createdAt),
      )[0]!;
      const firstDate = new Date(firstTx.createdAt);
      const monthsAgo = [1, 3, 6, 12];
      for (const months of monthsAgo) {
        const anniversaryDate = new Date(firstDate);
        anniversaryDate.setMonth(anniversaryDate.getMonth() + months);
        const todayKey = new Date().toISOString().slice(0, 10);
        const annKey = anniversaryDate.toISOString().slice(0, 10);
        if (annKey === todayKey) {
          const label =
            months === 12 ? "1 year" : months === 6 ? "6 months" : months === 3 ? "3 months" : "1 month";
          events.push({
            id: makeEventId(businessId, "business_anniversary", annKey, `${months}m`),
            businessId,
            userId,
            type: "business_anniversary",
            title: `${label} on ZURIA! 🎉`,
            description: `You've been tracking your business for ${label}. ZURIA has recorded ${transactions.length} transactions for you.`,
            severity: "positive",
            icon: "🎂",
            occurredAt: anniversaryDate.toISOString(),
            createdAt: now,
          });
        }
      }
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
