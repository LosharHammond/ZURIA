/**
 * lib/memory/retrieval.ts
 *
 * Contextual memory retrieval — resolves "same supplier", "repeat last sale",
 * and other entity references using recent Firestore data.
 *
 * SERVER-ONLY — never import from client components.
 */

import { getAdminDb } from "@/lib/firebase/admin";
import { collections } from "@/lib/firebase/collections";
import type { Transaction, Debt } from "@/types/domain";
import type { BusinessProfile } from "./operational-memory";

// ─── Public Interfaces ────────────────────────────────────────────────────────

export interface MemoryContext {
  lastSupplier: string | null;
  lastCustomer: string | null;
  lastProduct: string | null;
  lastAmount: number | null;
  lastTransactionType: string | null;
  recentDebts: Array<{ customerName: string; amount: number }>;
  recentTransactions: Array<{
    type: string;
    amount: number;
    product: string | null;
    createdAt: string;
  }>;
}

// ─── Empty context helper ─────────────────────────────────────────────────────

function emptyContext(): MemoryContext {
  return {
    lastSupplier: null,
    lastCustomer: null,
    lastProduct: null,
    lastAmount: null,
    lastTransactionType: null,
    recentDebts: [],
    recentTransactions: [],
  };
}

// ─── loadMemoryContext ────────────────────────────────────────────────────────

export async function loadMemoryContext(
  userId: string,
  businessId: string,
): Promise<MemoryContext> {
  // userId kept for future per-user scoping / audit
  void userId;

  try {
    const db = getAdminDb();
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // Last 10 transactions within 24 hours
    const txnSnap = await db
      .collection(collections.transactions)
      .where("businessId", "==", businessId)
      .where("createdAt", ">=", since24h)
      .orderBy("createdAt", "desc")
      .limit(10)
      .get();

    const transactions = txnSnap.docs.map((d) => d.data() as Transaction);

    // Top 5 open debts by amount
    const debtSnap = await db
      .collection(collections.debts)
      .where("businessId", "==", businessId)
      .where("status", "==", "open")
      .orderBy("outstandingAmount", "desc")
      .limit(5)
      .get();

    const debts = debtSnap.docs.map((d) => d.data() as Debt);

    // Derive contextual entities from the most recent transaction
    const latest = transactions[0] ?? null;

    const lastSupplier =
      latest?.type === "stock_purchase" ? (latest.customerName ?? null) : null;
    const lastCustomer =
      latest && latest.type !== "stock_purchase"
        ? (latest.customerName ?? null)
        : null;
    const lastProduct = latest?.productName ?? null;
    const lastAmount = latest?.amount ?? null;
    const lastTransactionType = latest?.type ?? null;

    const recentDebts = debts
      .filter((d) => d.customerName !== null)
      .map((d) => ({ customerName: d.customerName as string, amount: d.outstandingAmount }));

    const recentTransactions = transactions.map((t) => ({
      type: t.type,
      amount: t.amount,
      product: t.productName,
      createdAt: t.createdAt,
    }));

    return {
      lastSupplier,
      lastCustomer,
      lastProduct,
      lastAmount,
      lastTransactionType,
      recentDebts,
      recentTransactions,
    };
  } catch {
    return emptyContext();
  }
}

// ─── resolveReference ────────────────────────────────────────────────────────

export interface ResolvedReference {
  resolved: boolean;
  resolvedText: string;
  resolvedEntities: Record<string, string | number | null>;
}

export function resolveReference(
  text: string,
  ctx: MemoryContext,
): ResolvedReference {
  const lower = text.toLowerCase().trim();
  const resolvedEntities: Record<string, string | number | null> = {};
  let resolvedText = text;
  let resolved = false;

  // "repeat last sale" / "repeat last transaction"
  if (
    lower.includes("repeat last sale") ||
    lower.includes("repeat last transaction") ||
    lower.includes("same as last")
  ) {
    resolvedEntities.type = ctx.lastTransactionType;
    resolvedEntities.product = ctx.lastProduct;
    resolvedEntities.amount = ctx.lastAmount;
    if (ctx.lastProduct && ctx.lastAmount !== null) {
      resolvedText = `${ctx.lastTransactionType ?? "sale"} ${ctx.lastProduct} GH₵${ctx.lastAmount}`;
    }
    resolved = true;
  }

  // "same supplier" / "same vendor"
  if (
    lower.includes("same supplier") ||
    lower.includes("same vendor") ||
    lower.includes("same person") ||
    lower.includes("same man") ||
    lower.includes("same woman")
  ) {
    resolvedEntities.supplier = ctx.lastSupplier;
    if (ctx.lastSupplier) {
      resolvedText = resolvedText.replace(
        /same supplier|same vendor|same person|same man|same woman/gi,
        ctx.lastSupplier,
      );
    }
    resolved = true;
  }

  // "same product" / "same item" / "same thing"
  if (
    lower.includes("same product") ||
    lower.includes("same item") ||
    lower.includes("same thing") ||
    lower.includes("same goods")
  ) {
    resolvedEntities.product = ctx.lastProduct;
    if (ctx.lastProduct) {
      resolvedText = resolvedText.replace(
        /same product|same item|same thing|same goods/gi,
        ctx.lastProduct,
      );
    }
    resolved = true;
  }

  // "same amount" / "same price" / "same money"
  if (
    lower.includes("same amount") ||
    lower.includes("same price") ||
    lower.includes("same money")
  ) {
    resolvedEntities.amount = ctx.lastAmount;
    if (ctx.lastAmount !== null) {
      resolvedText = resolvedText.replace(
        /same amount|same price|same money/gi,
        `GH₵${ctx.lastAmount}`,
      );
    }
    resolved = true;
  }

  // "last customer" / "same customer" / "same buyer"
  if (
    lower.includes("last customer") ||
    lower.includes("same customer") ||
    lower.includes("same buyer") ||
    lower.includes("same client")
  ) {
    resolvedEntities.customer = ctx.lastCustomer;
    if (ctx.lastCustomer) {
      resolvedText = resolvedText.replace(
        /last customer|same customer|same buyer|same client/gi,
        ctx.lastCustomer,
      );
    }
    resolved = true;
  }

  return { resolved, resolvedText, resolvedEntities };
}

// ─── buildContextSummary ─────────────────────────────────────────────────────

export function buildContextSummary(
  ctx: MemoryContext,
  profile: BusinessProfile,
): string {
  const parts: string[] = [];

  // Business category
  if (profile.inferredCategory !== "unknown") {
    parts.push(`Business: ${profile.inferredCategory} shop.`);
  }

  // Most recent transaction
  const latest = ctx.recentTransactions[0];
  if (latest) {
    const product = latest.product ? ` ${latest.product}` : "";
    const amt = `GH₵${latest.amount}`;
    parts.push(`Recent: ${latest.type}${product} ${amt}.`);
  }

  // Second most recent (if different type)
  const second = ctx.recentTransactions[1];
  if (second && second.type !== latest?.type) {
    const product = second.product ? ` ${second.product}` : "";
    const amt = `GH₵${second.amount}`;
    parts.push(`${second.type}${product} ${amt}.`);
  }

  // Outstanding debts
  if (ctx.recentDebts.length > 0) {
    const debtList = ctx.recentDebts
      .slice(0, 3)
      .map((d) => `${d.customerName} GH₵${d.amount}`)
      .join(", ");
    parts.push(`Outstanding debts: ${debtList}.`);
  }

  const summary = parts.join(" ");
  // Truncate to 300 chars
  return summary.length <= 300 ? summary : summary.slice(0, 297) + "...";
}
