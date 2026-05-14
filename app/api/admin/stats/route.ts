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
    const [usersSnap, bizSnap, txnSnap] = await Promise.all([
      db.collection(collections.users).count().get(),
      db.collection(collections.businesses).count().get(),
      db.collection(collections.transactions).count().get(),
    ]);

    const [recentUsers, recentTxns, pendingWithdrawals, recentErrors] = await Promise.all([
      db.collection(collections.users).orderBy("createdAt", "desc").limit(20).get(),
      db.collection(collections.transactions).orderBy("createdAt", "desc").limit(30).get(),
      db.collection(collections.withdrawals).where("status", "==", "pending").orderBy("createdAt", "desc").get(),
      db.collection(collections.errors).orderBy("createdAt", "desc").limit(50).get(),
    ]);

    const users = recentUsers.docs.map((d) => {
      const data = d.data();
      // Mask phone numbers in admin responses to protect PII
      const rawPhone = (data.phoneNumber as string) ?? "";
      const maskedPhone = rawPhone.length > 6
        ? `${rawPhone.slice(0, rawPhone.length - 6)}****${rawPhone.slice(-2)}`
        : "****";
      return {
        id: d.id,
        ownerName: data.ownerName ?? "—",
        phoneNumber: maskedPhone,
        onboardingComplete: data.onboardingComplete ?? false,
        businessId: data.businessId ?? null,
        preferredLanguage: data.preferredLanguage ?? "english",
        subscriptionPlan: data.subscriptionPlan ?? "free",
        createdAt: data.createdAt?.toDate?.()?.toISOString() ?? data.createdAt ?? null,
      };
    });

    const transactions = recentTxns.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        businessId: data.businessId,
        type: data.type,
        amount: data.amount,
        rawText: data.rawText ?? "",
        source: data.source ?? "manual",
        createdAt: data.createdAt?.toDate?.()?.toISOString() ?? data.createdAt ?? null,
      };
    });

    const withdrawals = pendingWithdrawals.docs.map((d) => d.data());

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
      },
      users,
      transactions,
      withdrawals,
      errors,
    });
  } catch (err) {
    // Log full error server-side but never expose internal details to the client
    console.error("[admin/stats]", err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
