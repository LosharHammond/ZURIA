/**
 * Telegram Bot API client — thin wrapper over the HTTP API.
 * No npm package required; uses native fetch.
 */

const TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
const API   = `https://api.telegram.org/bot${TOKEN}`;

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
  try {
    const res = await fetch(`${API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id:   chatId,
        text,
        parse_mode: extra?.parse_mode ?? "Markdown",
        disable_web_page_preview: extra?.disable_web_page_preview ?? true,
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error("[telegram/send] error:", err);
    }
  } catch (err) {
    console.error("[telegram/send] fetch failed:", err);
  }
}

/** Answer a Telegram webhook with a 200 OK (fast path — no await needed) */
export function telegramOk() {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
