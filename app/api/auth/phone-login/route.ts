import { NextResponse } from "next/server";
import { getAdminDb, getAdminAuth } from "@/lib/firebase/admin";
import { collections } from "@/lib/firebase/collections";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// Normalise any Ghana phone input → E.164 (+233XXXXXXXXX)
function normalisePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("0") && digits.length === 10) return `+233${digits.slice(1)}`;
  if (digits.startsWith("233") && digits.length === 12) return `+${digits}`;
  if (digits.length >= 10 && digits.length <= 15) return `+${digits}`;
  return `+${digits}`;
}

// POST /api/auth/phone-login
// Called from the login form. Returns a Firebase custom token the client uses
// to sign in — no OTP or SMS required.
// Security: rate-limited to 5 attempts per phone per hour.

export async function POST(req: Request) {
  let body: { phone?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const rawPhone = (body.phone ?? "").trim();
  if (!rawPhone) {
    return NextResponse.json({ error: "Phone number is required" }, { status: 400 });
  }

  const phone = normalisePhone(rawPhone);
  if (!/^\+\d{10,15}$/.test(phone)) {
    return NextResponse.json({ error: "Enter a valid phone number, e.g. 0241234567 or +233241234567" }, { status: 400 });
  }

  // Rate limit: 5 login attempts per phone per hour
  const { allowed } = rateLimit(`login:${phone}`, 5, 60 * 60 * 1000);
  if (!allowed) {
    return NextResponse.json({ error: "Too many attempts. Please wait an hour and try again." }, { status: 429 });
  }

  try {
    const db = getAdminDb();

    // Look for an existing ZURIA user with this phone number
    const snap = await db
      .collection(collections.users)
      .where("phoneNumber", "==", phone)
      .limit(1)
      .get();

    let uid: string;
    if (!snap.empty) {
      // Returning user — use their existing UID so they see their own data
      uid = snap.docs[0].id;
    } else {
      // Brand-new user — generate a stable UID derived from their phone
      // (stored as a plain doc until they complete onboarding)
      const { createId } = await import("@/lib/utils");
      uid = createId("usr");
    }

    // Generate a short-lived Firebase custom token the client can sign in with.
    // We embed the phone number in the token claims so the onboarding form can
    // read it without a separate round-trip.
    const customToken = await getAdminAuth().createCustomToken(uid, { phone });

    return NextResponse.json({ token: customToken, phone, isNewUser: snap.empty });
  } catch (err) {
    console.error("[phone-login]", err);
    return NextResponse.json({ error: "Authentication failed. Please try again." }, { status: 500 });
  }
}
