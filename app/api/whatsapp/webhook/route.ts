import { createHmac } from "crypto";
import { type NextRequest, NextResponse } from "next/server";
import { handleMessage } from "@/lib/whatsapp/handler";
import { normalizePhone, twimlReply } from "@/lib/whatsapp/client";
import { fmtSystemError } from "@/lib/whatsapp/formatter";
import { logError } from "@/lib/server/error-logger";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// Twilio sends inbound WhatsApp messages as application/x-www-form-urlencoded POST.
// We reply with TwiML — Twilio delivers it as a WhatsApp message.
// Set this URL in Twilio console: https://yourdomain.com/api/whatsapp/webhook

// ─── Twilio HMAC-SHA1 signature validation ────────────────────────────────────
// Verifies that the request genuinely came from Twilio, not a third-party attacker.
// Spec: https://www.twilio.com/docs/usage/security#validating-signatures-from-twilio
// Only enforced in production so local dev/staging isn't blocked.
/**
 * Reconstructs the canonical public URL that Twilio signed.
 *
 * Behind a reverse proxy (Vercel, nginx, etc.) `request.url` carries the
 * internal http:// address — but Twilio always signs the public https:// URL.
 * We honour the standard `x-forwarded-proto` / `x-forwarded-host` headers so
 * the URL we sign matches exactly what Twilio used.
 */
function getCanonicalUrl(request: NextRequest): string {
  const parsed = new URL(request.url);
  const proto  = request.headers.get("x-forwarded-proto") ?? parsed.protocol.replace(":", "");
  const host   = request.headers.get("x-forwarded-host")  ??
                 request.headers.get("host")               ??
                 parsed.host;
  // Twilio appends the full path + query string to the URL before signing
  return `${proto}://${host}${parsed.pathname}${parsed.search}`;
}

function isTwilioSignatureValid(
  request: NextRequest,
  rawBody: string
): boolean {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken || process.env.NODE_ENV !== "production") return true; // skip in dev/staging

  const signature = request.headers.get("x-twilio-signature") ?? "";
  if (!signature) return false;

  const url = getCanonicalUrl(request);

  // Sort POST params alphabetically and concatenate key+value to the URL string
  const params = new URLSearchParams(rawBody);
  const sorted = Array.from(params.entries()).sort(([a], [b]) => a.localeCompare(b));
  let sigBase = url;
  for (const [key, value] of sorted) {
    sigBase += key + value;
  }

  const expected = createHmac("sha1", authToken).update(sigBase).digest("base64");
  return expected === signature;
}

// ─── MessageSid deduplication ─────────────────────────────────────────────────
// Twilio may retry a webhook if our server is slow. Track recent MessageSids for
// 5 minutes so duplicate deliveries don't create duplicate transactions.
const recentSids = new Map<string, number>(); // sid → timestamp
const SID_TTL_MS = 5 * 60 * 1000; // 5 minutes

function isDuplicateSid(sid: string): boolean {
  if (!sid) return false;
  const now = Date.now();
  // Prune stale entries
  for (const [s, ts] of recentSids) {
    if (now - ts > SID_TTL_MS) recentSids.delete(s);
  }
  if (recentSids.has(sid)) return true;
  recentSids.set(sid, now);
  return false;
}

// 4-digit PINs are never logged — mask before any console/Firestore write
function maskIfPin(body: string): string {
  return /^\d{4}$/.test(body.trim()) ? "****" : body;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Read the raw body once so we can use it for both signature validation and parsing
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch (err) {
    await logError("[webhook] body read", err, { severity: "warn" });
    return xml(twimlReply(fmtSystemError()));
  }

  // Reject requests that don't carry a valid Twilio signature (production only)
  if (!isTwilioSignatureValid(request, rawBody)) {
    console.warn("[webhook] Invalid Twilio signature — request rejected");
    return new NextResponse("Forbidden", { status: 403 });
  }

  let form: FormData;
  try {
    form = await new Request(request.url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: rawBody,
    }).formData();
  } catch (err) {
    await logError("[webhook] formData parse", err, { severity: "warn" });
    return xml(twimlReply(fmtSystemError()));
  }

  const messageSid = (form.get("MessageSid") as string | null) ?? "";
  if (isDuplicateSid(messageSid)) {
    // Twilio retry — return 200 with the empty TwiML so Twilio stops retrying
    console.info("[webhook] duplicate MessageSid, skipping:", messageSid);
    return xml(twimlReply(""));
  }

  const from = (form.get("From") as string | null) ?? "";
  const body = ((form.get("Body") as string | null) ?? "").trim();

  if (!from || !body) {
    return xml(twimlReply(""));
  }

  const phone = normalizePhone(from);
  const safeBody = maskIfPin(body); // never log raw 4-digit PINs
  console.info("[webhook] incoming", phone, safeBody.slice(0, 40));

  // Rate limit: max 20 messages per phone per minute
  const { allowed } = rateLimit(`wa:${phone}`, 20, 60_000);
  if (!allowed) {
    return xml(twimlReply("⏳ You're sending messages too fast. Please wait a moment and try again."));
  }

  let reply: string;
  try {
    reply = await handleMessage(phone, body);
  } catch (err) {
    // Log to Firestore so admin can see it, then always reply to user
    await logError("[webhook] handleMessage", err, { phone, severity: "error" });
    reply = fmtSystemError();
  }

  return xml(twimlReply(reply));
}

function xml(content: string): NextResponse {
  return new NextResponse(content, {
    status: 200,
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}
