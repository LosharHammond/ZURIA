import { type NextRequest, NextResponse } from "next/server";
import { getAdminDb, verifyAdminToken } from "@/lib/firebase/admin";
import { collections } from "@/lib/firebase/collections";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const decoded = await verifyAdminToken(req.headers.get("Authorization"));
  if (!decoded) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  try {
    const db = getAdminDb();

    // ── Aggregate counts ──────────────────────────────────────────────────────
    const [usersSnap, bizSnap, txnSnap] = await Promise.all([
      db.collection(collections.users).count().get(),
      db.collection(collections.businesses).count().get(),
      db.collection(collections.transactions).count().get(),
    ]);

    // ── Plan breakdown — 4 parallel count queries ─────────────────────────────
    const [freePlanSnap, growthPlanSnap, proPlanSnap, enterprisePlanSnap] = await Promise.all([
      db.collection(collections.users).where("subscriptionPlan", "==", "free").count().get(),
      db.collection(collections.users).where("subscriptionPlan", "==", "growth").count().get(),
      db.collection(collections.users).where("subscriptionPlan", "==", "pro").count().get(),
      db.collection(collections.users).where("subscriptionPlan", "==", "enterprise").count().get(),
    ]);

    // ── Main data fetches ─────────────────────────────────────────────────────
    // Note: where() + orderBy() on different fields needs a composite index.
    // To avoid a hard dependency on Firestore index deployment, we fetch with
    // where() only and sort in JS (admin pages have ≤50 docs — cost is negligible).
    const [recentUsers, recentTxns, pendingWithdrawals, processingWithdrawals, pendingClaims, recentErrors] =
      await Promise.all([
        db.collection(collections.users).orderBy("createdAt", "desc").limit(30).get(),
        db.collection(collections.transactions).orderBy("createdAt", "desc").limit(30).get(),
        db.collection(collections.withdrawals).where("status", "==", "pending").get(),
        db.collection(collections.withdrawals).where("status", "==", "processing").get(),
        db.collection(collections.paymentClaims).where("status", "==", "pending").get(),
        db.collection(collections.errors).orderBy("createdAt", "desc").limit(50).get(),
      ]);

    // ── Revenue — count verified (paid) activation events ────────────────────
    // Only counts real paid activations (source !== "admin") to avoid counting
    // complimentary grants as revenue.
    let revenueGHS = 0;
    let revenueCount = 0;
    try {
      const revenueSnap = await db
        .collection(collections.paymentEvents)
        .where("eventType", "==", "SUBSCRIPTION_ACTIVATED")
        .where("source", "!=", "admin")
        .get();
      for (const doc of revenueSnap.docs) {
        const d = doc.data();
        revenueGHS += (d.amountGHS as number) ?? 0;
        revenueCount++;
      }
    } catch {
      // composite index may not exist yet — skip revenue stats gracefully
    }

    // ── Shape users ───────────────────────────────────────────────────────────
    const users = recentUsers.docs.map((d) => {
      const data = d.data();
      const rawPhone = (data.phoneNumber as string) ?? "";
      const maskedPhone =
        rawPhone.length > 6
          ? `${rawPhone.slice(0, rawPhone.length - 6)}****${rawPhone.slice(-2)}`
          : "****";
      return {
        id: d.id,
        ownerName: data.ownerName ?? "—",
        phoneNumber: maskedPhone,
        rawPhone,           // full phone for WhatsApp notify actions
        onboardingComplete: data.onboardingComplete ?? false,
        businessId: data.businessId ?? null,
        preferredLanguage: data.preferredLanguage ?? "english",
        subscriptionPlan: (data.subscriptionPlan as string) ?? "free",
        subscriptionExpiresAt: (data.subscriptionExpiresAt as string | null) ?? null,
        referralCode: (data.referralCode as string | null) ?? null,
        referralBalance: (data.referralBalance as number) ?? 0,
        referralCount: (data.referralCount as number) ?? 0,
        whatsappMessageCount: (data.whatsappMessageCount as number) ?? 0,
        createdAt: data.createdAt?.toDate?.()?.toISOString() ?? data.createdAt ?? null,
      };
    });

    // ── Shape transactions ────────────────────────────────────────────────────
    const transactions = recentTxns.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        businessId: data.businessId,
        type: data.type,
        amount: data.amount,
        rawText: data.rawText ?? "",
        customerName: data.customerName ?? null,
        productName: data.productName ?? null,
        source: data.source ?? "manual",
        confidence: data.confidence ?? null,
        createdAt: data.createdAt?.toDate?.()?.toISOString() ?? data.createdAt ?? null,
      };
    });

    // ── Shape withdrawals (sorted newest-first in JS) ─────────────────────────
    const allWithdrawals = [
      ...pendingWithdrawals.docs.map((d) => d.data()),
      ...processingWithdrawals.docs.map((d) => d.data()),
    ].sort((a, b) => {
      const aTs = a.createdAt?.toMillis?.() ?? 0;
      const bTs = b.createdAt?.toMillis?.() ?? 0;
      return bTs - aTs;
    });

    // ── Shape payment claims (sorted newest-first in JS) ──────────────────────
    const paymentClaims = pendingClaims.docs
      .map((d) => {
        const data = d.data();
        return {
          id: d.id,
          userId: data.userId ?? "",
          ownerName: data.ownerName ?? "—",
          phone: data.phone ?? "",
          plan: data.plan ?? "growth",
          annual: data.annual ?? false,
          amount: data.amount ?? 0,
          status: data.status ?? "pending",
          businessName: data.businessName ?? "",
          claimedAt: data.claimedAt ?? null,
        };
      })
      .sort((a, b) => {
        const aTs = typeof a.claimedAt === "string" ? new Date(a.claimedAt).getTime()
                  : (a.claimedAt as { toMillis?: () => number } | null)?.toMillis?.() ?? 0;
        const bTs = typeof b.claimedAt === "string" ? new Date(b.claimedAt).getTime()
                  : (b.claimedAt as { toMillis?: () => number } | null)?.toMillis?.() ?? 0;
        return bTs - aTs;
      });

    // ── Shape errors ──────────────────────────────────────────────────────────
    const errors = recentErrors.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        context: data.context ?? "unknown",
        message: data.message ?? "",
        phone: data.phone ?? null,
        severity: data.severity ?? "error",
        createdAt: data.createdAt?.toDate?.()?.toISOString() ?? data.createdAt ?? null,
      };
    });

    return NextResponse.json({
      totals: {
        users: usersSnap.data().count,
        businesses: bizSnap.data().count,
        transactions: txnSnap.data().count,
        revenueGHS,
        revenueCount,
      },
      planBreakdown: {
        free: freePlanSnap.data().count,
        growth: growthPlanSnap.data().count,
        pro: proPlanSnap.data().count,
        enterprise: enterprisePlanSnap.data().count,
      },
      users,
      transactions,
      withdrawals: allWithdrawals,
      paymentClaims,
      errors,
    });
  } catch (err) {
    console.error("[admin/stats]", err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
