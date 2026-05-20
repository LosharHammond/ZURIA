/**
 * POST /api/telegram/webhook
 *
 * Telegram sends every bot update here. We acknowledge immediately with 200
 * (so Telegram doesn't retry within its 5-second window) and schedule the
 * message handler with next/server `after()` — which keeps the Vercel function
 * alive until the handler fully settles, even after the response is flushed.
 *
 * Set your webhook once (run from any terminal after deploy):
 *   curl "https://YOUR_DOMAIN/api/telegram/webhook?setup=1&key=YOUR_TELEGRAM_WEBHOOK_SECRET"
 */

import { type NextRequest, NextResponse, after } from "next/server";
import { handleTelegram } from "@/lib/telegram/handler";
import { getAdminDb } from "@/lib/firebase/admin";
import { captureZuriaError } from "@/lib/observability/sentry";
import { collections } from "@/lib/firebase/collections";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// Optional: verify Telegram's secret token header to prevent spoofed requests.
// Set TELEGRAM_WEBHOOK_SECRET in Vercel env vars — highly recommended.
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET ?? "";

// ─── Firestore-backed idempotency deduplication ───────────────────────────────
// Replaces the unreliable in-memory Map that resets on every cold start and
// is isolated per serverless instance. Firestore guarantees cross-instance
// deduplication — Telegram may redeliver an update if its 200 was lost.

const UPDATE_ID_TTL_MS = 10 * 60 * 1000; // 10 minutes

async function markAndCheckDuplicate(updateId: number): Promise<boolean> {
  const db = getAdminDb();
  const ref = db.collection(collections.idempotencyKeys).doc(`tg_${updateId}`);

  try {
    const isDupe = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists) return true; // already processed

      tx.set(ref, {
        updateId,
        source:    "telegram",
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + UPDATE_ID_TTL_MS).toISOString(),
      });
      return false;
    });
    return isDupe;
  } catch {
    // On Firestore failure allow processing — better to double-handle than drop.
    return false;
  }
}

// ─── POST — main webhook handler ─────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // 1. Verify the Telegram secret token header
  //
  // Three cases:
  //  a) TELEGRAM_WEBHOOK_SECRET not set in env → skip check entirely (open)
  //  b) Secret is set AND the header matches → allow (registered correctly)
  //  c) Secret is set AND header is present but WRONG → reject (spoofed request)
  //
  // Notably: if the secret is set but the header is ABSENT, we allow the
  // request and log a warning instead of 403-ing. This handles the common
  // deployment race where the webhook was registered before the env var was
  // added — Telegram won't send the header until the webhook is re-registered
  // via GET /api/telegram/webhook?setup=1&key=SECRET.
  if (WEBHOOK_SECRET) {
    const incoming = req.headers.get("x-telegram-bot-api-secret-token");
    if (incoming !== null && incoming !== WEBHOOK_SECRET) {
      // Header is present but wrong — this is a spoofed request, reject it.
      console.warn("[telegram/webhook] rejected — wrong secret token (possible spoof)");
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (incoming === null) {
      // Header is absent — webhook not yet registered with the secret.
      // Allow but warn loudly so the operator knows to re-register.
      console.warn(
        "[telegram/webhook] WARNING: TELEGRAM_WEBHOOK_SECRET is set but the " +
        "incoming request carries no X-Telegram-Bot-Api-Secret-Token header. " +
        "Re-register the webhook: GET /api/telegram/webhook?setup=1&key=YOUR_SECRET"
      );
    }
  }

  // 2. Parse the update body
  let update: Record<string, unknown>;
  try {
    update = await req.json();
  } catch {
    // Malformed body — acknowledge so Telegram doesn't retry endlessly
    return NextResponse.json({ ok: true });
  }

  // 2b. Per-sender rate limit (60 messages per minute)
  const senderChat = (update.message as Record<string, unknown> | undefined)?.chat as Record<string, unknown> | undefined;
  const chatId     = senderChat?.id ?? req.headers.get("x-forwarded-for") ?? "unknown";
  const { allowed: senderAllowed } = rateLimit(`tg-msg:${chatId}`, 60, 60 * 1000);
  if (!senderAllowed) {
    return NextResponse.json({ ok: true }); // acknowledge silently — don't leak 429 to Telegram
  }

  // 3. Deduplicate using Firestore (works across instances and cold starts)
  const updateId = update.update_id as number | undefined;
  if (typeof updateId === "number") {
    const isDuplicate = await markAndCheckDuplicate(updateId);
    if (isDuplicate) {
      console.info("[telegram/webhook] duplicate update_id, skipping:", updateId);
      return NextResponse.json({ ok: true });
    }
  }

  // 4. Schedule handler AFTER the 200 response is flushed.
  //    next/server `after()` keeps the Vercel function alive until the
  //    promise settles — this is the fix for the fire-and-forget void bug.
  after(async () => {
    try {
      await handleTelegram(update);
    } catch (err) {
      captureZuriaError(err instanceof Error ? err : new Error(String(err)), { extra: { route: "telegram/webhook" } });
    }
  });

  // 5. Acknowledge immediately — Telegram retries if it doesn't see 200 within 5 s
  return NextResponse.json({ ok: true });
}

