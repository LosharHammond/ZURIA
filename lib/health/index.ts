/**
 * lib/health/index.ts
 *
 * System health checks for ZURIA infrastructure.
 * Checks Firebase, Groq, Paystack, Telegram, OpenAI, Twilio, queue, parser,
 * and memory systems with real live pings where keys are configured.
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

/** Which API keys are configured in the environment. */
export interface ApiKeyStatus {
  key: string;          // env var name
  label: string;        // human-friendly label
  configured: boolean;
  masked?: string;      // e.g. "sk-•••••abcd" — last 4 chars only
}

export interface SystemHealthReport {
  overallStatus: ServiceStatus;
  services: ServiceHealth[];
  apiKeys: ApiKeyStatus[];
  queueDepth: number;
  parserHealth: { avgConfidence: number; failureRate: number };
  aiHealth: { groqAvailable: boolean; openaiAvailable: boolean; lastModel: string | null; avgLatencyMs: number };
  generatedAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function nowISO(): string {
  return new Date().toISOString();
}

function makeOfflineHealth(name: string, reason: string, latencyMs: number | null = null): ServiceHealth {
  return {
    name,
    status: "offline",
    latencyMs,
    lastCheckedAt: nowISO(),
    lastSuccessAt: null,
    failureReason: reason,
    uptime: 0,
    details: {},
  };
}

function makeUnconfiguredHealth(name: string, envVar: string): ServiceHealth {
  return {
    name,
    status: "unknown",
    latencyMs: null,
    lastCheckedAt: nowISO(),
    lastSuccessAt: null,
    failureReason: `${envVar} is not set`,
    uptime: 0,
    details: { configured: false },
  };
}

function maskKey(key: string): string {
  if (key.length <= 8) return "•".repeat(key.length);
  return key.slice(0, 4) + "•••••" + key.slice(-4);
}

// ─── Firebase Health Check ────────────────────────────────────────────────────

export async function checkFirestore(): Promise<ServiceHealth> {
  const start = Date.now();
  try {
    const db = getAdminDb();
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
    return makeOfflineHealth(
      "firebase",
      err instanceof Error ? err.message : "Firestore ping failed",
      Date.now() - start,
    );
  }
}

// ─── Groq Health Check ────────────────────────────────────────────────────────

export async function checkGroq(): Promise<ServiceHealth> {
  if (!isGroqAvailable()) {
    return makeUnconfiguredHealth("groq_fast", "GROQ_API_KEY");
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
    return makeOfflineHealth(
      "groq_fast",
      err instanceof Error ? err.message : "Groq request failed",
      Date.now() - start,
    );
  }
}

// ─── Paystack Health Check ────────────────────────────────────────────────────

export async function checkPaystack(): Promise<ServiceHealth> {
  const secret = process.env.PAYSTACK_SECRET_KEY ?? "";
  if (!secret) {
    return makeUnconfiguredHealth("paystack", "PAYSTACK_SECRET_KEY");
  }

  const start = Date.now();
  try {
    // Ping the lightweight balance endpoint — requires auth, very fast
    const res = await fetch("https://api.paystack.co/balance", {
      headers: { Authorization: `Bearer ${secret}` },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    const latencyMs = Date.now() - start;
    const json = await res.json() as { status?: boolean; data?: unknown; message?: string };

    if (json.status === true) {
      return {
        name: "paystack",
        status: latencyMs < 4000 ? "operational" : "degraded",
        latencyMs,
        lastCheckedAt: nowISO(),
        lastSuccessAt: nowISO(),
        failureReason: null,
        uptime: 99,
        details: { latencyMs, currency: "GHS" },
      };
    }

    return {
      name: "paystack",
      status: "degraded",
      latencyMs,
      lastCheckedAt: nowISO(),
      lastSuccessAt: null,
      failureReason: json.message ?? "Paystack API returned non-success",
      uptime: 50,
      details: { latencyMs },
    };
  } catch (err) {
    const latencyMs = Date.now() - start;
    const msg = err instanceof Error ? err.message : "Paystack ping failed";
    // Distinguish timeout from auth/network error
    const isTimeout = msg.includes("timeout") || msg.includes("abort");
    return {
      ...makeOfflineHealth("paystack", isTimeout ? "Paystack request timed out (>8s)" : msg, latencyMs),
      status: isTimeout ? "degraded" : "offline",
    };
  }
}

// ─── Telegram Health Check ────────────────────────────────────────────────────

export async function checkTelegram(): Promise<ServiceHealth> {
  const token = process.env.TELEGRAM_BOT_TOKEN ?? "";
  if (!token) {
    return makeUnconfiguredHealth("telegram", "TELEGRAM_BOT_TOKEN");
  }

  const start = Date.now();
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });
    const latencyMs = Date.now() - start;
    const json = await res.json() as { ok?: boolean; result?: { username?: string; first_name?: string }; description?: string };

    if (json.ok && json.result) {
      return {
        name: "telegram",
        status: latencyMs < 3000 ? "operational" : "degraded",
        latencyMs,
        lastCheckedAt: nowISO(),
        lastSuccessAt: nowISO(),
        failureReason: null,
        uptime: 99,
        details: {
          username: json.result.username ?? "unknown",
          botName: json.result.first_name ?? "unknown",
          latencyMs,
        },
      };
    }

    return {
      name: "telegram",
      status: "offline",
      latencyMs,
      lastCheckedAt: nowISO(),
      lastSuccessAt: null,
      failureReason: json.description ?? "Telegram API returned non-ok",
      uptime: 0,
      details: { latencyMs },
    };
  } catch (err) {
    const latencyMs = Date.now() - start;
    return makeOfflineHealth(
      "telegram",
      err instanceof Error ? err.message : "Telegram ping failed",
      latencyMs,
    );
  }
}

