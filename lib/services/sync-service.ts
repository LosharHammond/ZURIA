"use client";

import { getQueuedTransactions, removeQueuedTransaction } from "@/lib/offline/db";
import { persistTransaction } from "@/lib/services/transaction-service";
import { createClientLogger } from "@/lib/observability/client-logger";
const logger = createClientLogger("services:sync");

export async function syncQueuedTransactions(): Promise<number> {
  if (!navigator.onLine) return 0;

  let queued: Awaited<ReturnType<typeof getQueuedTransactions>>;
  try {
    queued = await getQueuedTransactions();
  } catch (err) {
    logger.error("Failed to read queue", { err: String(err) });
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
      logger.error("Failed to persist transaction", { id: transaction.id, err: String(err) });
    }
  }
  return synced;
}
