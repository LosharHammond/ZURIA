import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { collections } from "@/lib/firebase/collections";
import { rateLimit } from "@/lib/rate-limit";
import { hashPin } from "@/lib/security/pin";
import { normalisePhone, E164_REGEX } from "@/lib/utils/phone";
import { createLogger } from "@/lib/observability/logger";
const logger = createLogger("auth:forgot-pin");

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/forgot-pin
 *
 * Self-service PIN reset — verifies identity via phone + business name,
 * then sets a new 4-digit PIN. No OTP required.
 *
 * Body: { phone, businessName, newPin }
 * Rate-limited: 3 resets per phone per hour.
 */
export async function POST(req: Request) {
  let body: { phone?: string; businessName?: string; newPin?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const rawPhone     = (body.phone ?? "").trim();
  const businessName = (body.businessName ?? "").trim();
  const newPin       = (body.newPin ?? "").trim();

  if (!rawPhone) {
    return NextResponse.json({ error: "Phone number is required" }, { status: 400 });
  }

  const phone = normalisePhone(rawPhone);
  if (!E164_REGEX.test(phone)) {
    return NextResponse.json(
      { error: "Enter a valid phone number, e.g. 0241234567" },
      { status: 400 }
    );
  }

  if (!businessName) {
    return NextResponse.json({ error: "Business name is required" }, { status: 400 });
  }

  if (!/^\d{4}$/.test(newPin)) {
    return NextResponse.json({ error: "PIN must be exactly 4 digits" }, { status: 400 });
  }

  // Strict rate limit — 3 attempts per phone per hour.
  // NOTE: This uses an in-memory limiter. In multi-instance/serverless deployments
  // each instance enforces limits independently. For stronger protection, replace
  // rateLimit() with a Redis-backed solution (see lib/rate-limit.ts).
  const { allowed } = rateLimit(`forgot-pin:${phone}`, 3, 60 * 60 * 1000);
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many reset attempts. Please wait an hour and try again." },
      { status: 429 }
    );
  }

  try {
    const db = getAdminDb();

    // Find user by phone
    const userSnap = await db
      .collection(collections.users)
      .where("phoneNumber", "==", phone)
      .limit(1)
      .get();

    if (userSnap.empty) {
      // Don't reveal whether phone is registered
      return NextResponse.json(
        { error: "Details do not match our records. Please check your phone number and business name." },
        { status: 401 }
      );
    }

    const userDoc  = userSnap.docs[0];
    const userData = userDoc.data();
    const uid      = userDoc.id;

    // Must have a business ID to verify against
    const businessId: string | undefined = userData.businessId;
    if (!businessId) {
      return NextResponse.json(
        { error: "Account setup is incomplete. Please contact support." },
        { status: 400 }
      );
    }

    // Fetch business and compare name (case-insensitive, trimmed)
    const bizDoc = await db.collection(collections.businesses).doc(businessId).get();
    if (!bizDoc.exists) {
      return NextResponse.json(
        { error: "Details do not match our records. Please check your phone number and business name." },
        { status: 401 }
      );
    }

    const storedName: string = (bizDoc.data()?.name as string | undefined) ?? "";
    const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "").trim();

    if (normalise(storedName) !== normalise(businessName)) {
      return NextResponse.json(
        { error: "The business name doesn't match what we have on file. Please check and try again." },
        { status: 401 }
      );
    }

    // Identity confirmed — update the PIN
    await db.collection(collections.users).doc(uid).update({
      whatsappPin: hashPin(newPin),
      updatedAt:   new Date().toISOString(),
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error("forgot-pin failed", { err: String(err) });
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
