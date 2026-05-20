/**
 * lib/intelligence/smart-recall.ts
 *
 * Smart Recall Layer — the voice of ZURIA's memory.
 *
 * Transforms every transaction confirmation from a plain acknowledgement
 * into a memory-rich, business-aware response. After each recorded
 * transaction ZURIA surfaces what it knows: price history, customer
 * payment behaviour, stock velocity, expense anomalies, debt totals.
 *
 * Examples:
 *   Stock purchase → "Last time from this supplier, price was GH₵380.
 *                     Today's GH₵450 is +18%. Worth checking."
 *   Debt recorded  → "Kojo now owes GH₵1,250 total. He usually pays
 *                     within 8 days — so by Thursday."
 *   Sale recorded  → "Rice is your #1 product. At today's pace,
 *                     stock may last ~4 more days."
 *   Expense logged → "Transport avg is GH₵42. Today's GH₵65
 *                     is 55% higher than usual."
 *
 * Architecture:
 *   Called by the transaction handler AFTER saving to Firestore.
 *   Reads from DNA (cached), relationship memory (Firestore lookup),
 *   and recent transactions (last 30 days). All reads are non-blocking;
 *   any error produces null (no memory note) — never crashes the flow.
 *
 * Server-only.
 */

import { getAdminDb } from "@/lib/firebase/admin";
import { collections } from "@/lib/firebase/collections";
import type { Transaction, Debt } from "@/types/domain";
import { getOrRefreshBusinessDNA, getRelevantDNAFacts } from "./business-dna";
import { createLogger } from "@/lib/observability/logger";

const logger = createLogger("smart-recall");

// ─── Public API types ──────────────────────────────────────────────────────────

export interface SmartRecallNote {
  /** The memory-enriched addendum appended after the base confirmation */
  text: string;
  /** Which signal triggered this note */
  trigger: RecallTrigger;
  /** How confident we are (0–1). Low confidence = softer language */
  confidence: number;
}

export type RecallTrigger =
  | "supplier_price_change"   // price vs historical average from same supplier
  | "debt_total_with_eta"     // total owed by this customer + predicted payment
  | "stock_velocity"          // days-of-stock remaining estimate
  | "expense_spike"           // expense vs rolling average for same category
  | "debt_overdue_warning"    // customer historically pays fast; now overdue
  | "top_product_milestone"   // sale of consistently top-selling product
  | "revenue_streak"          // consecutive good days
  | "dna_pattern";            // generic DNA fact relevant to this transaction

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Build a Smart Recall note for a transaction that was just recorded.
 * Returns null if no meaningful memory context is available or if any
 * error occurs — callers should treat null as "no note to append".
 */
export async function buildSmartRecallNote(
  transaction: Transaction,
  allDebts?: Debt[],
): Promise<SmartRecallNote | null> {
  try {
    const { userId, businessId, type } = transaction;

    // Run all checks in parallel — whichever resolves first with a note wins.
    const checks: Promise<SmartRecallNote | null>[] = [];

    if (type === "stock_purchase") {
      checks.push(checkSupplierPriceChange(transaction));
    }

    if (type === "debt" || type === "repayment") {
      checks.push(checkDebtTotalWithEta(transaction, allDebts ?? []));
    }

    if (type === "sale") {
      checks.push(checkStockVelocity(transaction));
      checks.push(checkTopProductMilestone(transaction, userId, businessId));
    }

    if (type === "expense" || type === "cost") {
      checks.push(checkExpenseSpike(transaction));
    }

    // Always add a DNA-backed note as a fallback
    checks.push(buildDnaFallbackNote(transaction));

    const results = await Promise.allSettled(checks);

    // Return the first successful, non-null note
    for (const result of results) {
      if (result.status === "fulfilled" && result.value !== null) {
        return result.value;
      }
    }

    return null;
  } catch (err) {
    logger.warn("smart-recall error (non-fatal)", { err: String(err) });
    return null;
  }
}

// ─── Supplier price-change detection ─────────────────────────────────────────

async function checkSupplierPriceChange(
  tx: Transaction,
): Promise<SmartRecallNote | null> {
  if (!tx.productName) return null;

  try {
    const db = getAdminDb();
    // Look at the last 10 stock purchases for the same product
    const snap = await db
      .collection(collections.transactions)
      .where("businessId", "==", tx.businessId)
      .where("type", "==", "stock_purchase")
      .where("productName", "==", tx.productName)
      .orderBy("createdAt", "desc")
      .limit(11) // 11 so we can exclude the current one
      .get();

    const previous = snap.docs
      .map((d) => d.data() as Transaction)
      .filter((t) => t.id !== tx.id && t.amount > 0);

    if (previous.length < 2) return null;

    const avg =
      previous.slice(0, 5).reduce((s, t) => s + t.amount, 0) /
      Math.min(previous.length, 5);

    const changePercent = ((tx.amount - avg) / avg) * 100;
    const absPct = Math.abs(changePercent);

    // Only surface if change is >= 10%
    if (absPct < 10) return null;

    const direction = changePercent > 0 ? "higher" : "lower";
    const emoji = changePercent > 0 ? "📈" : "📉";
    const last = previous[0]!;
    const lastPrice = `GH₵${last.amount.toFixed(2)}`;
    const avgPrice = `GH₵${avg.toFixed(2)}`;

    let text: string;
    if (absPct >= 25) {
      text = `${emoji} *Price alert:* Last ${tx.productName} stock cost ${lastPrice} (avg ${avgPrice}). Today's GH₵${tx.amount.toFixed(2)} is *${Math.round(absPct)}% ${direction}* — worth noting.`;
    } else {
      text = `_Last ${tx.productName} stock avg: ${avgPrice}. Today is ${Math.round(absPct)}% ${direction}._`;
    }

    return {
      text,
      trigger: "supplier_price_change",
      confidence: Math.min(0.5 + previous.length * 0.05, 0.95),
    };
  } catch {
    return null;
  }
}

