/**
 * GET /api/cron/proactive-insights
 *
 * Vercel Cron: runs once daily (`0 7 * * *` in vercel.json — 7 AM UTC / ~8 AM Ghana).
 *
 * Generates and queues proactive insights for every active business.
 * Insights are written to Firestore `proactive_insights` collection.
 * A separate notification worker (or the next WhatsApp session) picks
 * them up and delivers them.
 *
 * Delivery is intentionally decoupled from generation: the cron only
 * creates the insight docs. The notification-worker handles sending.
 *
 * Auth: CRON_SECRET bearer token.
 */

import { NextResponse }              from "next/server";
import { getAdminDb }                from "@/lib/firebase/admin";
import { collections }               from "@/lib/firebase/collections";
import { generateProactiveInsights } from "@/lib/intelligence/proactive-engine";
import type { Transaction, Debt }    from "@/types/domain";
import { createLogger }              from "@/lib/observability/logger";

export const dynamic     = "force-dynamic";
export const maxDuration = 300;

const logger = createLogger("cron:proactive-insights");

export async function GET(req: Request) {
  if (
    req.headers.get("Authorization") !==
    `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = new Date().toISOString();
  logger.info("proactive-insights cron started");

  try {
    const db = getAdminDb();

    // ── 1. Active businesses (transactions in last 14 days) ───────────────────
    const cutoff = new Date(Date.now() - 14 * 86_400_000).toISOString();
    const txSnap = await db
      .collection(collections.transactions)
      .where("createdAt", ">=", cutoff)
      .select("businessId", "userId")
      .get();

    const businesses = new Map<string, string>(); // businessId → userId
    for (const doc of txSnap.docs) {
      const d = doc.data() as { businessId: string; userId: string };
      if (!businesses.has(d.businessId)) {
        businesses.set(d.businessId, d.userId);
      }
    }

    logger.info("active businesses for insights", { count: businesses.size });

    const stats = {
      total:          businesses.size,
      insightsQueued: 0,
      failed:         0,
    };

    // ── 2. Generate insights per business ─────────────────────────────────────
    for (const [businessId, userId] of businesses) {
      try {
        // Load 30 days of transactions + all debts
        const txWindow = new Date(Date.now() - 30 * 86_400_000).toISOString();
        const [bTxSnap, debtSnap] = await Promise.all([
          db
            .collection(collections.transactions)
            .where("businessId", "==", businessId)
            .where("createdAt", ">=", txWindow)
            .orderBy("createdAt", "desc")
            .limit(300)
            .get(),
          db
            .collection(collections.debts)
            .where("businessId", "==", businessId)
            .where("status", "==", "open")
            .limit(100)
            .get(),
        ]);

        const transactions = bTxSnap.docs.map(
          (d) => d.data() as Transaction,
        );
        const debts = debtSnap.docs.map((d) => d.data() as Debt);

        if (transactions.length < 5) continue; // too little data for insights

        const insights = await generateProactiveInsights(
          userId,
          businessId,
          transactions,
          debts,
        );

        stats.insightsQueued += insights.length;

        logger.info("insights queued", {
          businessId,
          count: insights.length,
          types: insights.map((i) => i.type),
        });
      } catch (err) {
        logger.warn("insights generation failed", {
          businessId,
          err: String(err),
        });
        stats.failed++;
      }
    }

    const result = {
      ranAt:       startedAt,
      completedAt: new Date().toISOString(),
      ...stats,
    };

    logger.info("proactive-insights cron completed", result);
    return NextResponse.json(result);
  } catch (err) {
    logger.error("proactive-insights cron fatal error", { err: String(err) });
    return NextResponse.json(
      { error: "Cron failed", detail: String(err) },
      { status: 500 },
    );
  }
}
