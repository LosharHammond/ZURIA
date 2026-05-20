import { NextResponse } from "next/server";
import { getAdminDb, getAdminAuth } from "@/lib/firebase/admin";
import { collections } from "@/lib/firebase/collections";
import { rateLimit } from "@/lib/rate-limit";
import { hashPin, verifyPin } from "@/lib/security/pin";
import { normalisePhone, E164_REGEX } from "@/lib/utils/phone";
import { createLogger } from "@/lib/observability/logger";
const logger = createLogger("auth:phone-login");

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/phone-login
 *
 * Two-stage flow (single endpoint):
 *
 * Stage 1 — phone only: { phone }
 *   Returns { isNewUser: true }  → client redirects to /onboarding
 *   Returns { isNewUser: false } → client shows PIN input
 *
 * Stage 2 — phone + PIN: { phone, pin }
 *   Verifies PIN against stored whatsappPin.
 *   Returns { token, phone }     → client signs in with custom token
 *   Returns 401 on wrong PIN
 *
 * Security: rate-limited to 8 attempts per phone per hour.
 */
export async function POST(req: Request) {
  let body: { phone?: string; pin?: string };
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
  if (!E164_REGEX.test(phone)) {
    return NextResponse.json(
      { error: "Enter a valid phone number, e.g. 0241234567 or +233241234567" },
      { status: 400 }
    );
  }

  // Rate limit per phone (shared across both stages)
  const { allowed } = rateLimit(`login:${phone}`, 8, 60 * 60 * 1000);
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait an hour and try again." },
      { status: 429 }
    );
  }

  try {
    const db = getAdminDb();

    // Look for an existing ZURIA user with this phone number
    const snap = await db
      .collection(collections.users)
      .where("phoneNumber", "==", phone)
      .limit(1)
      .get();

    // ── Stage 1: phone-only check ──────────────────────────────────────────
    if (!body.pin) {
      return NextResponse.json({ isNewUser: snap.empty });
    }

    // ── Stage 2: PIN verification ──────────────────────────────────────────
    if (snap.empty) {
      // Phone not registered — don't hint at which field is wrong
      return NextResponse.json(
        { error: "Incorrect phone number or PIN. Please try again." },
        { status: 401 }
      );
    }

    const userDoc  = snap.docs[0];
    const userData = userDoc.data();
    const uid      = userDoc.id;
    const storedPin: string | undefined = userData.whatsappPin;

    // If user has no PIN set yet, guide them to the app
    if (!storedPin) {
      return NextResponse.json(
        { error: "No PIN is set for this account. Open the ZURIA app → Profile → Set PIN." },
        { status: 403 }
      );
    }

    const pinCheck = verifyPin(String(body.pin), storedPin);
    if (!pinCheck.valid) {
      return NextResponse.json(
        { error: "Incorrect PIN. Please try again." },
        { status: 401 }
      );
    }
    if (pinCheck.needsRehash) {
      userDoc.ref.update({ whatsappPin: hashPin(String(body.pin)) }).catch(() => {});
    }

    // PIN correct — issue a short-lived Firebase custom token
    const customToken = await getAdminAuth().createCustomToken(uid, { phone });
    return NextResponse.json({ token: customToken, phone, isNewUser: false });
  } catch (err) {
    logger.error("phone-login failed", { err: String(err) });
    return NextResponse.json(
      { error: "Authentication failed. Please try again." },
      { status: 500 }
    );
  }
}