// ─── Debt total + payment ETA ─────────────────────────────────────────────────

async function checkDebtTotalWithEta(
  tx: Transaction,
  allDebts: Debt[],
): Promise<SmartRecallNote | null> {
  const name =
    tx.customerName?.trim() ||
    (tx.notes ? extractNameFromNotes(tx.notes) : null);
  if (!name) return null;

  try {
    // Sum all open debts for this customer
    const db = getAdminDb();
    const normName = name.toLowerCase().replace(/\s+/g, " ").trim();

    // Try relationship memory for avg payment days
    const relDoc = await db
      .doc(`${collections.relationshipMemory}/${tx.businessId}_${normName}`)
      .get();

    const relData = relDoc.exists ? (relDoc.data() as CustomerMemoryDoc) : null;
    const avgDaysToPay = relData?.avgDaysToPayDebt ?? null;

    // Sum open debts for this customer from passed-in debts OR Firestore
    let totalOwed = 0;
    let debtCount = 0;

    if (allDebts.length > 0) {
      const customerDebts = allDebts.filter(
        (d) =>
          d.status === "open" &&
          d.customerName?.toLowerCase().includes(normName),
      );
      totalOwed = customerDebts.reduce((s, d) => s + d.outstandingAmount, 0);
      debtCount = customerDebts.length;
    } else {
      const debtSnap = await db
        .collection(collections.debts)
        .where("businessId", "==", tx.businessId)
        .where("status", "==", "open")
        .get();
      const customerDebts = debtSnap.docs
        .map((d) => d.data() as Debt)
        .filter((d) =>
          d.customerName?.toLowerCase().includes(normName),
        );
      totalOwed = customerDebts.reduce((s, d) => s + d.outstandingAmount, 0);
      debtCount = customerDebts.length;
    }

    if (totalOwed <= 0) return null;

    const firstName = name.split(" ")[0] ?? name;
    let text: string;

    if (avgDaysToPay !== null && avgDaysToPay > 0) {
      const etaDate = new Date();
      etaDate.setDate(etaDate.getDate() + Math.round(avgDaysToPay));
      const eta = etaDate.toLocaleDateString("en-GH", {
        weekday: "long",
        month: "short",
        day: "numeric",
      });
      text =
        debtCount > 1
          ? `_${firstName} owes GH₵${totalOwed.toFixed(2)} total across ${debtCount} entries. Usually pays within ${Math.round(avgDaysToPay)} days (around ${eta})._`
          : `_${firstName} now owes GH₵${totalOwed.toFixed(2)} total. Usually pays within ${Math.round(avgDaysToPay)} days (around ${eta})._`;
    } else {
      text = `_${firstName} now owes GH₵${totalOwed.toFixed(2)} total${debtCount > 1 ? ` across ${debtCount} debts` : ""}._`;
    }

    return {
      text,
      trigger: "debt_total_with_eta",
      confidence: avgDaysToPay !== null ? 0.82 : 0.6,
    };
  } catch {
    return null;
  }
}

// ─── Stock velocity estimate ──────────────────────────────────────────────────

