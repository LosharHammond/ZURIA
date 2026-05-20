/**
 * lib/intelligence/proactive-engine.ts
 *
 * Proactive Intelligence Engine — ZURIA speaks first.
 *
 * Generates self-initiated business insights without the owner needing to
 * ask. Delivered daily by the proactive-insights cron job via WhatsApp
 * and Telegram. The engine analyses patterns and surfaces what matters.
 *
 * Insight types:
 *   expense_spike          — "Transport up 22% this week"
 *   stock_forecast         — "Rice may run out before the weekend"
 *   debt_overdue           — "3 customers are overdue (avg 5 days past normal)"
 *   revenue_trend          — "Best week in 4 weeks — keep it up!"
 *   slow_period_warning    — "Sales usually slow after the 20th — prepare now"
 *   restock_reminder       — "You usually restock on Fridays (tomorrow)"
 *   top_customer_alert     — "Ama hasn't bought in 14 days — worth checking"
 *   cash_flow_warning      — "High expenses + slow sales = cash pressure ahead"
 *   payment_behavior_alert — "Kojo is 5 days overdue. He usually pays in 3."
 *
 * Deduplication:
 *   Each insight is keyed by `${businessId}_${date}_${insightType}`.
 *   A Firestore doc is written atomically. If the doc already exists
 *   (create-if-not-exists), the insight is skipped — no duplicates.
 *
 * Delivery:
 *   The worker calls `deliverProactiveInsight` for each insight. It
 *   formats the message and sends it via the notification worker.
 *
 * Server-only.
 */

import { getAdminDb } from "@/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";
import { collections } from "@/lib/firebase/collections";
import type { Transaction, Debt } from "@/types/domain";
import { getOrRefreshBusinessDNA } from "./business-dna";
import { createLogger } from "@/lib/observability/logger";

const logger = createLogger("proactive-engine");

// ─── Types ────────────────────────────────────────────────────────────────────

export type InsightType =
  | "expense_spike"
  | "stock_forecast"
  | "debt_overdue"
  | "revenue_trend"
  | "slow_period_warning"
  | "restock_reminder"
  | "top_customer_alert"
  | "cash_flow_warning"
  | "payment_behavior_alert"
  | "business_milestone"
  | "weekly_winner";

export type InsightPriority = "high" | "medium" | "low";

export interface ProactiveInsight {
  id: string;                     // `${businessId}_${date}_${type}`
  businessId: string;
  userId: string;
  type: InsightType;
  priority: InsightPriority;
  /** Short heading (shown as bold in WhatsApp) */
  headline: string;
  /** Full insight message in ZURIA voice */
  message: string;
  /** WhatsApp-formatted message (may differ with emoji/bold) */
  whatsappMessage: string;
  /** Supporting metric shown alongside */
  metric: string | null;
  /** When the insight should be delivered */
  deliverAt: string;
  /** ISO date string YYYY-MM-DD for dedup key */
  date: string;
  delivered: boolean;
  deliveredAt: string | null;
  deliveryChannels: ("whatsapp" | "telegram" | "app")[];
  createdAt: string;
}

// ─── Main: generate insights for one business ─────────────────────────────────

/**
 * Generates all proactive insights for a single business for today.
 * Returns only new insights (dedup prevents re-creation of existing ones).
 * Called by the proactive-insights cron once per business per day.
 */
export async function generateProactiveInsights(
  userId: string,
  businessId: string,
  transactions: Transaction[],
  debts: Debt[],
): Promise<ProactiveInsight[]> {
  const today = new Date().toISOString().slice(0, 10);
  const insights: ProactiveInsight[] = [];

  // Run all generators concurrently
  const generators: Promise<ProactiveInsight | null>[] = [
    genExpenseSpike(businessId, userId, transactions, today),
    genStockForecast(businessId, userId, transactions, today),
    genDebtOverdue(businessId, userId, debts, today),
    genRevenueTrend(businessId, userId, transactions, today),
    genSlowPeriodWarning(businessId, userId, transactions, today),
    genRestockReminder(businessId, userId, transactions, today),
    genCashFlowWarning(businessId, userId, transactions, debts, today),
    genPaymentBehaviorAlert(businessId, userId, debts, today),
  ];

  const results = await Promise.allSettled(generators);

  for (const result of results) {
    if (result.status === "fulfilled" && result.value !== null) {
      insights.push(result.value);
    } else if (result.status === "rejected") {
      logger.warn("proactive insight generator failed", {
        err: String(result.reason),
      });
    }
  }

  // Write to Firestore (create-if-not-exists for dedup), then return written
  const saved = await saveInsights(insights);
  return saved;
}

