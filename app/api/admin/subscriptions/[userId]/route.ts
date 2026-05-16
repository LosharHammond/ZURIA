import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyAdminToken, getAdminDb } from "@/lib/firebase/admin";
import { sendText } from "@/lib/whatsapp/client";
import { collections } from "@/lib/firebase/collections";
import { fmtSubscriptionActivated } from "@/lib/whatsapp/formatter";
import type { PaymentLedgerEntry } from "@/types/domain";

export const dynamic = "force-dynamic";

const ActivateSchema = z.object({
  plan:         z.enum(["growth", "pro", "enterprise"]),
  durationDays: z.number().int().min(1).max(3650).optional().default(30),
  claimId:      z.string().max(80).optional(),
});

// PATCH /api/admin/subscriptions/[userId]
// Body: { plan: "growth" | "pro" | "enterprise", durationDays?: number }
// durationDays defaults to 30 (monthly). Use 365 for annual subscriptions.
// Activates or renews a user's subscription and notifies them via WhatsApp.

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const decoded = await verifyAdminToken(req.headers.get("Authorization"));
  if (!decoded) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { userId } = await params;

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = ActivateSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 422 }
    );
  }

  const { plan, durationDays, claimId } = parsed.data;

  const db = getAdminDb();
  const userRef = db.collection(collections.users).doc(userId);
  const userSnap = await userRef.get();

  if (!userSnap.exists) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const userData = userSnap.data()!;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000).toISOString();

  // Reset message counter so the newly subscribed user isn't immediately blocked
  const resetKey = plan === "growth"
    ? now.toISOString().slice(0, 7)   // YYYY-MM (monthly)
    : now.toISOString().slice(0, 10); // YYYY-MM-DD (daily — shouldn't matter for pro/enterprise)

  // Write user update and immutable SUBSCRIPTION_ACTIVATED ledger entry atomically.
  // Admin grants have no Paystack reference — a synthetic reference encodes the
  // granting context so the ledger entry is traceable to this request.
  const syntheticRef    = `admin_${userId}_${now.getTime()}`;
  const ledgerId        = `${syntheticRef}_SUBSCRIPTION_ACTIVATED`;
  const adminBatch      = db.batch();
  adminBatch.update(userRef, {
    subscriptionPlan:        plan,
    subscriptionExpiresAt:   expiresAt,
    whatsappMessageCount:    0,
    whatsappMessageResetKey: resetKey,
    updatedAt:               now.toISOString(),
  });
  adminBatch.set(db.collection(collections.paymentEvents).doc(ledgerId), {
    id:               ledgerId,
    paystackReference: syntheticRef,
    userId,
    plan,
    annual:           durationDays === 365,
    amountGHS:        0, // admin grants are complimentary
    currency:         "GHS",
    eventType:        "SUBSCRIPTION_ACTIVATED",
    status:           "success",
    source:           "admin",
    subscriptionExpiresAt: expiresAt,
    idempotencyKey:   ledgerId,
    createdAt:        now.toISOString(),
    _immutable:       true,
  } as PaymentLedgerEntry);
  await adminBatch.commit();

  // ── Mark the payment claim as verified (idempotency guard) ─────────────────
  // If claimId was passed in the request body, mark it verified.
  // Also scan for any pending claims for this user + plan and verify them,
  // so re-activations don't leave orphaned "pending" claims in the DB.
  const verifyClaimPromises: Promise<unknown>[] = [];
  if (claimId) {
    verifyClaimPromises.push(
      db.collection(collections.paymentClaims).doc(claimId).update({
        status: "verified",
        verifiedAt: now.toISOString(),
        verifiedBy: decoded.uid,
      }).catch(() => {})
    );
  }
  // Also close any other pending claims for this user + plan (handles manual activations)
  const pendingClaimsSnap = await db
    .collection(collections.paymentClaims)
    .where("userId", "==", userId)
    .where("plan", "==", plan)
    .where("status", "==", "pending")
    .get();
  pendingClaimsSnap.docs.forEach((doc) => {
    if (doc.id !== claimId) {
      verifyClaimPromises.push(
        doc.ref.update({
          status: "verified",
          verifiedAt: now.toISOString(),
          verifiedBy: decoded.uid,
        }).catch(() => {})
      );
    }
  });
  if (verifyClaimPromises.length > 0) await Promise.allSettled(verifyClaimPromises);

  // ── Notify user on WhatsApp ───────────────────────────────────────────────
  const userPhone = userData.phoneNumber as string;
  const businessId = userData.businessId as string | undefined;
  let businessName = "Your Business";

  if (businessId) {
    const bizSnap = await db.collection(collections.businesses).doc(businessId).get();
    if (bizSnap.exists) businessName = (bizSnap.data()?.name as string) ?? businessName;
  }

  if (userPhone) {
    sendText(
      `whatsapp:${userPhone}`,
      fmtSubscriptionActivated(plan, expiresAt, businessName)
    ).catch(() => {});
  }

  return NextResponse.json({ ok: true, plan, expiresAt, userId });
}

// GET /api/admin/subscriptions/[userId] — view a user's current subscription
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const decoded = await verifyAdminToken(req.headers.get("Authorization"));
  if (!decoded) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { userId } = await params;
  const db = getAdminDb();
  const userSnap = await db.collection(collections.users).doc(userId).get();

  if (!userSnap.exists) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const d = userSnap.data()!;
  return NextResponse.json({
    userId,
    subscriptionPlan: d.subscriptionPlan ?? "free",
    subscriptionExpiresAt: d.subscriptionExpiresAt ?? null,
    whatsappMessageCount: d.whatsappMessageCount ?? 0,
    whatsappMessageResetKey: d.whatsappMessageResetKey ?? null,
  });
}