async function checkStockVelocity(
  tx: Transaction,
): Promise<SmartRecallNote | null> {
  if (!tx.productName) return null;

  try {
    const db = getAdminDb();
    const since = new Date();
    since.setDate(since.getDate() - 14);

    // Get sales of this product in last 14 days
    const salesSnap = await db
      .collection(collections.transactions)
      .where("businessId", "==", tx.businessId)
      .where("type", "==", "sale")
      .where("productName", "==", tx.productName)
      .where("createdAt", ">=", since.toISOString())
      .get();

    const salesCount = salesSnap.size;
    if (salesCount < 3) return null; // not enough data

    // Get last stock purchase quantity for this product
    const stockSnap = await db
      .collection(collections.transactions)
      .where("businessId", "==", tx.businessId)
      .where("type", "==", "stock_purchase")
      .where("productName", "==", tx.productName)
      .orderBy("createdAt", "desc")
      .limit(1)
      .get();

    if (stockSnap.empty) return null;

    const lastStock = stockSnap.docs[0]!.data() as Transaction;
    const stockQty = lastStock.quantity;
    if (!stockQty || stockQty <= 0) return null;

    // Total quantity sold in last 14 days
    const totalSoldQty = salesSnap.docs.reduce((s, d) => {
      const t = d.data() as Transaction;
      return s + (t.quantity ?? 1);
    }, 0);

    const dailyRate = totalSoldQty / 14;
    if (dailyRate <= 0) return null;

    // Rough current stock (purchased - sold in window, floored at 0)
    const totalStockPurchased = salesSnap.docs.reduce((s, d) => {
      const t = d.data() as Transaction;
      return s + (t.quantity ?? 0);
    }, 0);
    const estimatedRemaining = Math.max(stockQty - totalStockPurchased, 0);
    const daysLeft = Math.round(estimatedRemaining / dailyRate);

    if (daysLeft <= 0 || daysLeft > 30) return null;

    const urgency = daysLeft <= 2 ? "⚠️ " : daysLeft <= 5 ? "📦 " : "";
    const text =
      daysLeft <= 2
        ? `${urgency}*Low stock:* ${tx.productName} is selling fast (~${totalSoldQty} in 14 days). May run out in ~${daysLeft} day${daysLeft !== 1 ? "s" : ""}.`
        : `${urgency}_${tx.productName} selling ~${totalSoldQty} units/2 weeks. Estimated ~${daysLeft} days of stock left._`;

    return {
      text,
      trigger: "stock_velocity",
      confidence: 0.65,
    };
  } catch {
    return null;
  }
}

// ─── Expense spike detection ──────────────────────────────────────────────────

async function checkExpenseSpike(
  tx: Transaction,
): Promise<SmartRecallNote | null> {
  if (tx.amount <= 0) return null;

  try {
    const db = getAdminDb();
    const since = new Date();
    since.setDate(since.getDate() - 30);

    // Expenses of same type/category in last 30 days
    const snap = await db
      .collection(collections.transactions)
      .where("businessId", "==", tx.businessId)
      .where("type", "in", ["expense", "cost"])
      .where("createdAt", ">=", since.toISOString())
      .get();

    // Filter by same category or product name
    const matchKey = tx.productName?.toLowerCase() || tx.category?.toLowerCase();
    const similar = snap.docs
      .map((d) => d.data() as Transaction)
      .filter((t) => {
        if (t.id === tx.id) return false;
        if (matchKey) {
          return (
            t.productName?.toLowerCase() === matchKey ||
            t.category?.toLowerCase() === matchKey
          );
        }
        return t.type === tx.type;
      });

    if (similar.length < 3) return null;

    const avg = similar.reduce((s, t) => s + t.amount, 0) / similar.length;
    const changePct = ((tx.amount - avg) / avg) * 100;

    if (changePct < 30) return null; // only surface if 30%+ above average

    const label = tx.productName || tx.category || "This expense";
    const text = `_${label} avg is GH₵${avg.toFixed(2)}. Today's GH₵${tx.amount.toFixed(2)} is ${Math.round(changePct)}% higher than usual._`;

    return {
      text,
      trigger: "expense_spike",
      confidence: Math.min(0.4 + similar.length * 0.05, 0.85),
    };
  } catch {
    return null;
  }
}

// ─── Top-product milestone ────────────────────────────────────────────────────

async function checkTopProductMilestone(
  tx: Transaction,
  userId: string,
  businessId: string,
): Promise<SmartRecallNote | null> {
  if (!tx.productName) return null;

  try {
    const dna = await getOrRefreshBusinessDNA(userId, businessId);
    const facts = getRelevantDNAFacts(dna, "sale", tx.productName);

    const consistencyFact = facts.find(
      (f) => f.type === "top_product_consistency",
    );
    if (!consistencyFact) return null;

    return {
      text: `_${consistencyFact.shortStatement}_`,
      trigger: "top_product_milestone",
      confidence: consistencyFact.confidence,
    };
  } catch {
    return null;
  }
}

// ─── DNA fallback note ────────────────────────────────────────────────────────

async function buildDnaFallbackNote(
  tx: Transaction,
): Promise<SmartRecallNote | null> {
  try {
    const dna = await getOrRefreshBusinessDNA(tx.userId, tx.businessId);
    const facts = getRelevantDNAFacts(dna, tx.type, tx.productName ?? undefined);

    if (facts.length === 0) return null;

    // Pick most confident fact
    const best = facts.sort((a, b) => b.confidence - a.confidence)[0]!;
    return {
      text: `_🧠 ${best.shortStatement}_`,
      trigger: "dna_pattern",
      confidence: best.confidence,
    };
  } catch {
    return null;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Crude name extractor from free-text notes like "debt for Ama" */
function extractNameFromNotes(notes: string): string | null {
  const patterns = [
    /\bfor\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/,
    /\bfrom\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/,
    /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+owe/i,
  ];
  for (const p of patterns) {
    const m = notes.match(p);
    if (m?.[1]) return m[1];
  }
  return null;
}

/** Minimal shape of a relationship memory doc for reads */
interface CustomerMemoryDoc {
  avgDaysToPayDebt: number | null;
  totalDebt: number;
  debtCount: number;
}
