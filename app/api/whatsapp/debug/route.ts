import { type NextRequest, NextResponse } from "next/server";
import { verifyAdminToken } from "@/lib/firebase/admin";

// Debug endpoint is disabled in production.
// Set ENABLE_DEBUG_ENDPOINT=true in .env.local to enable during development only.
// Even when enabled, requires a valid admin Bearer token to prevent
// unauthenticated enumeration of which env vars are configured.
const ENABLED = process.env.NODE_ENV !== "production" && process.env.ENABLE_DEBUG_ENDPOINT === "true";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!ENABLED) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Require admin auth even in dev — config status reveals which secrets are present
  const decoded = await verifyAdminToken(req.headers.get("Authorization"));
  if (!decoded) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  // Dynamic import so it's only loaded when actually enabled
  const { normalizePhone } = await import("@/lib/whatsapp/client");
  void normalizePhone; // used dynamically below

  const status = {
    twilio_account_sid: process.env.TWILIO_ACCOUNT_SID ? "set" : "missing",
    twilio_auth_token: process.env.TWILIO_AUTH_TOKEN ? "set" : "missing",
    twilio_whatsapp_number: process.env.TWILIO_WHATSAPP_NUMBER ? "set" : "missing",
    firebase_admin: process.env.FIREBASE_CLIENT_EMAIL ? "set" : "missing",
    paystack: process.env.PAYSTACK_SECRET_KEY ? "set" : "missing",
  };

  return NextResponse.json(status);
}

export async function POST(req: NextRequest) {
  if (!ENABLED) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const decoded = await verifyAdminToken(req.headers.get("Authorization"));
  if (!decoded) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  return NextResponse.json({ error: "Use GET to check config status" }, { status: 405 });
}
