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
      return {
        id: d.id,
        ownerName: data.ownerName ?? "—",
        phoneNumber: data.phoneNumber ?? "—",
        onboardingComplete: data.onboardingComplete ?? false,
        businessId: data.businessId ?? null,
        preferredLanguage: data.preferredLanguage ?? "english",
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
    const message = err instanceof Error ? err.message : String(err);
    console.error("[admin/stats]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
