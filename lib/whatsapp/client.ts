import { createLogger } from "@/lib/observability/logger";
const logger = createLogger("whatsapp:client");

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID ?? "";
const AUTH_TOKEN  = process.env.TWILIO_AUTH_TOKEN  ?? "";
const FROM_NUMBER = process.env.TWILIO_WHATSAPP_NUMBER ?? ""; // e.g. "whatsapp:+14155238886"

export class TwilioError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly twilioCode: number | null,
    message: string
  ) {
    super(message);
    this.name = "TwilioError";
  }
}

/**
 * Send a WhatsApp message via Twilio.
 *
 * - Skips silently when credentials are missing (dev/test mode).
 * - Retries once on transient 5xx errors with a 1 s delay.
 * - Throws TwilioError on permanent failures (4xx) so callers can decide
 *   whether to log or swallow the error.
 */
export async function sendText(to: string, body: string, _retryCount = 0): Promise<void> {
  if (!ACCOUNT_SID || !AUTH_TOKEN || !FROM_NUMBER) {
    logger.warn("Twilio credentials not configured — message skipped (dev mode)");
    return;
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`;
  let res: Response;

  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        From: FROM_NUMBER,
        To: to.startsWith("whatsapp:") ? to : `whatsapp:${to}`,
        Body: body,
      }).toString(),
    });
  } catch (networkErr) {
    // Network-level failure (DNS, timeout, etc.) — retry once
    if (_retryCount === 0) {
      await new Promise((r) => setTimeout(r, 1000));
      return sendText(to, body, 1);
    }
    throw new TwilioError(0, null, `Network error sending WhatsApp message: ${networkErr instanceof Error ? networkErr.message : String(networkErr)}`);
  }

  if (res.ok) return;

  // Parse Twilio error body for structured code
  let twilioBody: { code?: number; message?: string } = {};
  try { twilioBody = await res.json(); } catch { /* ignore parse errors */ }

  const twilioCode = twilioBody.code ?? null;
  const errMsg = `Twilio send failed [HTTP ${res.status}${twilioCode ? `, code ${twilioCode}` : ""}]: ${twilioBody.message ?? "unknown"}`;

  // Retry once on 5xx transient errors
  if (res.status >= 500 && _retryCount === 0) {
    await new Promise((r) => setTimeout(r, 1000));
    return sendText(to, body, 1);
  }

  throw new TwilioError(res.status, twilioCode, errMsg);
}

// Strip the "whatsapp:" prefix Twilio adds and normalise to "+2332..."
export function normalizePhone(twilioFrom: string): string {
  const raw = twilioFrom.replace(/^whatsapp:/, "");
  const digits = raw.replace(/\D/g, "");
  return `+${digits}`;
}

// Build a TwiML reply — the simplest way to respond to an inbound Twilio webhook
export function twimlReply(message: string): string {
  const safe = message
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${safe}</Message></Response>`;
}