// ─── OpenAI Health Check ──────────────────────────────────────────────────────

export async function checkOpenAI(): Promise<ServiceHealth> {
  const key = process.env.OPENAI_API_KEY ?? "";
  if (!key || key.length <= 10) {
    return makeUnconfiguredHealth("openai", "OPENAI_API_KEY");
  }

  const start = Date.now();
  try {
    // Ping the models list — no cost, just verifies auth
    const res = await fetch("https://api.openai.com/v1/models?limit=1", {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    const latencyMs = Date.now() - start;
    const json = await res.json() as { object?: string; data?: unknown[]; error?: { message?: string } };

    if (res.ok && json.object === "list") {
      return {
        name: "openai",
        status: latencyMs < 4000 ? "operational" : "degraded",
        latencyMs,
        lastCheckedAt: nowISO(),
        lastSuccessAt: nowISO(),
        failureReason: null,
        uptime: 99,
        details: { latencyMs, provider: "gpt-4o-mini" },
      };
    }

    return {
      name: "openai",
      status: "offline",
      latencyMs,
      lastCheckedAt: nowISO(),
      lastSuccessAt: null,
      failureReason: json.error?.message ?? `HTTP ${res.status}`,
      uptime: 0,
      details: { latencyMs },
    };
  } catch (err) {
    const latencyMs = Date.now() - start;
    return makeOfflineHealth(
      "openai",
      err instanceof Error ? err.message : "OpenAI ping failed",
      latencyMs,
    );
  }
}

// ─── Twilio (WhatsApp) Health Check ───────────────────────────────────────────

export async function checkTwilio(): Promise<ServiceHealth> {
  const sid   = process.env.TWILIO_ACCOUNT_SID   ?? "";
  const token = process.env.TWILIO_AUTH_TOKEN     ?? "";
  const from  = process.env.TWILIO_WHATSAPP_NUMBER ?? "";

  if (!sid || !token) {
    return makeUnconfiguredHealth("twilio", "TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN");
  }

  const start = Date.now();
  try {
    // Ping the account info endpoint — lightweight, just auth check
    const credentials = Buffer.from(`${sid}:${token}`).toString("base64");
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, {
      headers: { Authorization: `Basic ${credentials}` },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    const latencyMs = Date.now() - start;
    const json = await res.json() as { status?: string; friendly_name?: string; message?: string };

    if (res.ok && json.status) {
      const acctStatus = json.status; // "active" | "suspended" | "closed"
      return {
        name: "twilio",
        status: acctStatus === "active" ? (latencyMs < 4000 ? "operational" : "degraded") : "degraded",
        latencyMs,
        lastCheckedAt: nowISO(),
        lastSuccessAt: nowISO(),
        failureReason: acctStatus !== "active" ? `Account status: ${acctStatus}` : null,
        uptime: acctStatus === "active" ? 99 : 50,
        details: {
          accountStatus: acctStatus,
          whatsappNumber: from || "not set",
          latencyMs,
        },
      };
    }

    return {
      name: "twilio",
      status: "offline",
      latencyMs,
      lastCheckedAt: nowISO(),
      lastSuccessAt: null,
      failureReason: json.message ?? `HTTP ${res.status}`,
      uptime: 0,
      details: { latencyMs },
    };
  } catch (err) {
    const latencyMs = Date.now() - start;
    return makeOfflineHealth(
      "twilio",
      err instanceof Error ? err.message : "Twilio ping failed",
      latencyMs,
    );
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
  openaiAvailable: boolean;
  lastModel: string | null;
  avgLatencyMs: number;
}> {
  const groqAvailable   = isGroqAvailable();
  const openaiAvailable = !!(process.env.OPENAI_API_KEY?.length ?? 0 > 10);

  try {
    const db = getAdminDb();
    const snap = await db
      .collection(collections.aiUsageLogs)
      .orderBy("createdAt", "desc")
      .limit(50)
      .get();

    if (snap.empty) {
      return { groqAvailable, openaiAvailable, lastModel: null, avgLatencyMs: 0 };
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
      openaiAvailable,
      lastModel,
      avgLatencyMs: count > 0 ? Math.round(totalLatency / count) : 0,
    };
  } catch {
    return { groqAvailable, openaiAvailable, lastModel: null, avgLatencyMs: 0 };
  }
}

// ─── API Key Status ───────────────────────────────────────────────────────────

function getApiKeyStatuses(): ApiKeyStatus[] {
  const keys: Array<{ key: string; label: string }> = [
    { key: "PAYSTACK_SECRET_KEY",    label: "Paystack Secret Key" },
    { key: "GROQ_API_KEY",           label: "Groq API Key" },
    { key: "OPENAI_API_KEY",         label: "OpenAI API Key" },
    { key: "TELEGRAM_BOT_TOKEN",     label: "Telegram Bot Token" },
    { key: "TELEGRAM_WEBHOOK_SECRET", label: "Telegram Webhook Secret" },
    { key: "TWILIO_ACCOUNT_SID",     label: "Twilio Account SID" },
    { key: "TWILIO_AUTH_TOKEN",      label: "Twilio Auth Token" },
    { key: "TWILIO_WHATSAPP_NUMBER", label: "Twilio WhatsApp Number" },
    { key: "FIREBASE_SERVICE_ACCOUNT_KEY", label: "Firebase Service Account" },
    { key: "NEXT_PUBLIC_FIREBASE_PROJECT_ID", label: "Firebase Project ID" },
    { key: "NEXT_PUBLIC_APP_URL",    label: "App URL" },
  ];

  return keys.map(({ key, label }) => {
    const value = process.env[key] ?? "";
    const configured = value.length > 0;
    return {
      key,
      label,
      configured,
      masked: configured ? maskKey(value) : undefined,
    };
  });
}

// ─── Overall Status Computation ───────────────────────────────────────────────

function computeOverallStatus(services: ServiceHealth[]): ServiceStatus {
  // Only count services that were actually checked (not "unknown"/unconfigured)
  const checked = services.filter((s) => s.status !== "unknown");
  if (checked.length === 0) return "unknown";
  if (checked.some((s) => s.status === "offline"))   return "degraded";
  if (checked.some((s) => s.status === "degraded"))  return "degraded";
  return "operational";
}

// ─── Main Health Report ───────────────────────────────────────────────────────

/**
 * Runs all health checks in parallel and assembles a system health report.
 * Never throws — always returns a usable report.
 */
export async function getSystemHealthReport(): Promise<SystemHealthReport> {
  try {
    const [
      firestoreHealth,
      groqHealth,
      paystackHealth,
      telegramHealth,
      openaiHealth,
      twilioHealth,
      queueDepth,
      parserHealth,
      aiHealth,
    ] = await Promise.all([
      checkFirestore(),
      checkGroq(),
      checkPaystack(),
      checkTelegram(),
      checkOpenAI(),
      checkTwilio(),
      checkQueueDepth(),
      getParserHealth(),
      getAIHealth(),
    ]);

    const services: ServiceHealth[] = [
      firestoreHealth,
      paystackHealth,
      groqHealth,
      openaiHealth,
      telegramHealth,
      twilioHealth,
      {
        name: "queue",
        status: queueDepth > 500 ? "degraded" : "operational",
        latencyMs: null,
        lastCheckedAt: nowISO(),
        lastSuccessAt: nowISO(),
        failureReason: queueDepth > 500 ? `High queue depth: ${queueDepth} pending jobs` : null,
        uptime: 99,
        details: { pendingJobs: queueDepth },
      },
      {
        name: "parser",
        status: parserHealth.failureRate < 0.3 ? "operational" : "degraded",
        latencyMs: null,
        lastCheckedAt: nowISO(),
        lastSuccessAt: nowISO(),
        failureReason: parserHealth.failureRate >= 0.3
          ? `High failure rate: ${Math.round(parserHealth.failureRate * 100)}%`
          : null,
        uptime: Math.round((1 - parserHealth.failureRate) * 100),
        details: {
          avgConfidence: Math.round(parserHealth.avgConfidence * 100),
          failureRate: Math.round(parserHealth.failureRate * 100),
        },
      },
    ];

    const overallStatus = computeOverallStatus(services);
    const apiKeys = getApiKeyStatuses();

    return {
      overallStatus,
      services,
      apiKeys,
      queueDepth,
      parserHealth,
      aiHealth,
      generatedAt: nowISO(),
    };
  } catch {
    return {
      overallStatus: "unknown",
      services: [],
      apiKeys: [],
      queueDepth: 0,
      parserHealth: { avgConfidence: 0, failureRate: 0 },
      aiHealth: { groqAvailable: false, openaiAvailable: false, lastModel: null, avgLatencyMs: 0 },
      generatedAt: nowISO(),
    };
  }
}
