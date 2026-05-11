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

// 4-digit PINs are never logged — mask before any console/Firestore write
function maskIfPin(body: string): string {
  return /^\d{4}$/.test(body.trim()) ? "****" : body;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch (err) {
    await logError("[webhook] formData parse", err, { severity: "warn" });
    // Still reply — user must never get silence
    return xml(twimlReply(fmtSystemError()));
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
