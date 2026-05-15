/**
 * Telegram Bot API client — thin wrapper over the HTTP API.
 * No npm package required; uses native fetch.
 *
 * Improvements over the original:
 *  - AbortController timeout (8 s) so a slow Telegram API never hangs the function
 *  - 2 retries with exponential back-off for transient network / 5xx failures
 *  - 4xx errors are NOT retried (bad request, chat not found, bot blocked, etc.)
 */

const TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
const API   = `https://api.telegram.org/bot${TOKEN}`;

const SEND_TIMEOUT_MS = 8_000;  // per attempt
const MAX_RETRIES     = 2;       // up to 3 total attempts
const RETRY_DELAYS_MS = [500, 1_000]; // exponential back-off

/** Send a plain-text (Markdown) message to a Telegram chat */
export async function sendTelegram(
  chatId: number | string,
  text: string,
  extra?: { parse_mode?: "Markdown" | "HTML"; disable_web_page_preview?: boolean }
): Promise<void> {
  if (!TOKEN) {
    console.warn("[telegram] TELEGRAM_BOT_TOKEN not set — skipping send");
    return;
  }

  const body = JSON.stringify({
    chat_id:   chatId,
    text,
    parse_mode:               extra?.parse_mode               ?? "Markdown",
    disable_web_page_preview: extra?.disable_web_page_preview ?? true,
  });

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);

    try {
      const res = await fetch(`${API}/sendMessage`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal:  controller.signal,
      });
      clearTimeout(timer);

      if (res.ok) return; // ✅ success

      const errText = await res.text().catch(() => "(unreadable)");
      console.error(`[telegram/send] attempt ${attempt + 1} HTTP ${res.status}:`, errText);

      // 4xx = client error (bot blocked, invalid chat, message too long, etc.)
      // No amount of retrying will fix these — give up immediately.
      if (res.status >= 400 && res.status < 500) return;

      // 5xx = server error — fall through to retry
    } catch (fetchErr) {
      clearTimeout(timer);
      const isAbort = fetchErr instanceof Error && fetchErr.name === "AbortError";
      console.warn(
        `[telegram/send] attempt ${attempt + 1} ${isAbort ? "timed out" : "fetch failed"}:`,
        fetchErr
      );
    }

    // Wait before the next attempt (skip wait after the final attempt)
    if (attempt < MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt] ?? 1_000));
    }
  }

  console.error("[telegram/send] all attempts exhausted — message not delivered to chat:", chatId);
}

/** Answer a Telegram webhook with a 200 OK (fast path — no await needed) */
export function telegramOk() {
  return new Response(JSON.stringify({ ok: true }), {
    status:  200,
    headers: { "Content-Type": "application/json" },
  });
}
