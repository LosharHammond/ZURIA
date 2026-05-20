/**
 * lib/intelligence/relationship-memory.ts
 *
 * Relationship Memory — per-entity behavioral profiles.
 *
 * ZURIA builds a profile for every supplier and customer encountered in
 * transactions. These profiles power:
 *   - "Kojo usually pays within 8 days"
 *   - "Last price from Aboagye Suppliers was GH₵380"
 *   - "Ama buys rice almost every Tuesday"
 *   - "This supplier's prices have gone up 12% over 3 months"
 *
 * Storage: Firestore `relationship_memory` collection.
 * Doc ID:  `${businessId}_${normalizedEntityName}` (deterministic, idempotent)
 *
 * Profiles are upserted after every relevant transaction — no background
 * job needed; they stay fresh automatically.
 *
 * Server-only.
 */

import { getAdminDb } from "@/lib/firebase/admin";
import { collections } from "@/lib/firebase/collections";
import type { Transaction, Debt } from "@/types/domain";
import { createLogger } from "@/lib/observability/logger";

const logger = createLogger("relationship-memory");

// ─── Types ────────────────────────────────────────────────────────────────────

export type EntityRole = "supplier" | "customer" | "both";

export interface PriceHistoryEntry {
  amount: number;
  date: string;
  productName: string | null;
}

export interface PurchaseEntry {
  amount: number;
  date: string;
  productName: string | null;
}

/**
 * Supplier behavioral profile — built from `stock_purchase` transactions.
 */
export interface SupplierMemory {
  businessId: string;
  entityName: string;
  normalizedName: string;
  role: "supplier" | "both";

  /** Total number of purchases from this supplier */
  totalPurchases: number;
  /** Total GHS spent with this supplier */
  totalSpent: number;
  /** Average amount per purchase */
  avgPurchaseAmount: number;
  /** Average days between consecutive purchases */
  avgDaysBetweenPurchases: number | null;
  /** Last 5 purchases (most recent first) */
  recentPurchases: PurchaseEntry[];
  /** Price history for specific products from this supplier */
  priceHistory: PriceHistoryEntry[];
  /** Most purchased product from this supplier */
  topProduct: string | null;
  /** Whether prices are trending up (+1), down (-1), or flat (0) */
  priceTrend: 1 | 0 | -1;

  updatedAt: string;
  createdAt: string;
}

/**
 * Customer behavioral profile — built from `debt` and `repayment` transactions.
 */
export interface CustomerMemory {
  businessId: string;
  entityName: string;
  normalizedName: string;
  role: "customer" | "both";

  /** Total number of debt entries for this customer */
  debtCount: number;
  /** Cumulative value of all debts ever recorded */
  totalDebtHistorical: number;
  /** Current outstanding debt amount */
  currentOutstanding: number;
  /** Average days from debt creation to paid status (null if never paid) */
  avgDaysToPayDebt: number | null;
  /** Median days to pay (more robust than average) */
  medianDaysToPayDebt: number | null;
  /** Payment reliability: "reliable" | "slow" | "erratic" | "unknown" */
  paymentBehavior: "reliable" | "slow" | "erratic" | "unknown";
  /** Total amount fully repaid */
  totalRepaid: number;
  /** Total amount still outstanding across all debts */
  totalOutstanding: number;
  /** How many debts are still open */
  openDebtCount: number;
  /** Days since last activity (sale, debt, repayment) */
  daysSinceLastActivity: number | null;
  /** Most bought product */
  topProduct: string | null;

  updatedAt: string;
  createdAt: string;
}

// ─── Normalization ────────────────────────────────────────────────────────────

