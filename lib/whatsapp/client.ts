const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID ?? "";
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN ?? "";
const FROM_NUMBER = process.env.TWILIO_WHATSAPP_NUMBER ?? ""; // e.g. "whatsapp:+14155238886"

// Used for proactive outbound messages (not needed for webhook reply flow)
export async function sendText(to: string, body: string): Promise<void> {
  if (!ACCOUNT_SID || !AUTH_TOKEN || !FROM_NUMBER) {
    console.warn("[Twilio] Missing credentials — message not sent:", body);
    return;
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`;
  const res = await fetch(url, {
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

  if (!res.ok) {
    console.error("[Twilio] Send failed:", await res.text());
  }
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
