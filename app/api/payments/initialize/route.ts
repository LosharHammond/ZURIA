import { NextResponse } from "next/server";
import { getAdminDb, verifyIdToken } from "@/lib/firebase/admin";
import { collections } from "@/lib/firebase/collections";
import { initializePayment } from "@/lib/services/paystack-service";
import type { SubscriptionPlan, PaystackPayment } from "@/types/domain";
import { SUBSCRIPTION_TIERS } from "@/types/domain";
import { APP_URL } from "@/lib/config";

export const dynamic = "force-dynamic";

/**
 * Compute the charge amount for a given plan and billing cycle.
 * Annual prices are sourced from SUBSCRIPTION_TIERS.annualPriceGHS — the
 * single canonical source shared with the UI — so what the user sees is
 * exactly what Paystack charges.
 */
function planPrice(plan: SubscriptionPlan, annual: boolean): number {
  const tier = SUBSCRIPTION_TIERS[plan];
  if (annual) {
    // Use the canonical annualPriceGHS. Fallback to 10× monthly only if not
    // defined (should never happen for paid plans, but guards against future additions).
    return tier.annualPriceGHS ?? Math.round(tier.priceGHS * 10 * 100) / 100;
  }
  return tier.priceGHS;
}

function generateReference(): string {
  const ts   = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `ZURIA-${ts}-${rand}`;
}

export async function POST(req: Request) {
  try {
    // ── Auth ──────────────────────────────────────────────────────────────────
    const decoded = await verifyIdToken(req.headers.get("authorization"));
    if (!decoded) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const uid = decoded.uid;

    // ── Parse body ────────────────────────────────────────────────────────────
    const body = await req.json();
    const plan   = body.plan   as SubscriptionPlan;
    const annual = Boolean(body.annual);

    if (!plan || !["growth", "pro", "enterprise"].includes(plan)) {
      return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
    }

    const amountGHS = planPrice(plan, annual);
    if (amountGHS <= 0) {
      return NextResponse.json({ error: "Free plan needs no payment" }, { status: 400 });
    }

    // ── Fetch user for phone + name ───────────────────────────────────────────
    const db       = getAdminDb();
    const userSnap = await db.collection(collections.users).doc(uid).get();
    const userData = userSnap.data() ?? {};
    const phone     = (userData.phoneNumber as string) ?? "";
    const ownerName = (userData.ownerName   as string) ?? "";

    // Paystack requires an email; we derive a dummy one from the phone
    const email     = `${phone.replace("+", "")}@zuria.app`;
    const reference = generateReference();
    const callbackUrl = `${APP_URL}/subscription/callback?ref=${reference}`;

    // ── Create Paystack checkout session ──────────────────────────────────────
    const result = await initializePayment({
      email,
      amountGHS,
      reference,
      callbackUrl,
      metadata: { userId: uid, phone, ownerName, plan, annual, amountGHS },
      label: ownerName || "ZURIA Customer",
    });

    if (result.error) {
      console.error("[payments/initialize] Paystack error:", result.error);
      return NextResponse.json(
        { error: "Payment provider error. Please try again." },
        { status: 502 }
      );
    }

    // ── Persist pending payment record ────────────────────────────────────────
    const paymentDoc: PaystackPayment = {
      id:               reference,
      reference,
      userId:           uid,
      phone,
      plan,
      annual,
      amountGHS,
      status:           "pending",
      authorizationUrl: result.authorizationUrl,
      accessCode:       result.accessCode,
      createdAt:        new Date().toISOString(),
    };

    await db
      .collection(collections.payments)
      .doc(reference)
      .set(paymentDoc);

    return NextResponse.json({
      authorizationUrl: result.authorizationUrl,
      reference,
    });
  } catch (err) {
    console.error("[payments/initialize]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
