/**
 * POST /api/telegram/webhook
 *
 * Telegram sends every bot update here. We acknowledge immediately with 200
 * (so Telegram doesn't retry) and process the message asynchronously.
 *
 * Set your webhook once (run from any terminal after deploy):
 *   curl -X POST https://api.telegram.org/bot{TOKEN}/setWebhook \
 *        -d "url=https://YOUR_DOMAIN/api/telegram/webhook" \
 *        -d "secret_token=YOUR_TELEGRAM_WEBHOOK_SECRET"
 */

import { type NextRequest, NextResponse } from "next/server";
import { handleTelegram } from "@/lib/telegram/handler";

export const dynamic = "force-dynamic";

// Optional: verify Telegram's secret token header to prevent spoofed requests
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET ?? "";

// ─── update_id deduplication ──────────────────────────────────────────────────
// Telegram may redeliver an update if the previous 200 response was lost.
// Track recent update_ids for 10 minutes to prevent duplicate processing.
const recentUpdateIds = new Map<number, number>(); // update_id → timestamp
const UPDATE_ID_TTL_MS = 10 * 60 * 1000; // 10 minutes

function isDuplicateUpdate(updateId: number): boolean {
  const now = Date.now();
  // Prune stale entries
  for (const [id, ts] of recentUpdateIds) {
    if (now - ts > UPDATE_ID_TTL_MS) recentUpdateIds.delete(id);
  }
  if (recentUpdateIds.has(updateId)) return true;
  recentUpdateIds.set(updateId, now);
  return false;
}

export async function POST(req: NextRequest) {
  // Verify secret header if configured
  if (WEBHOOK_SECRET) {
    const incoming = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
    if (incoming !== WEBHOOK_SECRET) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  let update: Record<string, unknown>;
  try {
    update = await req.json();
  } catch {
    return NextResponse.json({ ok: true }); // ignore malformed bodies
  }

  // Deduplicate by update_id to prevent double-processing on Telegram retries
  const updateId = update.update_id as number | undefined;
  if (typeof updateId === "number" && isDuplicateUpdate(updateId)) {
    console.info("[telegram/webhook] duplicate update_id, skipping:", updateId);
    return NextResponse.json({ ok: true });
  }

  // Acknowledge immediately — process in background
  // Telegram re-sends if it doesn't get 200 within 5 seconds.
  void handleTelegram(update).catch((err) =>
    console.error("[telegram/webhook]", err)
  );

  return NextResponse.json({ ok: true });
}

// Health-check for the webhook URL
export async function GET() {
  const hasToken = !!process.env.TELEGRAM_BOT_TOKEN;
  return NextResponse.json({
    service: "ZURIA Telegram Bot",
    status:  hasToken ? "configured" : "missing TELEGRAM_BOT_TOKEN",
  });
}
