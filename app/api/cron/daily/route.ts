/**
 * GET /api/cron/daily
 *
 * Master daily cron — the ONE scheduled job on the Vercel Hobby plan.
 * Vercel Hobby allows only a single daily cron; this route runs every
 * task that used to be separate crons, in one invocation.
 *
 * Schedule: `0 3 * * *` (3 AM UTC daily)
 * Max duration: 300 s (Vercel Hobby cap)
 *
 * Tasks (run in parallel, failures isolated):
 *   1. expire-subscriptions  — reset expired paid plans → free
 *   2. reconcile-payments    — repair orphaned Paystack successes
 *   3. process-webhooks      — drain webhook_queue
 *   4. business-dna          — refresh DNA + timeline for active businesses
 *   5. proactive-insights    — generate daily insights for active businesses
 *
 * Each task is called via its own internal route so its logic stays
 * single-source. We forward the CRON_SECRET so auth passes.
 *
 * Individual routes remain accessible for manual triggering:
 *   curl -H "Authorization: Bearer $CRON_SECRET" /api/cron/business-dna
 */

import { NextResponse } from "next/server";
import { createLogger } from "@/lib/observability/logger";

export const dynamic     = "force-dynamic";
export const maxDuration = 300;

const logger = createLogger("cron:daily");

const TASKS = [
  "expire-subscriptions",
  "reconcile-payments",
  "process-webhooks",
  "business-dna",
  "proactive-insights",
] as const;

type TaskName = (typeof TASKS)[number];

interface TaskResult {
  task:     TaskName;
  ok:       boolean;
  status?:  number;
  body?:    unknown;
  error?:   string;
  durationMs: number;
}

export async function GET(req: Request) {
  // Auth — same CRON_SECRET used by all individual routes
  if (
    req.headers.get("Authorization") !==
    `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ranAt  = new Date().toISOString();
  const origin = new URL(req.url).origin;
  const secret = process.env.CRON_SECRET ?? "";

  logger.info("daily cron started", { tasks: TASKS });

  // ── Run all tasks in parallel, isolated failures ───────────────────────────
  const settled = await Promise.allSettled(
    TASKS.map(async (task): Promise<TaskResult> => {
      const t0  = Date.now();
      const url = `${origin}/api/cron/${task}`;
      try {
        const res  = await fetch(url, {
          method:  "GET",
          headers: { Authorization: `Bearer ${secret}` },
        });
        const body = await res.json().catch(() => null);
        const durationMs = Date.now() - t0;
        logger.info("task completed", { task, status: res.status, durationMs });
        return { task, ok: res.ok, status: res.status, body, durationMs };
      } catch (err) {
        const durationMs = Date.now() - t0;
        const error = err instanceof Error ? err.message : String(err);
        logger.warn("task failed", { task, error, durationMs });
        return { task, ok: false, error, durationMs };
      }
    }),
  );

  const results: TaskResult[] = settled.map((s) =>
    s.status === "fulfilled"
      ? s.value
      : { task: "unknown" as TaskName, ok: false, error: String(s.reason), durationMs: 0 },
  );

  const completedAt = new Date().toISOString();
  const allOk       = results.every((r) => r.ok);

  logger.info("daily cron completed", {
    allOk,
    tasks:       results.map((r) => `${r.task}:${r.ok ? "ok" : "fail"}`),
    completedAt,
  });

  return NextResponse.json({
    ok:          allOk,
    ranAt,
    completedAt,
    tasks:       results,
  });
}