// ─── Save with deduplication ──────────────────────────────────────────────────

async function saveInsights(
  insights: ProactiveInsight[],
): Promise<ProactiveInsight[]> {
  if (insights.length === 0) return [];

  const db = getAdminDb();
  const saved: ProactiveInsight[] = [];

  for (const insight of insights) {
    const ref = db.doc(`${collections.proactiveInsights}/${insight.id}`);
    try {
      // create() throws if doc exists — that's our dedup mechanism
      await ref.create(insight);
      saved.push(insight);
    } catch {
      // Already exists — skip silently
    }
  }

  logger.info("proactive insights saved", {
    attempted: insights.length,
    saved: saved.length,
    businessId: insights[0]?.businessId,
  });

  return saved;
}

// ─── Mark delivered ───────────────────────────────────────────────────────────

export async function markInsightDelivered(
  insightId: string,
  channel: "whatsapp" | "telegram" | "app",
): Promise<void> {
  try {
    const db = getAdminDb();
    await db.doc(`${collections.proactiveInsights}/${insightId}`).update({
      delivered: true,
      deliveredAt: new Date().toISOString(),
      deliveryChannels: FieldValue.arrayUnion(channel),
    });
  } catch (err) {
    logger.warn("mark insight delivered failed", { insightId, err: String(err) });
  }
}

// ─── Load pending insights for delivery ──────────────────────────────────────

export async function loadPendingInsights(
  businessId: string,
): Promise<ProactiveInsight[]> {
  try {
    const db = getAdminDb();
    const snap = await db
      .collection(collections.proactiveInsights)
      .where("businessId", "==", businessId)
      .where("delivered", "==", false)
      .orderBy("createdAt", "desc")
      .limit(5)
      .get();

    return snap.docs.map((d) => d.data() as ProactiveInsight);
  } catch {
    return [];
  }
}

// ─── Individual insight generators ───────────────────────────────────────────

async function genExpenseSpike(
  businessId: string,
  userId: string,
  transactions: Transaction[],
  date: string,
): Promise<ProactiveInsight | null> {
  const expenses = transactions.filter(
    (t) => t.type === "expense" || t.type === "cost",
  );
  if (expenses.length < 10) return null;

  // Compare this week vs last week
  const now = Date.now();
  const oneWeek = 7 * 86_400_000;
  const thisWeek = expenses.filter(
    (t) => now - new Date(t.createdAt).getTime() < oneWeek,
  );
  const lastWeek = expenses.filter((t) => {
    const age = now - new Date(t.createdAt).getTime();
    return age >= oneWeek && age < 2 * oneWeek;
  });

  if (thisWeek.length === 0 || lastWeek.length === 0) return null;

  const thisTotal = thisWeek.reduce((s, t) => s + t.amount, 0);
  const lastTotal = lastWeek.reduce((s, t) => s + t.amount, 0);
  const changePct = ((thisTotal - lastTotal) / lastTotal) * 100;

  if (changePct < 20) return null; // only surface if 20%+ increase

  // Find biggest category this week
  const categories: Record<string, number> = {};
  for (const t of thisWeek) {
    const cat = t.productName || t.category || "General";
    categories[cat] = (categories[cat] ?? 0) + t.amount;
  }
  const topCat = Object.entries(categories).sort((a, b) => b[1] - a[1])[0];

  const headline = "Expenses up this week";
  const message = topCat
    ? `Your expenses are up ${Math.round(changePct)}% compared to last week. ${topCat[0]} is the biggest cost at GH₵${topCat[1].toFixed(2)}.`
    : `Your expenses are up ${Math.round(changePct)}% this week vs last week (GH₵${thisTotal.toFixed(2)} vs GH₵${lastTotal.toFixed(2)}).`;

  return buildInsight({
    businessId,
    userId,
    date,
    type: "expense_spike",
    priority: changePct >= 40 ? "high" : "medium",
    headline,
    message,
    metric: `+${Math.round(changePct)}% expenses`,
  });
}

