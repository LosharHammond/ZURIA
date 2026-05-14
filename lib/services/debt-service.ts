"use client";

import { collection, getDocs, limit, orderBy, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { collections } from "@/lib/firebase/collections";
import type { Debt } from "@/types/domain";

type RawRepayment = {
  createdAt?: { toDate?: () => Date } | string;
  transactionId?: unknown;
  [key: string]: unknown;
};

function mapDebt(data: Record<string, unknown>): Debt {
  return {
    ...(data as unknown as Debt),
    lastActivityAt:
      (data.lastActivityAt as { toDate?: () => Date })?.toDate?.()?.toISOString() ??
      (data.lastActivityAt as string),
    createdAt:
      (data.createdAt as { toDate?: () => Date })?.toDate?.()?.toISOString() ?? (data.createdAt as string),
    repaymentHistory: ((data.repaymentHistory as RawRepayment[]) ?? []).map((r) => ({
      ...r,
      createdAt:
        typeof r.createdAt === "object" && (r.createdAt as { toDate?: () => Date })?.toDate
          ? (r.createdAt as { toDate: () => Date }).toDate().toISOString()
          : (r.createdAt as string),
    })),
  } as Debt;
}

export async function fetchDebts(businessId: string, max = 200): Promise<Debt[]> {
  if (!db) return [];

  // Try with composite index (businessId + lastActivityAt). Falls back if index not yet deployed.
  try {
    const q = query(
      collection(db, collections.debts),
      where("businessId", "==", businessId),
      orderBy("lastActivityAt", "desc"),
      limit(max),
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => mapDebt(d.data()));
  } catch {
    // Composite index not deployed yet — fall back without ordering
  }

  try {
    const q = query(
      collection(db, collections.debts),
      where("businessId", "==", businessId),
      limit(max),
    );
    const snap = await getDocs(q);
    const items = snap.docs.map((d) => mapDebt(d.data()));
    return items.sort((a, b) => String(b.lastActivityAt).localeCompare(String(a.lastActivityAt)));
  } catch (err) {
    console.error("[fetchDebts]", err);
    return [];
  }
}
