"use client";

import {
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { collections } from "@/lib/firebase/collections";
import type { Debt, InventoryItem, ParsedTransaction, Transaction } from "@/types/domain";
import { createId } from "@/lib/utils";
import { queueTransaction } from "@/lib/offline/db";
import { applyLoanEffect } from "@/lib/services/loan-service";

export async function createTransaction(input: {
  businessId: string;
  userId: string;
  rawText: string;
  parsed: ParsedTransaction;
}): Promise<Transaction> {
  const now = new Date().toISOString();
  const transaction: Transaction = {
    id: createId("txn"),
    businessId: input.businessId,
    userId: input.userId,
    rawText: input.rawText,
    type: input.parsed.type,
    amount: input.parsed.amount,
    quantity: input.parsed.quantity,
    productName: input.parsed.productName,
    customerName: input.parsed.customerName,
    customerNameNormalized: input.parsed.customerNameNormalized,
    category: input.parsed.category,
    paymentMethod: input.parsed.paymentMethod,
    currency: input.parsed.currency,
    notes: input.parsed.notes,
    confidence: input.parsed.confidence,
    createdAt: now,
    syncStatus: input.parsed.syncStatus,
    source: "manual",
  };

  if (!db || !navigator.onLine) {
    await queueTransaction(transaction);
    return transaction;
  }

  await persistTransaction(transaction);
  return transaction;
}

export async function persistTransaction(transaction: Transaction): Promise<void> {
  if (!db) throw new Error("Firebase is not configured.");

  await setDoc(doc(db, collections.transactions, transaction.id), {
    ...transaction,
    createdAt: new Date(transaction.createdAt),
    synced: new Date().toISOString(),
  });

  // Side effects are best-effort — transaction already persisted above.
  await Promise.allSettled([
    applyDebtEffect(transaction),
    applyInventoryEffect(transaction),
    applyLoanEffect(transaction),
  ]);
}

export async function fetchTransactions(businessId: string, max = 100): Promise<Transaction[]> {
  if (!db) return [];

  const mapTxn = (data: Record<string, unknown>): Transaction => ({
    ...(data as unknown as Transaction),
    createdAt:
      (data.createdAt as { toDate?: () => Date })?.toDate?.()?.toISOString() ?? (data.createdAt as string),
    synced:
      (data.synced as { toDate?: () => Date })?.toDate?.()?.toISOString() ?? (data.synced as string),
  });

  // Try with composite index (businessId + createdAt). Falls back if index not yet deployed.
  try {
    const q = query(
      collection(db, collections.transactions),
      where("businessId", "==", businessId),
      orderBy("createdAt", "desc"),
      limit(max),
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => mapTxn(d.data()));
  } catch {
    // Composite index not deployed yet — fall back without ordering
  }

  try {
    const q = query(
      collection(db, collections.transactions),
      where("businessId", "==", businessId),
      limit(max),
    );
    const snap = await getDocs(q);
    const items = snap.docs.map((d) => mapTxn(d.data()));
    return items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  } catch (err) {
    console.error("[fetchTransactions]", err);
    return [];
  }
}

// ─── Debt side-effects ────────────────────────────────────────────────────────

async function applyDebtEffect(transaction: Transaction): Promise<void> {
  if (!db || !transaction.customerName) return;
  if (transaction.type !== "debt" && transaction.type !== "repayment") return;

  const existing = await findDebt(transaction.businessId, transaction.customerName);
  const now = new Date().toISOString();

  if (transaction.type === "debt") {
    const next: Debt = existing
      ? {
          ...existing,
          originalAmount: existing.originalAmount + transaction.amount,
          outstandingAmount: existing.outstandingAmount + transaction.amount,
          status: "open",
          lastActivityAt: now,
        }
      : {
          id: createId("debt"),
          businessId: transaction.businessId,
          customerName: transaction.customerName,
          originalAmount: transaction.amount,
          outstandingAmount: transaction.amount,
          repaymentHistory: [],
          status: "open",
          currency: "GHS, Cedis",
          lastActivityAt: now,
          createdAt: now,
          syncStatus: "pending",
        };
    await setDoc(doc(db, collections.debts, next.id), next, { merge: true });
  }

  if (transaction.type === "repayment" && existing) {
    const outstandingAmount = Math.max(0, existing.outstandingAmount - transaction.amount);
    const repayment = {
      id: createId("repay"),
      amount: transaction.amount,
      currency: "GHS, Cedis" as const,
      createdAt: now,
      transactionId: transaction.id,
    };
    await updateDoc(doc(db, collections.debts, existing.id), {
      outstandingAmount,
      repaymentHistory: [...existing.repaymentHistory, repayment],
      status: outstandingAmount === 0 ? "paid" : "open",
      lastActivityAt: now,
    });
  }
}

async function findDebt(businessId: string, customerName: string): Promise<Debt | undefined> {
  if (!db) return undefined;
  const q = query(
    collection(db, collections.debts),
    where("businessId", "==", businessId),
    where("customerName", "==", customerName),
    limit(1),
  );
  const snap = await getDocs(q);
  return snap.docs[0]?.data() as Debt | undefined;
}

// ─── Inventory side-effects ───────────────────────────────────────────────────

async function applyInventoryEffect(transaction: Transaction): Promise<void> {
  if (!db || !transaction.productName || !transaction.quantity) return;
  if (transaction.type !== "sale" && transaction.type !== "stock_purchase") return;

  const existing = await findInventoryItem(transaction.businessId, transaction.productName);
  const now = new Date().toISOString();
  const delta = transaction.type === "stock_purchase" ? transaction.quantity : -transaction.quantity;
  const next: InventoryItem = existing
    ? { ...existing, quantity: Math.max(0, (existing.quantity ?? 0) + delta), updatedAt: now }
    : {
        id: createId("stock"),
        businessId: transaction.businessId,
        productName: transaction.productName,
        quantity: Math.max(0, delta),
        lowStockThreshold: 5,
        currency: "GHS, Cedis",
        updatedAt: now,
        createdAt: now,
        syncStatus: "pending",
      };
  await setDoc(doc(db, collections.inventory, next.id), next, { merge: true });
}

async function findInventoryItem(businessId: string, productName: string): Promise<InventoryItem | undefined> {
  if (!db) return undefined;
  const q = query(
    collection(db, collections.inventory),
    where("businessId", "==", businessId),
    where("productName", "==", productName),
    limit(1),
  );
  const snap = await getDocs(q);
  return snap.docs[0]?.data() as InventoryItem | undefined;
}