// ─── GET — health check + one-click webhook registration ─────────────────────
// GET  /api/telegram/webhook              → show current status
// GET  /api/telegram/webhook?setup=1&key=SECRET → register webhook with Telegram

export async function GET(req: NextRequest) {
  const token  = process.env.TELEGRAM_BOT_TOKEN ?? "";
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET ?? "";

  if (!token) {
    return NextResponse.json({
      service: "ZURIA Telegram Bot",
      status:  "error",
      problem: "TELEGRAM_BOT_TOKEN is not set",
      fix:     "Add TELEGRAM_BOT_TOKEN in Vercel → Project Settings → Environment Variables, then redeploy",
    }, { status: 503 });
  }

  const url = new URL(req.url);

  // ── Auto-register webhook (requires matching key for security) ────────────
  if (url.searchParams.get("setup") === "1") {
    // Require the TELEGRAM_WEBHOOK_SECRET as ?key= to prevent anyone who
    // knows the URL from re-pointing the webhook to a malicious server.
    const providedKey = url.searchParams.get("key") ?? "";
    if (!secret || providedKey !== secret) {
      return NextResponse.json(
        { error: "Forbidden — pass ?setup=1&key=TELEGRAM_WEBHOOK_SECRET to authorise" },
        { status: 403 }
      );
    }

    const webhookUrl = `${appUrl}/api/telegram/webhook`;
    const body: Record<string, string | string[]> = {
      url: webhookUrl,
      // Only receive message and edited_message updates — ignores polls,
      // inline queries, etc. to reduce noise and improve throughput.
      allowed_updates: ["message", "edited_message"],
    };
    if (secret) body.secret_token = secret;

    const tgRes  = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const tgData = await tgRes.json() as { ok: boolean; description?: string };

    return NextResponse.json({
      service:    "ZURIA Telegram Bot",
      registered: tgData.ok,
      webhookUrl,
      message:    tgData.ok
        ? "✅ Webhook registered! Bot is now live."
        : `❌ ${tgData.description}`,
    });
  }

  // ── Status check only ─────────────────────────────────────────────────────
  const infoRes  = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
  const infoData = await infoRes.json() as {
    result?: {
      url?: string;
      pending_update_count?: number;
      last_error_message?: string;
      last_error_date?: number;
    };
  };
  const isRegistered = !!(infoData.result?.url);
  const lastErrorDate = infoData.result?.last_error_date
    ? new Date(infoData.result.last_error_date * 1000).toISOString()
    : null;

  return NextResponse.json({
    service:        "ZURIA Telegram Bot",
    status:         isRegistered ? "✅ active" : "❌ not registered",
    webhookUrl:     infoData.result?.url || "(none)",
    pendingUpdates: infoData.result?.pending_update_count ?? 0,
    lastError:      infoData.result?.last_error_message ?? null,
    lastErrorAt:    lastErrorDate,
    next:           isRegistered
      ? "Bot is live. Send /start to your bot to test."
      : `Register: GET ${appUrl}/api/telegram/webhook?setup=1&key=YOUR_TELEGRAM_WEBHOOK_SECRET`,
  });
}
