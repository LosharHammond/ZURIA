"use client";

import { collection, getDocs, orderBy, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { collections } from "@/lib/firebase/collections";
import type { InventoryItem } from "@/types/domain";
import { createClientLogger } from "@/lib/observability/client-logger";
const logger = createClientLogger("services:inventory");

function mapItem(data: Record<string, unknown>): InventoryItem {
  return {
    ...(data as unknown as InventoryItem),
    updatedAt: (data.updatedAt as { toDate?: () => Date })?.toDate?.()?.toISOString() ?? (data.updatedAt as string),
    createdAt: (data.createdAt as { toDate?: () => Date })?.toDate?.()?.toISOString() ?? (data.createdAt as string),
  };
}

export async function fetchInventory(businessId: string): Promise<InventoryItem[]> {
  if (!db) return [];

  // Try with composite index (businessId + updatedAt). Falls back to unordered if index not deployed yet.
  try {
    const q = query(
      collection(db, collections.inventory),
      where("businessId", "==", businessId),
      orderBy("updatedAt", "desc"),
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => mapItem(d.data()));
  } catch {
    // Composite index not yet deployed — query without orderBy and sort in JS
  }

  try {
    const q = query(collection(db, collections.inventory), where("businessId", "==", businessId));
    const snap = await getDocs(q);
    const items = snap.docs.map((d) => mapItem(d.data()));
    return items.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  } catch (err) {
    logger.error("fetchInventory failed", { err: String(err) });
    return [];
  }
}
