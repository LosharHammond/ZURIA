/**
 * lib/business-intelligence/index.ts
 *
 * Business Intelligence Engine — main facade.
 *
 * Orchestrates business fingerprinting, archetype classification,
 * trend analysis, seasonal intelligence, and operational rhythm.
 *
 * This is ZURIA's core moat: moving from transaction memory
 * to genuine business understanding.
 *
 * Server-only.
 */

import { getAdminDb } from "@/lib/firebase/admin";
import { collections } from "@/lib/firebase/collections";
import type { Transaction, Debt } from "@/types/domain";
import type { BusinessProfile } from "@/lib/memory/operational-memory";
import { buildBusinessProfile } from "@/lib/memory/operational-memory";

import { buildFingerprint, detectTransactionAnomaly } from "./fingerprint";
import type { BusinessFingerprint } from "./fingerprint";

import { classifyArchetype, getArchetypeRecommendations } from "./archetypes";
import type { ArchetypeProfile } from "./archetypes";

import { buildBusinessTrends } from "./trends";
import type { BusinessTrends } from "./trends";

import { analyzeSeasonalPatterns } from "./seasonal";
import type { SeasonalPattern } from "./seasonal";

import { analyzeOperationalRhythm } from "./rhythm";
import type { OperationalRhythm } from "./rhythm";

// ─── Re-exports ───────────────────────────────────────────────────────────────

export type { BusinessArchetype, ArchetypeProfile } from "./archetypes";
export { classifyArchetype, getArchetypeRecommendations, describeArchetype } from "./archetypes";

export type { SeasonalPattern } from "./seasonal";
export { analyzeSeasonalPatterns, predictNextWeekRevenue, isCurrentlyInSlowPeriod } from "./seasonal";

export type { TrendSignal, BusinessTrends } from "./trends";
export { computeTrend, buildBusinessTrends } from "./trends";

export type { OperationalRhythm } from "./rhythm";
export { analyzeOperationalRhythm } from "./rhythm";

export type { BusinessFingerprint } from "./fingerprint";
export { buildFingerprint, detectTransactionAnomaly } from "./fingerprint";

export interface BusinessIntelligenceReport {
  businessId: string;
  userId: string;
  fingerprint: BusinessFingerprint;
  archetype: ArchetypeProfile;
  trends: BusinessTrends;
  seasonal: SeasonalPattern;
  rhythm: OperationalRhythm;
  keyInsights: string[];  // top 3 most actionable insights
  anomalies: string[];    // any detected anomalies
  generatedAt: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const BUSINESS_INTELLIGENCE_COLLECTION = "business_intelligence";
const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

// ─── Firestore helpers ────────────────────────────────────────────────────────

async function fetchTransactions(businessId: string): Promise<Transaction[]> {
  try {
    const db = getAdminDb();
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const snap = await db
      .collection(collections.transactions)
      .where("businessId", "==", businessId)
      .where("createdAt", ">=", cutoff)
      .orderBy("createdAt", "desc")
      .limit(300)
      .get();
    return snap.docs.map((d) => d.data() as Transaction);
  } catch {
    return [];
  }
}

async function fetchDebts(businessId: string): Promise<Debt[]> {
  try {
    const db = getAdminDb();
    const snap = await db
      .collection(collections.debts)
      .where("businessId", "==", businessId)
      .get();
    return snap.docs.map((d) => d.data() as Debt);
  } catch {
    return [];
  }
}

async function saveReport(report: BusinessIntelligenceReport): Promise<void> {
  try {
    const db = getAdminDb();
    await db
      .collection(BUSINESS_INTELLIGENCE_COLLECTION)
      .doc(report.businessId)
      .set(report, { merge: false });
  } catch {
    // silent — fire-and-forget
  }
}

// ─── Key insight assembly ─────────────────────────────────────────────────────

function assembleKeyInsights(
  report: Omit<BusinessIntelligenceReport, "keyInsights" | "anomalies" | "generatedAt">,
): string[] {
  const insights: string[] = [];

  // Most significant trend summary
  const trendSignals = [
    report.trends.revenue,
    report.trends.profit,
    report.trends.expenses,
    report.trends.debtExposure,
  ];

  const significantTrend = trendSignals
    .filter((s) => s.significance === "high")
    .sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent))[0];

  if (significantTrend) {
    insights.push(significantTrend.summary);
  }

  // Top archetype recommendation
  const recs = getArchetypeRecommendations(report.archetype.archetype);
  if (recs[0]) insights.push(recs[0]);

  // Seasonal peak insight
  if (report.seasonal.dayOfWeekPeaks.length > 0) {
    const peak = report.seasonal.dayOfWeekPeaks[0];
    if (peak && peak.avgRevenue > 0) {
      insights.push(
        `Your best revenue day is ${peak.label} — schedule restocks and staffing around it`,
      );
    }
  }

  // Rhythm insight
  if (report.rhythm.operationalDiscipline === "low") {
    insights.push(
      "Recording consistency is low — track transactions daily to unlock accurate insights",
    );
  }

  return insights.slice(0, 3);
}

