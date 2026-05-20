/**
 * GET /api/cron/business-dna
 *
 * Vercel Cron: runs once daily (`0 3 * * *` in vercel.json — 3 AM UTC).
 *
 * Refreshes Business DNA for every active business (any transaction in
 * the last 30 days). DNA reports are cached in Firestore `business_dna`
 * with a 20-hour TTL, but this cron forces a fresh build daily so that
 * morning sessions always have warm, up-to-date memory.
 *
 * Also triggers a timeline refresh for each active business.
 *
 * Auth: CRON_SECRET bearer token (same pattern as all other crons).
 */

import { NextResponse }      from "next/server";
import { getAdminDb }        from "@/lib/firebase/admin";
import { collections }       from "@/lib/firebase/collections";
import { buildBusinessDNA }  from "@/lib/intelligence/business-dna";
import { refreshTimeline }   from "@/lib/timeline";
import type { Transaction, Debt } from "@/types/domain";
import { createLogger }      from "@/lib/observability/logger";

export const dynamic     = "force-dynamic";
export const maxDuration = 300; // 5 min — processes up to ~500 businesses

const logger = createLogger("cron:business-dna");

export async function GET(req: Request) {
  if (
    req.headers.get("Authorization") !==
    `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = new Date().toISOString();
  logger.info("business-dna cron started");

  try {
    const db = getAdminDb();

    // ── 1. Find all active businesses (transactions in last 30 days) ──────────
    const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const txSnap = await db
      .collection(collections.transactions)
      .where("createdAt", ">=", cutoff)
      .select("businessId", "userId")
      .get();

    // Deduplicate business+user pairs
    const businesses = new Map<string, string>(); // businessId → userId
    for (const doc of txSnap.docs) {
      const { businessId, userId } = doc.data() as {
        businessId: string;
        userId: string;
      };
      if (!businesses.has(businessId)) {
        businesses.set(businessId, userId);
      }
    }

    logger.info("active businesses found", { count: businesses.size });

    const stats = {
      total:   businesses.size,
      success: 0,
      failed:  0,
      skipped: 0,
    };

    // ── 2. Refresh DNA for each business ──────────────────────────────────────
    for (const [businessId, userId] of businesses) {
      try {
        // Load transactions (last 90 days)
        const txWindow = new Date(Date.now() - 90 * 86_400_000).toISOString();
        const [bTxSnap, debtSnap] = await Promise.all([
          db
            .collection(collections.transactions)
            .where("businessId", "==", businessId)
            .where("createdAt", ">=", txWindow)
            .orderBy("createdAt", "desc")
            .limit(500)
            .get(),
          db
            .collection(collections.debts)
            .where("businessId", "==", businessId)
            .limit(200)
            .get(),
        ]);

        const transactions = bTxSnap.docs.map(
          (d) => d.data() as Transaction,
        );
        const debts = debtSnap.docs.map((d) => d.data() as Debt);

        if (transactions.length === 0) {
          stats.skipped++;
          continue;
        }

        // Build fresh DNA report
        const dna = buildBusinessDNA(userId, businessId, transactions, debts);

        // Force-write to Firestore (bypass TTL cache)
        await db
          .doc(`${collections.businessDna}/${businessId}`)
          .set(dna, { merge: false });

        // Also refresh timeline
        const avgDailyRevenue =
          transactions
            .filter((t) => t.type === "sale" || t.type === "repayment")
            .reduce((s, t) => s + t.amount, 0) / 90;

        await refreshTimeline(
          userId,
          businessId,
          transactions,
          debts,
          avgDailyRevenue,
        );

        stats.success++;
      } catch (err) {
        logger.warn("DNA refresh failed for business", {
          businessId,
          err: String(err),
        });
        stats.failed++;
      }
    }

    const result = {
      ranAt: startedAt,
      completedAt: new Date().toISOString(),
      ...stats,
    };

    // Write audit record
    await db.collection(collections.reconciliationRuns).add({
      type: "business_dna_refresh",
      ...result,
    });

    logger.info("business-dna cron completed", result);
    return NextResponse.json(result);
  } catch (err) {
    logger.error("business-dna cron fatal error", { err: String(err) });
    return NextResponse.json(
      { error: "Cron failed", detail: String(err) },
      { status: 500 },
    );
  }
}
