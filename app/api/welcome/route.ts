import { type NextRequest, NextResponse } from "next/server";
import { verifyIdToken } from "@/lib/firebase/admin";
import { sendText } from "@/lib/whatsapp/client";
import { fmtWelcome } from "@/lib/whatsapp/formatter";
import type { BusinessCategory } from "@/types/domain";

export const dynamic = "force-dynamic";

// POST /api/welcome
// Called after a user completes onboarding to send a WhatsApp welcome message.
// Requires a valid Firebase ID token — the user must be authenticated.

export async function POST(req: NextRequest) {
  const decoded = await verifyIdToken(req.headers.get("Authorization"));
  if (!decoded) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { phone: string; ownerName: string; businessName: string; category: BusinessCategory };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { phone, ownerName, businessName, category } = body;
  if (!phone || !ownerName || !businessName) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  try {
    await sendText(`whatsapp:${phone}`, fmtWelcome(ownerName, businessName, category ?? "provision"));
    return NextResponse.json({ ok: true });
  } catch (err) {
    // Non-critical — user is already registered, welcome message is best-effort
    console.error("[welcome] Failed to send welcome message:", err);
    return NextResponse.json({ ok: false, error: "Message delivery failed" }, { status: 500 });
  }
}
