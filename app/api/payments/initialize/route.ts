import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getAdminDb, verifyIdToken } from "@/lib/firebase/admin";
import { collections } from "@/lib/firebase/collections";
import { initializePayment } from "@/lib/services/paystack-service";
import type { SubscriptionPlan, PaystackPayment, PaymentLedgerEntry } from "@/types/domain";
import { SUBSCRIPTION_TIERS } from "@/types/domain";
import { APP_URL } from "@/lib/config";
import { getEffectivePlan } from "@/lib/subscription";
import { rateLimit } from "@/lib/rate-limit";

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
  const rand = randomBytes(4).toString("hex").toUpperCase();
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

    // ── Rate limit: 10 payment initiations per hour per user ─────────────────
    const { allowed } = rateLimit(`payment-init:${uid}`, 10, 60 * 60 * 1000);
    if (!allowed) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

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

    // ── Duplicate-payment guard ───────────────────────────────────────────────
    // Reject if the user already has an active subscription at or above the
    // requested plan tier. Two valid payments with different Paystack references
    // would both activate the subscription, effectively charging the user twice.
    const effectivePlan = getEffectivePlan({
      subscriptionPlan:       userData.subscriptionPlan,
      subscriptionExpiresAt:  userData.subscriptionExpiresAt,
      referralUnlockExpiresAt: userData.referralUnlockExpiresAt,
    });
    const PLAN_RANK: Record<string, number> = { free: 0, growth: 1, pro: 2, enterprise: 3 };
    if (effectivePlan !== "free" && (PLAN_RANK[effectivePlan] ?? 0) >= (PLAN_RANK[plan] ?? 0)) {
      return NextResponse.json(
        { error: "You already have an active subscription. Visit the app to manage it." },
        { status: 409 }
      );
    }
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

    // ── Persist pending payment record + PAYMENT_INITIATED ledger entry ─────
    // Both writes are in the same batch so they succeed or fail together.
    // The ledger entry is immutable — never updated, even if payment fails.
    const now        = new Date().toISOString();
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
      createdAt:        now,
    };

    const initiatedLedgerId = `${reference}_PAYMENT_INITIATED`;
    const ledgerEntry: PaymentLedgerEntry = {
      id:               initiatedLedgerId,
      paystackReference: reference,
      userId:           uid,
      plan,
      annual,
      amountGHS,
      currency:         "GHS",
      eventType:        "PAYMENT_INITIATED",
      status:           "pending",
      source:           "system",
      idempotencyKey:   initiatedLedgerId,
      createdAt:        now,
      _immutable:       true,
    };

    const batch = db.batch();
    batch.set(db.collection(collections.payments).doc(reference), paymentDoc);
    batch.set(db.collection(collections.paymentEvents).doc(initiatedLedgerId), ledgerEntry);
    await batch.commit();

    return NextResponse.json({
      authorizationUrl: result.authorizationUrl,
      reference,
    });
  } catch (err) {
    console.error("[payments/initialize]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
