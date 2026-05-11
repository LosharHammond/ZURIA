import { NextRequest, NextResponse } from "next/server";
import { getAdminDb, verifyIdToken } from "@/lib/firebase/admin";
import { collections } from "@/lib/firebase/collections";
import type { WaSession } from "@/lib/whatsapp/security";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // Verify Firebase ID token — only the authenticated user can query their own session
  const decoded = await verifyIdToken(req.headers.get("Authorization"));
  if (!decoded) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // The phone to query — from the token, not the query string (prevents enumeration)
  const phone = decoded.phone_number;
  if (!phone) {
    return NextResponse.json({ error: "No phone in token" }, { status: 400 });
  }

  try {
    const snap = await getAdminDb().collection(collections.whatsappSessions).doc(phone).get();
    if (!snap.exists) {
      return NextResponse.json({ state: "none", expiresAt: null });
    }
    const s = snap.data() as WaSession;
    return NextResponse.json({ state: s.state, expiresAt: s.expiresAt ?? null });
  } catch {
    return NextResponse.json({ error: "Failed to fetch session" }, { status: 500 });
  }
}