async function genStockForecast(
  businessId: string,
  userId: string,
  transactions: Transaction[],
  date: string,
): Promise<ProactiveInsight | null> {
  // Find products with high sale velocity and recent stock purchase
  const sales = transactions.filter((t) => t.type === "sale" && t.productName);
  if (sales.length < 5) return null;

  // Product sale counts in last 7 days
  const oneWeek = 7 * 86_400_000;
  const recentSales = sales.filter(
    (t) => Date.now() - new Date(t.createdAt).getTime() < oneWeek,
  );

  const productCounts: Record<string, number> = {};
  const productQty: Record<string, number> = {};
  for (const t of recentSales) {
    const p = t.productName!;
    productCounts[p] = (productCounts[p] ?? 0) + 1;
    productQty[p] = (productQty[p] ?? 0) + (t.quantity ?? 1);
  }

  const topProduct = Object.entries(productCounts).sort(
    (a, b) => b[1] - a[1],
  )[0];
  if (!topProduct || topProduct[1] < 3) return null;

  const [productName, saleCount] = topProduct;
  const dailyRate = productQty[productName]! / 7;

  // Last stock purchase for this product
  const lastStock = transactions
    .filter(
      (t) =>
        t.type === "stock_purchase" &&
        t.productName === productName &&
        t.quantity,
    )
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )[0];

  if (!lastStock?.quantity) return null;

  // Rough days remaining
  const totalSoldSinceRestock = transactions
    .filter(
      (t) =>
        t.type === "sale" &&
        t.productName === productName &&
        t.createdAt > lastStock.createdAt,
    )
    .reduce((s, t) => s + (t.quantity ?? 1), 0);

  const remaining = Math.max(lastStock.quantity - totalSoldSinceRestock, 0);
  const daysLeft = dailyRate > 0 ? Math.round(remaining / dailyRate) : null;

  if (daysLeft === null || daysLeft > 7) return null;

  const urgency = daysLeft <= 2 ? "high" : daysLeft <= 4 ? "medium" : "low";
  const headline =
    daysLeft <= 2
      ? `⚠️ ${productName} almost out`
      : `📦 ${productName} running low`;
  const message =
    daysLeft <= 1
      ? `${productName} may run out today. You've sold ${saleCount} this week — time to restock.`
      : `At current sales pace (~${saleCount}/week), ${productName} stock may last only ~${daysLeft} more day${daysLeft !== 1 ? "s" : ""}. Consider restocking soon.`;

  return buildInsight({
    businessId,
    userId,
    date,
    type: "stock_forecast",
    priority: urgency as InsightPriority,
    headline,
    message,
    metric: `~${daysLeft} days left`,
  });
}

async function genDebtOverdue(
  businessId: string,
  userId: string,
  debts: Debt[],
  date: string,
): Promise<ProactiveInsight | null> {
  const openDebts = debts.filter((d) => d.status === "open");
  if (openDebts.length === 0) return null;

  const now = Date.now();
  // Overdue = open for more than 14 days
  const overdue = openDebts.filter(
    (d) =>
      now - new Date(d.createdAt).getTime() > 14 * 86_400_000,
  );

  if (overdue.length === 0) return null;

  const totalOverdue = overdue.reduce((s, d) => s + d.outstandingAmount, 0);
  const avgDays = Math.round(
    overdue.reduce(
      (s, d) =>
        s + (now - new Date(d.createdAt).getTime()) / 86_400_000,
      0,
    ) / overdue.length,
  );

  const headline = `${overdue.length} customer${overdue.length > 1 ? "s" : ""} overdue`;
  const message =
    overdue.length === 1
      ? `${overdue[0]!.customerName ?? "A customer"} has owed GH₵${overdue[0]!.outstandingAmount.toFixed(2)} for ${avgDays} days. A quick reminder could help.`
      : `${overdue.length} customers owe a total of GH₵${totalOverdue.toFixed(2)} — avg ${avgDays} days overdue. Send a reminder today.`;

  return buildInsight({
    businessId,
    userId,
    date,
    type: "debt_overdue",
    priority: totalOverdue > 500 ? "high" : "medium",
    headline,
    message,
    metric: `GH₵${totalOverdue.toFixed(2)} overdue`,
  });
}

