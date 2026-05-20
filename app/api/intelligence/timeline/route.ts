/**
 * GET /api/intelligence/timeline?businessId=X&days=30
 *
 * Returns the business timeline events for a given businessId.
 * Reads from Firestore `business_timeline` collection (written by
 * refreshTimeline cron and after each transaction).
 *
 * If no persisted events exist, falls back to computing them live
 * from the last 30 days of transactions (lightweight, no AI cost).
 *
 * Auth: Firebase ID token (Authorization: Bearer <token>)
 */

import { NextResponse }           from "next/server";
import { verifyIdToken, getAdminDb } from "@/lib/firebase/admin";
import { collections }            from "@/lib/firebase/collections";
import {
  getBusinessTimeline,
  buildTimelineFromTransactions,
  refreshTimeline,
} from "@/lib/timeline";
import type { Transaction, Debt } from "@/types/domain";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const decoded = await verifyIdToken(req.headers.get("Authorization"));
  if (!decoded) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url        = new URL(req.url);
  const businessId = url.searchParams.get("businessId") ?? "";
  const daysParam  = parseInt(url.searchParams.get("days") ?? "30", 10);
  const days       = Math.min(Math.max(daysParam, 7), 90);

  if (!businessId) {
    return NextResponse.json(
      { error: "businessId is required" },
      { status: 400 },
    );
  }

  // ── Verify ownership ──────────────────────────────────────────────────────
  const db = getAdminDb();
  const businessSnap = await db
    .collection(collections.businesses)
    .doc(businessId)
    .get();

  if (!businessSnap.exists) {
    return NextResponse.json({ error: "Business not found" }, { status: 404 });
  }

  const businessData = businessSnap.data() as { userId: string };
  if (businessData.userId !== decoded.uid) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // ── Read persisted timeline ───────────────────────────────────────────────
  let events = await getBusinessTimeline(businessId, days);

  // ── Live fallback if no persisted events ─────────────────────────────────
  if (events.length === 0) {
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    const [txSnap, debtSnap] = await Promise.all([
      db
        .collection(collections.transactions)
        .where("businessId", "==", businessId)
        .where("createdAt", ">=", cutoff)
        .orderBy("createdAt", "desc")
        .limit(300)
        .get(),
      db
        .collection(collections.debts)
        .where("businessId", "==", businessId)
        .limit(100)
        .get(),
    ]);

    const transactions = txSnap.docs.map((d) => d.data() as Transaction);
    const debts        = debtSnap.docs.map((d) => d.data() as Debt);

    if (transactions.length > 0) {
      const avgDailyRevenue =
        transactions
          .filter((t) => t.type === "sale" || t.type === "repayment")
          .reduce((s, t) => s + t.amount, 0) / days;

      events = buildTimelineFromTransactions(
        decoded.uid,
        businessId,
        transactions,
        debts,
        avgDailyRevenue,
      );

      // Persist for next time — fire-and-forget
      void refreshTimeline(
        decoded.uid,
        businessId,
        transactions,
        debts,
        avgDailyRevenue,
      );
    }
  }

  return NextResponse.json(events);
}