// ─── Anomaly assembly ─────────────────────────────────────────────────────────

function assembleAnomalies(
  fingerprint: BusinessFingerprint,
  transactions: Transaction[],
): string[] {
  const anomalies: string[] = [];
  const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const recentTxns = transactions.filter((t) => t.createdAt >= cutoff24h);

  for (const t of recentTxns) {
    const { isAnomaly, reason } = detectTransactionAnomaly(t.amount, fingerprint);
    if (isAnomaly && reason) {
      anomalies.push(reason);
    }
  }

  return anomalies.slice(0, 5); // cap at 5 anomalies per report
}

// ─── generateBusinessIntelligence ─────────────────────────────────────────────

/**
 * Build a full BusinessIntelligenceReport from raw data.
 * Calls all sub-modules and assembles the report.
 */
export async function generateBusinessIntelligence(
  userId: string,
  businessId: string,
  transactions: Transaction[],
  debts: Debt[],
  profile: BusinessProfile,
): Promise<BusinessIntelligenceReport> {
  const generatedAt = new Date().toISOString();

  const fingerprint = buildFingerprint(businessId, transactions, debts);
  const archetype = classifyArchetype(profile);
  const trends = buildBusinessTrends(transactions, debts);
  const seasonal = analyzeSeasonalPatterns(transactions);
  const rhythm = analyzeOperationalRhythm(transactions);

  const partial = { businessId, userId, fingerprint, archetype, trends, seasonal, rhythm };

  const keyInsights = assembleKeyInsights(partial);
  const anomalies = assembleAnomalies(fingerprint, transactions);

  return {
    businessId,
    userId,
    fingerprint,
    archetype,
    trends,
    seasonal,
    rhythm,
    keyInsights,
    anomalies,
    generatedAt,
  };
}

// ─── getOrRefreshIntelligence ─────────────────────────────────────────────────

/**
 * Retrieve a cached BusinessIntelligenceReport from Firestore or build a fresh one.
 * Uses a 4-hour TTL. Always resolves — never throws to callers.
 */
export async function getOrRefreshIntelligence(
  userId: string,
  businessId: string,
): Promise<BusinessIntelligenceReport> {
  // Attempt to serve from cache
  try {
    const db = getAdminDb();
    const docRef = db.collection(BUSINESS_INTELLIGENCE_COLLECTION).doc(businessId);
    const snap = await docRef.get();

    if (snap.exists) {
      const cached = snap.data() as BusinessIntelligenceReport;
      const age = Date.now() - new Date(cached.generatedAt).getTime();
      if (age < CACHE_TTL_MS) return cached;
    }
  } catch {
    // fall through to fresh build
  }

  // Build fresh report
  const [transactions, debts, profile] = await Promise.all([
    fetchTransactions(businessId),
    fetchDebts(businessId),
    buildBusinessProfile(userId, businessId),
  ]);

  const report = await generateBusinessIntelligence(
    userId,
    businessId,
    transactions,
    debts,
    profile,
  );

  // Fire-and-forget persist
  saveReport(report).catch(() => undefined);

  return report;
}
