/**
 * GET /api/admin/observability
 *
 * Returns structured observability data: recent errors, warnings,
 * API failures, queue failures, and latency metrics.
 *
 * Auth: x-admin-key === CRON_SECRET  OR  Firebase Bearer token from admin phone.
 */

import { NextResponse, type NextRequest } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { collections } from "@/lib/firebase/collections";
import { getPlatformCostSummary } from "@/lib/ai/cost-governor";
import type { LogEntry } from "@/lib/observability/logger";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ObservabilityData {
  generatedAt: string;
  recentErrors: LogEntry[];
  recentWarnings: LogEntry[];
  errorsByModule: Record<string, number>;
  aiCostSummary: Awaited<ReturnType<typeof getPlatformCostSummary>>;
  queueFailures: QueueFailureEntry[];
  webhookFailures: WebhookFailureEntry[];
}

interface QueueFailureEntry {
  id: string;
  jobType: string;
  error: string;
  failedAt: string;
}

interface WebhookFailureEntry {
  id: string;
  eventType: string;
  attempts: number;
  lastError: string;
  receivedAt: string;
}

// ─── Auth helper ──────────────────────────────────────────────────────────────

async function isAuthorized(request: NextRequest): Promise<boolean> {
  const adminKey   = request.headers.get("x-admin-key") ?? "";
  const cronSecret = process.env.CRON_SECRET ?? "";
  const adminPhone = process.env.ADMIN_PHONE ?? "";

  if (cronSecret && adminKey === cronSecret) return true;

  if (adminPhone) {
    const authHeader = request.headers.get("authorization");
    if (authHeader?.startsWith("Bearer ")) {
      try {
        const { verifyAdminToken } = await import("@/lib/firebase/admin");
        const decoded = await verifyAdminToken(authHeader);
        if (decoded) return true;
      } catch { /* failed */ }
    }
  }

  return false;
}

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db          = getAdminDb();
    const generatedAt = new Date().toISOString();

    const [
      errorsSnap,
      warningsSnap,
      deadQueueSnap,
      deadWebhooksSnap,
      aiCostSummary,
    ] = await Promise.allSettled([
      db.collection(collections.errors)
        .orderBy("timestamp", "desc")
        .limit(50)
        .get(),
      db.collection(collections.errors)
        .where("level", "==", "warn")
        .orderBy("timestamp", "desc")
        .limit(30)
        .get(),
      db.collection(collections.jobQueue)
        .where("status", "==", "dead")
        .orderBy("updatedAt", "desc")
        .limit(20)
        .get(),
      db.collection(collections.webhookQueue)
        .where("status", "==", "dead")
        .orderBy("receivedAt", "desc")
        .limit(20)
        .get(),
      getPlatformCostSummary(),
    ]);

    // Errors
    const recentErrors: LogEntry[] = errorsSnap.status === "fulfilled"
      ? errorsSnap.value.docs.map((d) => d.data() as LogEntry)
      : [];

    const recentWarnings: LogEntry[] = warningsSnap.status === "fulfilled"
      ? warningsSnap.value.docs.map((d) => d.data() as LogEntry)
      : [];

    // Errors by module
    const errorsByModule: Record<string, number> = {};
    for (const entry of recentErrors) {
      const mod = entry.module ?? "unknown";
      errorsByModule[mod] = (errorsByModule[mod] ?? 0) + 1;
    }

    // Queue failures
    const queueFailures: QueueFailureEntry[] = deadQueueSnap.status === "fulfilled"
      ? deadQueueSnap.value.docs.map((d) => {
          const data = d.data() as Record<string, unknown>;
          return {
            id:       d.id,
            jobType:  String(data.jobType   ?? "unknown"),
            error:    String(data.lastError ?? ""),
            failedAt: String(data.updatedAt ?? data.createdAt ?? ""),
          };
        })
      : [];

    // Webhook failures
    const webhookFailures: WebhookFailureEntry[] = deadWebhooksSnap.status === "fulfilled"
      ? deadWebhooksSnap.value.docs.map((d) => {
          const data = d.data() as Record<string, unknown>;
          return {
            id:         d.id,
            eventType:  String(data.eventType  ?? "unknown"),
            attempts:   Number(data.attempts   ?? 0),
            lastError:  String(data.lastError  ?? ""),
            receivedAt: String(data.receivedAt ?? ""),
          };
        })
      : [];

    const response: ObservabilityData = {
      generatedAt,
      recentErrors,
      recentWarnings,
      errorsByModule,
      aiCostSummary: aiCostSummary.status === "fulfilled"
        ? aiCostSummary.value
        : {
            today: { totalUSD: 0, callCount: 0 },
            thisWeek: { totalUSD: 0, callCount: 0 },
            thisMonth: { totalUSD: 0, callCount: 0 },
            byModel: {},
            byPlan: {},
            generatedAt,
          },
      queueFailures,
      webhookFailures,
    };

    return NextResponse.json(response, { status: 200 });
  } catch {
    return NextResponse.json({ error: "Failed to load observability data" }, { status: 500 });
  }
}
