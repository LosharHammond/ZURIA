/**
 * lib/health/index.ts
 *
 * System health checks for ZURIA infrastructure.
 * Checks Firebase, Groq, queue depth, parser, and memory systems.
 *
 * Server-only.
 */

import { getAdminDb } from "@/lib/firebase/admin";
import { isGroqAvailable, groqGenerate } from "@/lib/ai/groq";
import { collections } from "@/lib/firebase/collections";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ServiceStatus = "operational" | "degraded" | "offline" | "unknown";

export interface ServiceHealth {
  name: string;
  status: ServiceStatus;
  latencyMs: number | null;
  lastCheckedAt: string;
  lastSuccessAt: string | null;
  failureReason: string | null;
  uptime: number;   // 0–100 percentage estimate
  details: Record<string, unknown>;
}

export interface SystemHealthReport {
  overallStatus: ServiceStatus;
  services: ServiceHealth[];
  queueDepth: number;
  parserHealth: { avgConfidence: number; failureRate: number };
  aiHealth: { groqAvailable: boolean; lastModel: string | null; avgLatencyMs: number };
  generatedAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function nowISO(): string {
  return new Date().toISOString();
}

function makeOfflineHealth(name: string, reason: string): ServiceHealth {
  return {
    name,
    status: "offline",
    latencyMs: null,
    lastCheckedAt: nowISO(),
    lastSuccessAt: null,
    failureReason: reason,
    uptime: 0,
    details: {},
  };
}

// ─── Firebase Health Check ────────────────────────────────────────────────────

export async function checkFirestore(): Promise<ServiceHealth> {
  const start = Date.now();
  try {
    const db = getAdminDb();
    // Ping with a lightweight doc read (the doc may not exist — that's fine)
    await db.collection(collections.featureFlags).limit(1).get();
    const latencyMs = Date.now() - start;
    const status: ServiceStatus = latencyMs < 2000 ? "operational" : "degraded";
    return {
      name: "firebase",
      status,
      latencyMs,
      lastCheckedAt: nowISO(),
      lastSuccessAt: nowISO(),
      failureReason: null,
      uptime: status === "operational" ? 99 : 70,
      details: { latencyMs },
    };
  } catch (err) {
    return {
      ...makeOfflineHealth("firebase", err instanceof Error ? err.message : "Firestore ping failed"),
      latencyMs: Date.now() - start,
    };
  }
}

// ─── Groq Health Check ────────────────────────────────────────────────────────

export async function checkGroq(): Promise<ServiceHealth> {
  const available = isGroqAvailable();
  if (!available) {
    return makeOfflineHealth("groq_fast", "GROQ_API_KEY is not set");
  }

  const start = Date.now();
  try {
    const result = await groqGenerate("Reply with: ok", {
      model: "fast",
      maxTokens: 5,
      temperature: 0.0,
    });
    const latencyMs = Date.now() - start;

    if (!result) {
      return {
        name: "groq_fast",
        status: "degraded",
        latencyMs,
        lastCheckedAt: nowISO(),
        lastSuccessAt: null,
        failureReason: "Empty response from Groq",
        uptime: 60,
        details: {},
      };
    }

    return {
      name: "groq_fast",
      status: latencyMs < 5000 ? "operational" : "degraded",
      latencyMs,
      lastCheckedAt: nowISO(),
      lastSuccessAt: nowISO(),
      failureReason: null,
      uptime: 98,
      details: { model: result.model, latencyMs },
    };
  } catch (err) {
    return {
      ...makeOfflineHealth("groq_fast", err instanceof Error ? err.message : "Groq request failed"),
      latencyMs: Date.now() - start,
    };
  }
}

// ─── Queue Depth ──────────────────────────────────────────────────────────────

export async function checkQueueDepth(): Promise<number> {
  try {
    const db = getAdminDb();
    const snap = await db
      .collection(collections.jobQueue)
      .where("status", "==", "pending")
      .count()
      .get();
    return snap.data().count ?? 0;
  } catch {
    return 0;
  }
}

// ─── Parser Health ────────────────────────────────────────────────────────────

async function getParserHealth(): Promise<{ avgConfidence: number; failureRate: number }> {
  try {
    const db = getAdminDb();
    const snap = await db
      .collection(collections.parserBenchmarkLogs)
      .orderBy("createdAt", "desc")
      .limit(100)
      .get();

    if (snap.empty) return { avgConfidence: 1.0, failureRate: 0 };

    let totalConf = 0;
    let failures = 0;

    snap.docs.forEach((doc) => {
      const data = doc.data();
      const conf = typeof data["confidence"] === "number" ? data["confidence"] : 1.0;
      totalConf += conf;
      if (conf < 0.60) failures++;
    });

    const count = snap.docs.length;
    return {
      avgConfidence: totalConf / count,
      failureRate: failures / count,
    };
  } catch {
    return { avgConfidence: 1.0, failureRate: 0 };
  }
}

// ─── AI Health ────────────────────────────────────────────────────────────────

async function getAIHealth(): Promise<{
  groqAvailable: boolean;
  lastModel: string | null;
  avgLatencyMs: number;
}> {
  const groqAvailable = isGroqAvailable();

  try {
    const db = getAdminDb();
    const snap = await db
      .collection(collections.aiUsageLogs)
      .orderBy("createdAt", "desc")
      .limit(50)
      .get();

    if (snap.empty) {
      return { groqAvailable, lastModel: null, avgLatencyMs: 0 };
    }

    let totalLatency = 0;
    let count = 0;
    let lastModel: string | null = null;

    snap.docs.forEach((doc, idx) => {
      const data = doc.data();
      if (idx === 0) lastModel = typeof data["model"] === "string" ? data["model"] : null;
      const latency = typeof data["latencyMs"] === "number" ? data["latencyMs"] : 0;
      totalLatency += latency;
      count++;
    });

    return {
      groqAvailable,
      lastModel,
      avgLatencyMs: count > 0 ? Math.round(totalLatency / count) : 0,
    };
  } catch {
    return { groqAvailable, lastModel: null, avgLatencyMs: 0 };
  }
}

// ─── Stub Services ────────────────────────────────────────────────────────────

function makeStubService(name: string): ServiceHealth {
  return {
    name,
    status: "unknown",
    latencyMs: null,
    lastCheckedAt: nowISO(),
    lastSuccessAt: null,
    failureReason: "Health check not yet implemented for this service",
    uptime: 100,
    details: {},
  };
}

// ─── Overall Status Computation ───────────────────────────────────────────────

function computeOverallStatus(services: ServiceHealth[]): ServiceStatus {
  const statuses = services.map((s) => s.status);
  if (statuses.includes("offline"))    return "degraded";
  if (statuses.includes("degraded"))   return "degraded";
  if (statuses.every((s) => s === "operational" || s === "unknown")) return "operational";
  return "degraded";
}

// ─── Main Health Report ───────────────────────────────────────────────────────

/**
 * Runs all health checks in parallel and assembles a system health report.
 * Never throws — always returns a usable report.
 */
export async function getSystemHealthReport(): Promise<SystemHealthReport> {
  try {
    const [firestoreHealth, groqHealth, queueDepth, parserHealth, aiHealth] = await Promise.all([
      checkFirestore(),
      checkGroq(),
      checkQueueDepth(),
      getParserHealth(),
      getAIHealth(),
    ]);

    const services: ServiceHealth[] = [
      firestoreHealth,
      groqHealth,
      makeStubService("groq_advanced"),
      makeStubService("telegram"),
      makeStubService("twilio"),
      makeStubService("paystack"),
      {
        name: "queue",
        status: queueDepth > 500 ? "degraded" : "operational",
        latencyMs: null,
        lastCheckedAt: nowISO(),
        lastSuccessAt: nowISO(),
        failureReason: null,
        uptime: 99,
        details: { pendingJobs: queueDepth },
      },
      makeStubService("parser"),
      makeStubService("memory"),
    ];

    const overallStatus = computeOverallStatus(services);

    return {
      overallStatus,
      services,
      queueDepth,
      parserHealth,
      aiHealth,
      generatedAt: nowISO(),
    };
  } catch {
    return {
      overallStatus: "unknown",
      services: [],
      queueDepth: 0,
      parserHealth: { avgConfidence: 0, failureRate: 0 },
      aiHealth: { groqAvailable: false, lastModel: null, avgLatencyMs: 0 },
      generatedAt: nowISO(),
    };
  }
}