export function normalizeEntityName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[''`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function entityDocId(businessId: string, name: string): string {
  const norm = normalizeEntityName(name);
  // Keep doc ID safe for Firestore path segments
  const safe = norm.replace(/[\/\\.#$\[\]]/g, "_").slice(0, 100);
  return `${businessId}_${safe}`;
}

// ─── Update after a transaction ──────────────────────────────────────────────

/**
 * Called after recording any transaction that involves a named counterparty.
 * Updates or creates the relationship memory doc for that entity.
 * Errors are swallowed — this is a best-effort enrichment, never blocking.
 */
export async function updateRelationshipMemory(
  transaction: Transaction,
  debts: Debt[] = [],
): Promise<void> {
  try {
    const entityName = resolveEntityName(transaction);
    if (!entityName) return;

    const { type, businessId } = transaction;

    if (type === "stock_purchase") {
      await upsertSupplierMemory(businessId, entityName, transaction);
    } else if (type === "debt" || type === "repayment") {
      await upsertCustomerMemory(businessId, entityName, transaction, debts);
    }
  } catch (err) {
    logger.warn("relationship-memory update failed (non-fatal)", {
      txId: transaction.id,
      err: String(err),
    });
  }
}

// ─── Supplier memory upsert ───────────────────────────────────────────────────

async function upsertSupplierMemory(
  businessId: string,
  entityName: string,
  tx: Transaction,
): Promise<void> {
  const db = getAdminDb();
  const docId = entityDocId(businessId, entityName);
  const ref = db.doc(`${collections.relationshipMemory}/${docId}`);

  await db.runTransaction(async (firestoreTx) => {
    const snap = await firestoreTx.get(ref);
    const existing = snap.exists ? (snap.data() as SupplierMemory) : null;
    const now = new Date().toISOString();

    // Build updated purchase history
    const newPurchase: PurchaseEntry = {
      amount: tx.amount,
      date: tx.createdAt,
      productName: tx.productName,
    };

    const recentPurchases: PurchaseEntry[] = [
      newPurchase,
      ...(existing?.recentPurchases ?? []),
    ].slice(0, 10); // keep last 10

    // Price history for the same product
    const allPriceHistory: PriceHistoryEntry[] = [
      ...(existing?.priceHistory ?? []),
      ...(tx.productName
        ? [
            {
              amount: tx.amount,
              date: tx.createdAt,
              productName: tx.productName,
            },
          ]
        : []),
    ].slice(-30); // keep last 30 price points

    // Aggregate stats
    const totalPurchases = (existing?.totalPurchases ?? 0) + 1;
    const totalSpent = (existing?.totalSpent ?? 0) + tx.amount;
    const avgPurchaseAmount = totalSpent / totalPurchases;

    // Avg days between purchases
    const avgDaysBetweenPurchases =
      recentPurchases.length >= 2
        ? calcAvgGapDays(recentPurchases.map((p) => new Date(p.date)))
        : existing?.avgDaysBetweenPurchases ?? null;

    // Top product from recent purchases
    const topProduct = mostFrequent(
      recentPurchases.map((p) => p.productName).filter(Boolean) as string[],
    );

    // Price trend — compare first half vs second half of price history
    const priceTrend = calcPriceTrend(allPriceHistory);

    const doc: SupplierMemory = {
      businessId,
      entityName,
      normalizedName: normalizeEntityName(entityName),
      role: existing?.role === "both" ? "both" : "supplier",
      totalPurchases,
      totalSpent,
      avgPurchaseAmount,
      avgDaysBetweenPurchases,
      recentPurchases,
      priceHistory: allPriceHistory,
      topProduct: topProduct ?? existing?.topProduct ?? null,
      priceTrend,
      updatedAt: now,
      createdAt: existing?.createdAt ?? now,
    };

    firestoreTx.set(ref, doc, { merge: false });
  });
}

// ─── Customer memory upsert ───────────────────────────────────────────────────

async function upsertCustomerMemory(
  businessId: string,
  entityName: string,
  tx: Transaction,
  debts: Debt[],
): Promise<void> {
  const db = getAdminDb();
  const docId = entityDocId(businessId, entityName);
  const ref = db.doc(`${collections.relationshipMemory}/${docId}`);

  await db.runTransaction(async (firestoreTx) => {
    const snap = await firestoreTx.get(ref);
    const existing = snap.exists ? (snap.data() as CustomerMemory) : null;
    const now = new Date().toISOString();

    // Find debts for this customer
    const normName = normalizeEntityName(entityName);
    const customerDebts = debts.filter((d) =>
      normalizeEntityName(d.customerName ?? "").includes(normName),
    );

    // Calculate payment behaviour from closed debts
    const paidDebts = customerDebts.filter(
      (d) => d.status === "paid" && d.lastActivityAt && d.createdAt,
    );

    const paymentDays = paidDebts.map((d) => {
      const created = new Date(d.createdAt).getTime();
      const paid = new Date(d.lastActivityAt).getTime();
      return Math.max(0, (paid - created) / 86_400_000);
    });

    const avgDaysToPayDebt =
      paymentDays.length > 0
        ? Math.round(
            paymentDays.reduce((s, d) => s + d, 0) / paymentDays.length,
          )
        : existing?.avgDaysToPayDebt ?? null;

    const medianDaysToPayDebt =
      paymentDays.length > 0
        ? calcMedian(paymentDays)
        : existing?.medianDaysToPayDebt ?? null;

    // Payment behavior classification
    const paymentBehavior = classifyPaymentBehavior(
      avgDaysToPayDebt,
      paymentDays,
    );

    // Debt totals
    const openDebts = customerDebts.filter((d) => d.status === "open");
    const totalOutstanding = openDebts.reduce(
      (s, d) => s + d.outstandingAmount,
      0,
    );
    const totalRepaid = customerDebts
      .filter((d) => d.status === "paid")
      .reduce((s, d) => s + d.originalAmount, 0);

    const totalDebtHistorical =
      tx.type === "debt"
        ? (existing?.totalDebtHistorical ?? 0) + tx.amount
        : existing?.totalDebtHistorical ?? 0;

    // Days since last activity
    const daysSinceLastActivity = Math.floor(
      (Date.now() - new Date(tx.createdAt).getTime()) / 86_400_000,
    );

    const doc: CustomerMemory = {
      businessId,
      entityName,
      normalizedName: normName,
      role: existing?.role === "both" ? "both" : "customer",
      debtCount: (existing?.debtCount ?? 0) + (tx.type === "debt" ? 1 : 0),
      totalDebtHistorical,
      currentOutstanding: totalOutstanding,
      avgDaysToPayDebt,
      medianDaysToPayDebt,
      paymentBehavior,
      totalRepaid,
      totalOutstanding,
      openDebtCount: openDebts.length,
      daysSinceLastActivity,
      topProduct:
        tx.productName ?? existing?.topProduct ?? null,
      updatedAt: now,
      createdAt: existing?.createdAt ?? now,
    };

    firestoreTx.set(ref, doc, { merge: false });
  });
}

// ─── Read helpers ─────────────────────────────────────────────────────────────

/** Load supplier profile. Returns null if no data. */
export async function getSupplierMemory(
  businessId: string,
  entityName: string,
): Promise<SupplierMemory | null> {
  try {
    const db = getAdminDb();
    const docId = entityDocId(businessId, entityName);
    const snap = await db
      .doc(`${collections.relationshipMemory}/${docId}`)
      .get();
    if (!snap.exists) return null;
    const data = snap.data() as SupplierMemory;
    if (data.role !== "supplier" && data.role !== "both") return null;
    return data;
  } catch {
    return null;
  }
}

/** Load customer profile. Returns null if no data. */
export async function getCustomerMemory(
  businessId: string,
  entityName: string,
): Promise<CustomerMemory | null> {
  try {
    const db = getAdminDb();
    const docId = entityDocId(businessId, entityName);
    const snap = await db
      .doc(`${collections.relationshipMemory}/${docId}`)
      .get();
    if (!snap.exists) return null;
    const data = snap.data() as CustomerMemory;
    if (data.role !== "customer" && data.role !== "both") return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Format a one-line human-readable summary of customer memory
 * for use in conversational responses.
 */
export function formatCustomerMemorySummary(
  mem: CustomerMemory,
): string | null {
  const parts: string[] = [];
  const name = mem.entityName.split(" ")[0] ?? mem.entityName;

  if (mem.currentOutstanding > 0) {
    parts.push(`owes GH₵${mem.currentOutstanding.toFixed(2)}`);
  }

  if (mem.avgDaysToPayDebt !== null && mem.avgDaysToPayDebt > 0) {
    if (mem.avgDaysToPayDebt <= 5) {
      parts.push(`usually pays within ${mem.avgDaysToPayDebt} days`);
    } else if (mem.avgDaysToPayDebt <= 14) {
      parts.push(`typically takes ~${mem.avgDaysToPayDebt} days to pay`);
    } else {
      parts.push(`has taken ${mem.avgDaysToPayDebt}+ days to pay before`);
    }
  }

  if (parts.length === 0) return null;
  return `_${name} ${parts.join(" and ")}._`;
}

/**
 * Format a one-line summary of supplier price trend.
 */
export function formatSupplierPriceSummary(
  mem: SupplierMemory,
): string | null {
  if (mem.recentPurchases.length < 3) return null;
  const last = mem.recentPurchases[0];
  if (!last) return null;

  const trendText =
    mem.priceTrend === 1
      ? "Prices have been going up."
      : mem.priceTrend === -1
        ? "Prices have been going down."
        : null;

  const name = mem.entityName;
  const parts: string[] = [
    `Last purchase from ${name}: GH₵${last.amount.toFixed(2)}`,
  ];
  if (trendText) parts.push(trendText);
  return `_${parts.join(". ")}_`;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function resolveEntityName(tx: Transaction): string | null {
  if (tx.customerName?.trim()) return tx.customerName.trim();
  // Try to parse from notes: "from Aboagye Supplies" / "for Ama"
  if (tx.notes) {
    const m = tx.notes.match(/\b(?:from|for|to)\s+([A-Z][a-zA-Z\s]{1,30})/);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

function calcAvgGapDays(dates: Date[]): number | null {
  if (dates.length < 2) return null;
  const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime());
  let total = 0;
  for (let i = 1; i < sorted.length; i++) {
    total += (sorted[i]!.getTime() - sorted[i - 1]!.getTime()) / 86_400_000;
  }
  return Math.round((total / (sorted.length - 1)) * 10) / 10;
}

function calcMedian(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round(((sorted[mid - 1]! + sorted[mid]!) / 2) * 10) / 10
    : sorted[mid]!;
}

function mostFrequent(items: string[]): string | null {
  if (items.length === 0) return null;
  const counts: Record<string, number> = {};
  for (const item of items) counts[item] = (counts[item] ?? 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

function calcPriceTrend(history: PriceHistoryEntry[]): 1 | 0 | -1 {
  if (history.length < 4) return 0;
  const sorted = [...history].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );
  const half = Math.floor(sorted.length / 2);
  const earlyAvg =
    sorted.slice(0, half).reduce((s, p) => s + p.amount, 0) / half;
  const lateAvg =
    sorted.slice(half).reduce((s, p) => s + p.amount, 0) /
    (sorted.length - half);
  const change = (lateAvg - earlyAvg) / earlyAvg;
  if (change > 0.05) return 1;
  if (change < -0.05) return -1;
  return 0;
}

function classifyPaymentBehavior(
  avgDays: number | null,
  allDays: number[],
): CustomerMemory["paymentBehavior"] {
  if (avgDays === null || allDays.length < 2) return "unknown";

  // Coefficient of variation — high = erratic
  const mean = avgDays;
  const variance =
    allDays.reduce((s, d) => s + Math.pow(d - mean, 2), 0) / allDays.length;
  const cv = Math.sqrt(variance) / mean;

  if (cv > 0.7) return "erratic";
  if (avgDays <= 7) return "reliable";
  if (avgDays <= 21) return "slow";
  return "erratic";
}
