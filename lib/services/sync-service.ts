"use client";

import { getQueuedTransactions, removeQueuedTransaction } from "@/lib/offline/db";
import { persistTransaction } from "@/lib/services/transaction-service";

export async function syncQueuedTransactions(): Promise<number> {
  if (!navigator.onLine) return 0;

  let queued: Awaited<ReturnType<typeof getQueuedTransactions>>;
  try {
    queued = await getQueuedTransactions();
  } catch (err) {
    console.error("[sync] Failed to read queue:", err);
    return 0;
  }

  let synced = 0;
  for (const transaction of queued) {
    try {
      await persistTransaction({ ...transaction, synced: new Date().toISOString() });
      // Only remove from queue after successful persist
      await removeQueuedTransaction(transaction.id);
      synced += 1;
    } catch (err) {
      // Leave in queue — will retry on next sync
      console.error("[sync] Failed to persist transaction", transaction.id, err);
    }
  }
  return synced;
}
