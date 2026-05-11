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
import type { Loan, LoanRepayment, Transaction } from "@/types/domain";
import { createId } from "@/lib/utils";

export async function fetchLoans(businessId: string): Promise<Loan[]> {
  if (!db) return [];

  const mapLoan = (data: Record<string, unknown>): Loan => ({
    ...(data as unknown as Loan),
    lastActivityAt:
      (data.lastActivityAt as { toDate?: () => Date })?.toDate?.()?.toISOString() ?? (data.lastActivityAt as string),
    createdAt:
      (data.createdAt as { toDate?: () => Date })?.toDate?.()?.toISOString() ?? (data.createdAt as string),
  });

  // Try with composite index. Falls back if index not yet deployed.
  try {
    const q = query(
      collection(db, collections.loans),
      where("businessId", "==", businessId),
      orderBy("lastActivityAt", "desc"),
      limit(100),
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => mapLoan(d.data()));
  } catch {
    // Composite index not deployed yet — fall back without ordering
  }

  try {
    const q = query(
      collection(db, collections.loans),
      where("businessId", "==", businessId),
      limit(100),
    );
    const snap = await getDocs(q);
    const items = snap.docs.map((d) => mapLoan(d.data()));
    return items.sort((a, b) => String(b.lastActivityAt).localeCompare(String(a.lastActivityAt)));
  } catch (err) {
    console.error("[fetchLoans]", err);
    return [];
  }
}

export async function applyLoanEffect(transaction: Transaction): Promise<void> {
  if (!db) return;

  const now = new Date().toISOString();
  const counterparty = transaction.customerName;

  // ── Open a new "taken" loan (borrow_in) ──────────────────────────────────
  if (transaction.type === "borrow_in") {
    const existing = await findLoan(transaction.businessId, "taken", counterparty);
    const next: Loan = existing
      ? {
          ...existing,
          originalAmount: existing.originalAmount + transaction.amount,
          outstandingAmount: existing.outstandingAmount + transaction.amount,
          status: "open",
          notes: [existing.notes, transaction.rawText].filter(Boolean).join(" | "),
          lastActivityAt: now,
        }
      : {
          id: createId("loan"),
          businessId: transaction.businessId,
          direction: "taken",
          counterpartyName: counterparty,
          originalAmount: transaction.amount,
          outstandingAmount: transaction.amount,
          repaymentHistory: [],
          status: "open",
          currency: "GHS, Cedis",
          notes: transaction.rawText,
          lastActivityAt: now,
          createdAt: now,
          syncStatus: "pending",
        };
    await setDoc(doc(db, collections.loans, next.id), next, { merge: true });
  }

  // ── Open a new "given" loan (borrow_out) ─────────────────────────────────
  if (transaction.type === "borrow_out") {
    const existing = await findLoan(transaction.businessId, "given", counterparty);
    const next: Loan = existing
      ? {
          ...existing,
          originalAmount: existing.originalAmount + transaction.amount,
          outstandingAmount: existing.outstandingAmount + transaction.amount,
          status: "open",
          notes: [existing.notes, transaction.rawText].filter(Boolean).join(" | "),
          lastActivityAt: now,
        }
      : {
          id: createId("loan"),
          businessId: transaction.businessId,
          direction: "given",
          counterpartyName: counterparty,
          originalAmount: transaction.amount,
          outstandingAmount: transaction.amount,
          repaymentHistory: [],
          status: "open",
          currency: "GHS, Cedis",
          notes: transaction.rawText,
          lastActivityAt: now,
          createdAt: now,
          syncStatus: "pending",
        };
    await setDoc(doc(db, collections.loans, next.id), next, { merge: true });
  }

  // ── Repay a "taken" loan (loan_repay_out) ────────────────────────────────
  if (transaction.type === "loan_repay_out") {
    const existing = await findOpenLoan(transaction.businessId, "taken", counterparty);
    if (existing) {
      const repayment: LoanRepayment = {
        id: createId("lrepay"),
        amount: transaction.amount,
        createdAt: now,
        transactionId: transaction.id,
      };
      const newOutstanding = Math.max(0, existing.outstandingAmount - transaction.amount);
      await updateDoc(doc(db, collections.loans, existing.id), {
        outstandingAmount: newOutstanding,
        repaymentHistory: [...existing.repaymentHistory, repayment],
        status: newOutstanding === 0 ? "settled" : "open",
        lastActivityAt: now,
      });
    }
  }

  // ── Collect a "given" loan (loan_collect_in) ─────────────────────────────
  if (transaction.type === "loan_collect_in") {
    const existing = await findOpenLoan(transaction.businessId, "given", counterparty);
    if (existing) {
      const repayment: LoanRepayment = {
        id: createId("lcollect"),
        amount: transaction.amount,
        createdAt: now,
        transactionId: transaction.id,
      };
      const newOutstanding = Math.max(0, existing.outstandingAmount - transaction.amount);
      await updateDoc(doc(db, collections.loans, existing.id), {
        outstandingAmount: newOutstanding,
        repaymentHistory: [...existing.repaymentHistory, repayment],
        status: newOutstanding === 0 ? "settled" : "open",
        lastActivityAt: now,
      });
    }
  }
}

async function findLoan(businessId: string, direction: "taken" | "given", counterpartyName: string | null): Promise<Loan | undefined> {
  if (!db) return undefined;
  const constraints = [
    where("businessId", "==", businessId),
    where("direction", "==", direction),
    limit(1),
  ];
  if (counterpartyName) constraints.push(where("counterpartyName", "==", counterpartyName));
  const q = query(collection(db, collections.loans), ...constraints);
  const snap = await getDocs(q);
  return snap.docs[0]?.data() as Loan | undefined;
}

async function findOpenLoan(businessId: string, direction: "taken" | "given", counterpartyName: string | null): Promise<Loan | undefined> {
  if (!db) return undefined;
  const constraints = [
    where("businessId", "==", businessId),
    where("direction", "==", direction),
    where("status", "==", "open"),
    limit(1),
  ];
  if (counterpartyName) constraints.push(where("counterpartyName", "==", counterpartyName));
  const q = query(collection(db, collections.loans), ...constraints);
  const snap = await getDocs(q);
  return snap.docs[0]?.data() as Loan | undefined;
}
