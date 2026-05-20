/**
 * lib/system-status/index.ts
 *
 * Service status registry and latency tracker.
 * Stores recent health check results in Firestore for the admin dashboard.
 *
 * Server-only.
 */

import { getAdminDb } from "@/lib/firebase/admin";
import { collections } from "@/lib/firebase/collections";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ServiceStatusRecord {
  service: string;
  status: "operational" | "degraded" | "offline";
  latencyMs: number;
  errorMessage: string | null;
  checkedAt: string;
}

// ─── Known Services ───────────────────────────────────────────────────────────

const KNOWN_SERVICES = [
  "firebase",
  "groq_fast",
  "groq_advanced",
  "telegram",
  "twilio",
  "paystack",
  "queue",
  "parser",
  "memory",
] as const;

export type KnownService = (typeof KNOWN_SERVICES)[number];

// ─── Firestore Helpers ────────────────────────────────────────────────────────

function statusCollection() {
  return getAdminDb().collection(collections.systemStatus);
}

// ─── Write ────────────────────────────────────────────────────────────────────

/**
 * Fire-and-forget write of a service status record to Firestore.
 * Never throws to callers.
 */
export async function recordServiceStatus(record: ServiceStatusRecord): Promise<void> {
  void (async () => {
    try {
      await statusCollection().add({
        ...record,
        _writtenAt: new Date().toISOString(),
      });
    } catch {
      // silent — monitoring writes must never affect callers
    }
  })();
}

// ─── Read ─────────────────────────────────────────────────────────────────────

/**
 * Fetch the last N hours of status records for a specific service.
 */
export async function getRecentStatus(
  service: string,
  limitHours = 24,
): Promise<ServiceStatusRecord[]> {
  try {
    const cutoff = new Date(Date.now() - limitHours * 60 * 60 * 1000).toISOString();
    const snap = await statusCollection()
      .where("service", "==", service)
      .where("checkedAt", ">=", cutoff)
      .orderBy("checkedAt", "desc")
      .limit(500)
      .get();

    return snap.docs.map((doc) => {
      const d = doc.data();
      return {
        service:      d["service"]      as string,
        status:       d["status"]       as ServiceStatusRecord["status"],
        latencyMs:    d["latencyMs"]    as number,
        errorMessage: d["errorMessage"] as string | null,
        checkedAt:    d["checkedAt"]    as string,
      };
    });
  } catch {
    return [];
  }
}

/**
 * Get the most recent status record for each known service.
 */
export async function getLatestStatusAll(): Promise<Record<string, ServiceStatusRecord>> {
  const result: Record<string, ServiceStatusRecord> = {};

  try {
    await Promise.all(
      KNOWN_SERVICES.map(async (service) => {
        try {
          const snap = await statusCollection()
            .where("service", "==", service)
            .orderBy("checkedAt", "desc")
            .limit(1)
            .get();

          if (!snap.empty) {
            const d = snap.docs[0]!.data();
            result[service] = {
              service:      d["service"]      as string,
              status:       d["status"]       as ServiceStatusRecord["status"],
              latencyMs:    d["latencyMs"]    as number,
              errorMessage: d["errorMessage"] as string | null,
              checkedAt:    d["checkedAt"]    as string,
            };
          }
        } catch {
          // skip this service
        }
      }),
    );
  } catch {
    // return whatever we got
  }

  return result;
}

// ─── Uptime Computation ───────────────────────────────────────────────────────

/**
 * Computes uptime percentage (0–100) from a list of status records.
 * Counts records with status "operational" as healthy.
 */
export function computeUptime(records: ServiceStatusRecord[]): number {
  if (records.length === 0) return 100;

  const healthy = records.filter((r) => r.status === "operational").length;
  return Math.round((healthy / records.length) * 100);
}
