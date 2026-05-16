/**
 * GET /api/cron/process-webhooks
 *
 * Vercel Cron: runs every minute (`* * * * *` in vercel.json).
 *
 * Drains the webhook_queue collection:
 *  - Picks up to BATCH_SIZE "pending" events eligible for processing
 *  - Processes each with full idempotency guarantees
 *  - On success: marks "done"
 *  - On failure: increments attempts, schedules exponential back-off retry
 *  - On maxAttempts exceeded: marks "dead" for manual review / DLQ alerting
 *
 * This decouples Paystack webhook delivery from processing latency and
 * eliminates the serverless-timeout risk on the ingestion endpoint.
 */

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { collections } from "@/lib/firebase/collections";
import { processWebhookEvent, isEventFresh, verifyAndActivateMissedPayment } from "@/lib/payments/webhook-processor";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Vercel Pro: up to 60s per cron invocation

const BATCH_SIZE = 20; // events to process per invocation

/** Exponential back-off: 30s, 2m, 10m, 30m, then dead */
function nextRetryDelay(attempts: number): number {
  const delays = [30, 120, 600, 1800];
  return (delays[attempts] ?? 3600) * 1000; // ms
}

export async function GET(req: Request) {
  // Vercel Cron authentication — prevents public invocation
  const authHeader = req.headers.get("Authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db  = getAdminDb();
  const now = new Date();

  // Fetch pending events that are eligible for processing (nextRetryAt <= now)
  const queueSnap = await db
    .collection(collections.webhookQueue)
    .where("status", "==", "pending")
    .where("nextRetryAt", "<=", now.toISOString())
    .orderBy("nextRetryAt", "asc")
    .limit(BATCH_SIZE)
    .get();

  if (queueSnap.empty) {
    return NextResponse.json({ ok: true, processed: 0, message: "Queue empty" });
  }

  const results = await Promise.allSettled(
    queueSnap.docs.map(async (doc) => {
      const entry = doc.data() as {
        id: string;
        eventType: string;
        data: Record<string, unknown>;
        attempts: number;
        maxAttempts: number;
      };

      // Mark in-progress atomically to prevent concurrent worker double-processing
      await doc.ref.update({ status: "processing", processingStartedAt: now.toISOString() });

      try {
        // Replay-attack guard still applies even for queued events
        if (!isEventFresh(entry.data)) {
          await doc.ref.update({ status: "done", skippedReason: "stale_event", processedAt: now.toISOString() });
          return { id: entry.id, result: "skipped:stale" };
        }

        let result = await processWebhookEvent(entry.eventType, entry.data);

        // If payment record not found, try Paystack verification fallback
        if (!result.ok && result.message.includes("not found") && entry.eventType === "charge.success") {
          const reference = (entry.data.reference as string | undefined) ?? "";
          if (reference) {
            result = await verifyAndActivateMissedPayment(reference);
          }
        }

        if (result.ok) {
          await doc.ref.update({ status: "done", processedAt: now.toISOString(), lastResult: result.message });
          return { id: entry.id, result: "done" };
        }

        // Processing returned ok:false — schedule retry
        throw new Error(result.message);

      } catch (err) {
        const nextAttempts = entry.attempts + 1;
        const isDead       = nextAttempts >= entry.maxAttempts;

        await doc.ref.update({
          status:      isDead ? "dead" : "pending",
          attempts:    nextAttempts,
          lastError:   err instanceof Error ? err.message : String(err),
          lastErrorAt: now.toISOString(),
          nextRetryAt: isDead
            ? null
            : new Date(now.getTime() + nextRetryDelay(nextAttempts)).toISOString(),
          ...(isDead ? { deadAt: now.toISOString() } : {}),
        });

        if (isDead) {
          // Alert: in production, integrate with PagerDuty / Slack here
          console.error(`[cron/process-webhooks] DEAD LETTER: event ${entry.id} exhausted ${entry.maxAttempts} attempts`);
        }

        return { id: entry.id, result: isDead ? "dead" : "retrying" };
      }
    })
  );

  const summary = results.map((r) =>
    r.status === "fulfilled" ? r.value : { id: "unknown", result: "error" }
  );

  return NextResponse.json({
    ok: true,
    processed: summary.length,
    summary,
  });
}
