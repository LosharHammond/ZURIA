"use client";

import { useEffect } from "react";
import { syncQueuedTransactions } from "@/lib/services/sync-service";
import { useAppStore } from "@/stores/app-store";

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const { setOffline } = useAppStore();

  useEffect(() => {
    const update = async () => {
      const isOnline = navigator.onLine;
      setOffline(!isOnline);

      if (isOnline) {
        try {
          const synced = await syncQueuedTransactions();
          if (synced > 0) {
            console.info(`[sync] ${synced} offline transaction(s) synced.`);
          }
        } catch (err) {
          console.error("[sync] Failed to sync queued transactions:", err);
        }
      }
    };

    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, [setOffline]);

  return <>{children}</>;
}
