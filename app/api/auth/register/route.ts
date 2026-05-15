/**
 * POST /api/auth/register
 *
 * Server-side account creation — no Firebase Anonymous Auth required.
 * This is called by the /onboarding page after the user fills in their details.
 *
 * Flow:
 *   1. Validate + rate-limit the request
 *   2. Confirm the phone isn't already registered
 *   3. Create a Firebase Auth user via Admin SDK (no phone verification needed)
 *   4. Write the Firestore user + business documents via Admin SDK
 *   5. Return a custom token → client signs in with signInWithCustomToken
 *
 * Security: all Firestore writes happen server-side using the Admin SDK,
 * so Firestore security rules are irrelevant to this path.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb, getAdminAuth } from "@/lib/firebase/admin";
import { collections } from "@/lib/firebase/collections";
import { rateLimit } from "@/lib/rate-limit";
import { createId } from "@/lib/utils";
import { hashPin } from "@/lib/security/pin";

export const dynamic = "force-dynamic";

// ─── Validation schema ────────────────────────────────────────────────────────

const CATEGORIES = [
  "provision", "food", "salon", "barber", "cosmetics", "pharmacy",
  "restaurant", "spare-parts", "hardware", "momo", "other",
] as const;

const LANGUAGES = ["english", "twi", "ga", "ewe", "hausa", "fante"] as const;

const RegisterSchema = z.object({
  phone:             z.string().regex(/^\+\d{10,15}$/, "Invalid phone number"),
  ownerName:         z.string().min(2).max(80).trim(),
  businessName:      z.string().min(2).max(120).trim(),
  category:          z.enum(CATEGORIES),
  location:          z.string().min(2).max(100).trim(),
  preferredLanguage: z.enum(LANGUAGES),
  pin:               z.string().regex(/^\d{4}$/, "PIN must be exactly 4 digits"),
  referralCode:      z.string().max(20).optional(),
});

// ─── Deterministic referral code (mirrors lib/services/referral-service.ts) ───

function generateReferralCode(userId: string): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let hash = 5381;
  for (let i = 0; i < userId.length; i++) {
    hash = (((hash << 5) + hash) ^ userId.charCodeAt(i)) >>> 0;
  }
  let code = "";
  let n = hash;
  for (let i = 0; i < 6; i++) {
    code += chars[n % chars.length];
    n = Math.floor(n / chars.length);
  }
  return code;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = RegisterSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 422 }
    );
  }

  const { phone, ownerName, businessName, category, location, preferredLanguage, pin, referralCode } = parsed.data;

  // Rate-limit: max 5 registration attempts per phone per hour
  const { allowed } = rateLimit(`register:${phone}`, 5, 60 * 60 * 1000);
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many registration attempts. Please wait an hour and try again." },
      { status: 429 }
    );
  }

  // Hoist uid so the catch block can clean it up if the Firestore write fails
  // after the Firebase Auth user has already been created.
  let uid: string | undefined;

  try {
    const db   = getAdminDb();
    const auth = getAdminAuth();

    // ── 1. Check phone isn't already registered ───────────────────────────────
    // Block on ANY existing Firestore doc for this phone — not just docs where
    // onboardingComplete is true. A partial registration (failed batch write)
    // would leave a doc without onboardingComplete, and allowing a second attempt
    // would create a second orphaned Firebase Auth user.
    const existing = await db
      .collection(collections.users)
      .where("phoneNumber", "==", phone)
      .limit(1)
      .get();

    if (!existing.empty) {
      const existingData = existing.docs[0].data();
      if (existingData.onboardingComplete === true) {
        return NextResponse.json(
          { error: "This phone number already has a ZURIA account. Please sign in." },
          { status: 409 }
        );
      }
      // Partial registration — clean up the stale Firestore doc so this attempt succeeds.
      // The corresponding Firebase Auth user (if any) cannot be retrieved by phone
      // since we don't store phone in Firebase Auth. The orphaned auth user is
      // harmless (it has no Firestore data and cannot sign in without a custom token).
      await existing.docs[0].ref.delete().catch(() => {});
    }

    // ── 2. Create Firebase Auth user ──────────────────────────────────────────
    // We don't store phone in Firebase Auth (avoids phone-verification requirements).
    // The phone is stored only in Firestore; we use custom tokens for auth.
    const userRecord = await auth.createUser({
      displayName: ownerName,
    });
    uid = userRecord.uid;

    // ── 3. Prepare Firestore documents ────────────────────────────────────────
    const now        = new Date().toISOString();
    const businessId = createId("business");
    const referralCode_ = generateReferralCode(uid);

    const businessDoc = {
      id:                businessId,
      ownerId:           uid,
      ownerName,
      name:              businessName,
      category,
      location,
      preferredLanguage,
      createdAt:         now,
      updatedAt:         now,
      serverCreatedAt:   FieldValue.serverTimestamp(),
    };

    const userDoc = {
      id:                uid,
      phoneNumber:       phone,
      ownerName,
      businessId,
      onboardingComplete: true,
      preferredLanguage,
      whatsappPin:       hashPin(pin),
      referralCode:      referralCode_,
      referralBalance:   0,
      referralCount:     0,
      subscriptionPlan:  "free",
      createdAt:         now,
      updatedAt:         now,
      serverUpdatedAt:   FieldValue.serverTimestamp(),
    };

    // ── 4. Write atomically ───────────────────────────────────────────────────
    const batch = db.batch();
    batch.set(db.collection(collections.businesses).doc(businessId), businessDoc);
    batch.set(db.collection(collections.users).doc(uid), userDoc);
    await batch.commit();

    // ── 5. Credit referrer (best-effort, non-blocking) ────────────────────────
    if (referralCode) {
      creditReferrerAsync(db, referralCode, uid, phone).catch((err) =>
        console.error("[register] referral credit failed:", err)
      );
    }

    // ── 6. Issue custom token for immediate sign-in ───────────────────────────
    const token = await auth.createCustomToken(uid, { phone });

    return NextResponse.json({
      ok:      true,
      token,
      userId:  uid,
      // Return user + business so the client can populate the Zustand store
      // immediately without waiting for a separate Firestore read.
      user: {
        id:                uid,
        phoneNumber:       phone,
        ownerName,
        businessId,
        onboardingComplete: true,
        preferredLanguage,
        referralCode:      referralCode_,
        referralBalance:   0,
        referralCount:     0,
        subscriptionPlan:  "free" as const,
        createdAt:         now,
        updatedAt:         now,
      },
      business: {
        id:       businessId,
        ownerId:  uid,
        ownerName,
        name:     businessName,
        category,
        location,
        preferredLanguage,
        createdAt: now,
        updatedAt: now,
      },
    });
  } catch (err: unknown) {
    // If the Firebase Auth user was already created but the Firestore batch write
    // failed, delete the orphaned auth record so the user can retry cleanly.
    if (uid) {
      getAdminAuth().deleteUser(uid).catch((cleanupErr) =>
        console.error("[register] failed to clean up orphaned auth user:", cleanupErr)
      );
    }

    const e = err as { code?: string; message?: string };
    // Firebase Auth error: user already exists (shouldn't happen but handle it)
    if (e.code === "auth/email-already-exists" || e.code === "auth/phone-number-already-exists") {
      return NextResponse.json(
        { error: "This phone number already has an account. Please sign in." },
        { status: 409 }
      );
    }
    console.error("[register]", err);
    return NextResponse.json({ error: "Registration failed. Please try again." }, { status: 500 });
  }
}

// ─── Async referral crediting ─────────────────────────────────────────────────

async function creditReferrerAsync(
  db: ReturnType<typeof getAdminDb>,
  refCode: string,
  refereeId: string,
  refereePhone: string
): Promise<void> {
  const REFERRAL_REWARD = 0.5;

  const snap = await db
    .collection(collections.users)
    .where("referralCode", "==", refCode)
    .limit(1)
    .get();

  if (snap.empty) return;
  const referrerDoc = snap.docs[0];
  const referrerId  = referrerDoc.id;
  if (referrerId === refereeId) return; // no self-referral

  const refDocId  = `${referrerId}_${refereeId}`;
  const refDocRef = db.collection(collections.referrals).doc(refDocId);
  const referrerRef = db.collection(collections.users).doc(referrerId);

  await db.runTransaction(async (tx) => {
    const refSnap = await tx.get(refDocRef);
    if (refSnap.exists) return; // already credited — idempotent

    const referrerSnap = await tx.get(referrerRef);
    const referrerData = referrerSnap.data() ?? {};

    const now        = new Date().toISOString();
    const thisMonth  = now.slice(0, 7);
    const storedKey  = (referrerData.referralMonthlyResetKey as string) ?? "";
    const oldMonthly = storedKey === thisMonth
      ? ((referrerData.referralMonthlyCount as number) ?? 0)
      : 0;

    tx.set(refDocRef, {
      id:           refDocId,
      referrerId,
      refereeId,
      refereePhone,
      amount:       REFERRAL_REWARD,
      createdAt:    now,
    });

    tx.update(referrerRef, {
      referralBalance:         FieldValue.increment(REFERRAL_REWARD),
      referralCount:           FieldValue.increment(1),
      referralMonthlyCount:    oldMonthly + 1,
      referralMonthlyResetKey: thisMonth,
      updatedAt:               now,
    });
  });
}