async function genRevenueTrend(
  businessId: string,
  userId: string,
  transactions: Transaction[],
  date: string,
): Promise<ProactiveInsight | null> {
  const sales = transactions.filter(
    (t) => t.type === "sale" || t.type === "repayment",
  );
  if (sales.length < 14) return null;

  const now = Date.now();
  const oneWeek = 7 * 86_400_000;

  const thisWeek = sales
    .filter((t) => now - new Date(t.createdAt).getTime() < oneWeek)
    .reduce((s, t) => s + t.amount, 0);

  const lastWeek = sales
    .filter((t) => {
      const age = now - new Date(t.createdAt).getTime();
      return age >= oneWeek && age < 2 * oneWeek;
    })
    .reduce((s, t) => s + t.amount, 0);

  if (lastWeek === 0) return null;
  const changePct = ((thisWeek - lastWeek) / lastWeek) * 100;

  if (Math.abs(changePct) < 15) return null; // not significant

  if (changePct > 0) {
    const headline = "Revenue is up this week! 🎉";
    const message = `This week's sales: GH₵${thisWeek.toFixed(2)} — that's ${Math.round(changePct)}% more than last week. Keep the momentum going!`;
    return buildInsight({
      businessId,
      userId,
      date,
      type: "revenue_trend",
      priority: "low",
      headline,
      message,
      metric: `+${Math.round(changePct)}% revenue`,
    });
  } else {
    const headline = "Revenue dipped this week";
    const message = `Sales this week (GH₵${thisWeek.toFixed(2)}) are ${Math.round(Math.abs(changePct))}% below last week. Any promotions or discounts could help push things.`;
    return buildInsight({
      businessId,
      userId,
      date,
      type: "revenue_trend",
      priority: "medium",
      headline,
      message,
      metric: `${Math.round(changePct)}% revenue`,
    });
  }
}

async function genSlowPeriodWarning(
  businessId: string,
  userId: string,
  transactions: Transaction[],
  date: string,
): Promise<ProactiveInsight | null> {
  // Look for month-end slowdown pattern
  const sales = transactions.filter((t) => t.type === "sale");
  if (sales.length < 20) return null;

  const today = new Date();
  const dayOfMonth = today.getDate();

  // Only surface in the window 17–19 (just before historically slow period)
  if (dayOfMonth < 17 || dayOfMonth > 19) return null;

  // Check if historically sales slow in the last third of the month
  const lastThirdSales = sales.filter(
    (t) => new Date(t.createdAt).getDate() >= 21,
  );
  const firstTwoThirdsSales = sales.filter(
    (t) => new Date(t.createdAt).getDate() < 21,
  );

  if (firstTwoThirdsSales.length === 0 || lastThirdSales.length === 0) {
    return null;
  }

  const lastThirdAvgPerDay =
    lastThirdSales.reduce((s, t) => s + t.amount, 0) /
    Math.max(lastThirdSales.length, 1);

  const earlyAvgPerDay =
    firstTwoThirdsSales.reduce((s, t) => s + t.amount, 0) /
    Math.max(firstTwoThirdsSales.length, 1);

  const dropPct =
    ((earlyAvgPerDay - lastThirdAvgPerDay) / earlyAvgPerDay) * 100;

  if (dropPct < 20) return null;

  const headline = "Slow period approaching";
  const message = `Based on your history, sales tend to slow after the 20th. This week is usually a good time to stock up, send debt reminders, and plan for the quieter stretch.`;

  return buildInsight({
    businessId,
    userId,
    date,
    type: "slow_period_warning",
    priority: "medium",
    headline,
    message,
    metric: `~${Math.round(dropPct)}% slower after 20th`,
  });
}

async function genRestockReminder(
  businessId: string,
  userId: string,
  transactions: Transaction[],
  date: string,
): Promise<ProactiveInsight | null> {
  // Use DNA to detect restock rhythm
  try {
    const dna = await getOrRefreshBusinessDNA(userId, businessId);
    const restockFact = dna.facts.find((f) => f.type === "restock_rhythm");
    if (!restockFact || restockFact.confidence < 0.6) return null;

    const today = new Date();
    const dayName = today.toLocaleDateString("en-GH", { weekday: "long" });

    // Check if today is a common restock day
    const restockDay = restockFact.supportingData?.commonDay as string | undefined;
    if (!restockDay) return null;

    if (restockDay.toLowerCase() !== dayName.toLowerCase()) return null;

    const headline = `🛒 Restock day`;
    const message = `${restockFact.shortStatement} — it's ${dayName}. If you need to top up stock, today's a good day.`;

    return buildInsight({
      businessId,
      userId,
      date,
      type: "restock_reminder",
      priority: "low",
      headline,
      message,
      metric: null,
    });
  } catch {
    return null;
  }
}

