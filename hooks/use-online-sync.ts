"use client";

/**
 * hooks/use-online-sync.ts
 *
 * Online/Offline sync hook — the "SyncProvider" referenced in app-shell.tsx.
 *
 * Responsibilities:
 *  1. Track network status and update the Zustand store (offline flag)
 *  2. When device comes back online, flush the IndexedDB offline queue
 *     by persisting each queued transaction to Firestore
 *  3. Deduplicate flushes (only one sync in flight at a time)
 *
 * Spec: "Offline-first is a major African competitive advantage."
 *       "ZURIA works offline, syncs later, and survives poor connectivity."
 */

import { useEffect, useRef } from "react";
import { useAppStore } from "@/stores/app-store";
import { getQueuedTransactions, removeQueuedTransaction } from "@/lib/offline/db";
import { persistTransaction } from "@/lib/services/transaction-service";

export function useOnlineSync() {
  const setOffline = useAppStore((s) => s.setOffline);
  const isSyncing  = useRef(false);

  async function flushOfflineQueue() {
    if (isSyncing.current) return;
    isSyncing.current = true;

    try {
      const queued = await getQueuedTransactions();
      if (queued.length === 0) return;

      for (const txn of queued) {
        try {
          await persistTransaction(txn);
          await removeQueuedTransaction(txn.id);
        } catch {
          // If a single transaction fails (e.g. duplicate key), skip and continue.
          // It will retry on the next online event.
        }
      }
    } catch {
      // Queue read failed — silent, will retry next time
    } finally {
      isSyncing.current = false;
    }
  }

  useEffect(() => {
    // Set initial state
    setOffline(!navigator.onLine);

    function handleOnline() {
      setOffline(false);
      // Flush queued transactions when connectivity is restored
      flushOfflineQueue().catch(() => {});
    }

    function handleOffline() {
      setOffline(true);
    }

    window.addEventListener("online",  handleOnline);
    window.addEventListener("offline", handleOffline);

    // Attempt a flush on mount in case the device was offline and came back
    // while the component was unmounted
    if (navigator.onLine) {
      flushOfflineQueue().catch(() => {});
    }

    return () => {
      window.removeEventListener("online",  handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