async function genCashFlowWarning(
  businessId: string,
  userId: string,
  transactions: Transaction[],
  debts: Debt[],
  date: string,
): Promise<ProactiveInsight | null> {
  const oneWeek = 7 * 86_400_000;
  const now = Date.now();

  const thisWeekTx = transactions.filter(
    (t) => now - new Date(t.createdAt).getTime() < oneWeek,
  );

  const revenue = thisWeekTx
    .filter((t) => t.type === "sale" || t.type === "repayment")
    .reduce((s, t) => s + t.amount, 0);

  const expenses = thisWeekTx
    .filter(
      (t) =>
        t.type === "expense" ||
        t.type === "cost" ||
        t.type === "stock_purchase",
    )
    .reduce((s, t) => s + t.amount, 0);

  const openDebtTotal = debts
    .filter((d) => d.status === "open")
    .reduce((s, d) => s + d.outstandingAmount, 0);

  // Cash pressure: expenses > 80% of revenue AND outstanding debt > 2× weekly revenue
  if (revenue === 0) return null;
  const expenseRatio = expenses / revenue;
  const debtRatio = openDebtTotal / Math.max(revenue, 1);

  if (expenseRatio < 0.8 && debtRatio < 2) return null;

  const headline = "Watch your cash flow this week";
  let message = `Expenses this week (GH₵${expenses.toFixed(2)}) are eating into revenue (GH₵${revenue.toFixed(2)}).`;
  if (openDebtTotal > 0) {
    message += ` You also have GH₵${openDebtTotal.toFixed(2)} owed to you — collecting some of that would help.`;
  }

  return buildInsight({
    businessId,
    userId,
    date,
    type: "cash_flow_warning",
    priority: expenseRatio >= 1 ? "high" : "medium",
    headline,
    message,
    metric: `Expenses ${Math.round(expenseRatio * 100)}% of revenue`,
  });
}

async function genPaymentBehaviorAlert(
  businessId: string,
  userId: string,
  debts: Debt[],
  date: string,
): Promise<ProactiveInsight | null> {
  const openDebts = debts.filter((d) => d.status === "open");
  if (openDebts.length === 0) return null;

  const now = Date.now();

  // Find the most overdue open debt
  const sorted = [...openDebts].sort(
    (a, b) =>
      now -
      new Date(a.createdAt).getTime() -
      (now - new Date(b.createdAt).getTime()),
  );

  const mostOverdue = sorted[0];
  if (!mostOverdue) return null;

  const daysOpen = Math.floor(
    (now - new Date(mostOverdue.createdAt).getTime()) / 86_400_000,
  );

  if (daysOpen < 5) return null;

  const name =
    mostOverdue.customerName?.split(" ")[0] ?? "A customer";
  const headline = `${name} is overdue`;
  const message = `${name} has owed GH₵${mostOverdue.outstandingAmount.toFixed(2)} for ${daysOpen} days. A friendly reminder on WhatsApp could go a long way.`;

  return buildInsight({
    businessId,
    userId,
    date,
    type: "payment_behavior_alert",
    priority: daysOpen >= 14 ? "high" : "medium",
    headline,
    message,
    metric: `${daysOpen} days outstanding`,
  });
}

// ─── Factory helper ───────────────────────────────────────────────────────────

interface InsightParams {
  businessId: string;
  userId: string;
  date: string;
  type: InsightType;
  priority: InsightPriority;
  headline: string;
  message: string;
  metric: string | null;
}

function buildInsight(params: InsightParams): ProactiveInsight {
  const { businessId, userId, date, type, priority, headline, message, metric } =
    params;

  const id = `${businessId}_${date}_${type}`;
  const now = new Date().toISOString();

  // WhatsApp formatting: bold headline, then message
  const whatsappMessage = `*${headline}*\n\n${message}${metric ? `\n\n📊 _${metric}_` : ""}`;

  return {
    id,
    businessId,
    userId,
    type,
    priority,
    headline,
    message,
    whatsappMessage,
    metric,
    deliverAt: now,
    date,
    delivered: false,
    deliveredAt: null,
    deliveryChannels: [],
    createdAt: now,
  };
}
