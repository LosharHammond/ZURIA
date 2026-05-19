/**
 * lib/ai/evals/index.ts
 *
 * AI Evaluation Framework.
 *
 * Tracks AI quality metrics over time to detect hallucinations,
 * accuracy drift, and model degradation before users notice.
 *
 * "Without this, AI quality silently degrades."
 *
 * Server-only.
 */

import { getAdminDb } from "@/lib/firebase/admin";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AIEvalRecord {
  id: string;
  userId: string;
  model: "fast" | "advanced" | "guard";
  routingPath: string;

  // Parser vs AI comparison
  parserType: string;
  parserAmount: number;
  parserConfidence: number;
  aiType: string | null;
  aiAmount: number | null;

  // Quality signals
  divergedFromParser: boolean;
  userCorrected: boolean;        // Did user correct the AI output?
  correctionType?: string;       // What was corrected
  userAccepted: boolean;         // Did user confirm the output?

  // Performance
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;

  // Outcome
  wasHallucination: boolean;    // AI invented data not in input
  wasUseful: boolean;           // AI improved on parser result

  timestamp: string;
}

export interface AIQualityReport {
  periodDays: number;
  totalEvals: number;

  // Accuracy
  parserAccuracyRate: number;    // % evals where parser was correct
  aiAccuracyRate: number;        // % evals where AI matched accepted result
  divergenceRate: number;        // % where AI diverged from parser
  hallucinationRate: number;     // % where AI invented data

  // Usefulness
  aiUsefulRate: number;          // % where AI genuinely improved result
  userAcceptanceRate: number;    // % user accepted without correction
  userCorrectionRate: number;    // % user corrected

  // Performance
  avgLatencyMs: number;

  // Model breakdown
  byModel: Record<string, { evals: number; accuracy: number; avgLatency: number }>;

  // Trend
  qualityTrend: "improving" | "stable" | "degrading";
  alerts: string[];              // e.g. ["Hallucination rate above 10%"]
  generatedAt: string;
}

// ─── recordEval ───────────────────────────────────────────────────────────────

/**
 * Fire-and-forget write to Firestore `ai_evals` collection.
 * Never throws — all errors are swallowed to protect the hot path.
 */
export async function recordEval(
  record: Omit<AIEvalRecord, "id" | "timestamp">,
): Promise<void> {
  try {
    const db = getAdminDb();
    const timestamp = new Date().toISOString();
    await db.collection("ai_evals").add({ ...record, timestamp });
  } catch {
    // Intentionally swallowed — eval logging must never break the app
  }
}

// ─── generateQualityReport ────────────────────────────────────────────────────

function zeroReport(days: number): AIQualityReport {
  return {
    periodDays: days,
    totalEvals: 0,
    parserAccuracyRate: 0,
    aiAccuracyRate: 0,
    divergenceRate: 0,
    hallucinationRate: 0,
    aiUsefulRate: 0,
    userAcceptanceRate: 0,
    userCorrectionRate: 0,
    avgLatencyMs: 0,
    byModel: {},
    qualityTrend: "stable",
    alerts: [],
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Reads evals from Firestore for the last N days, computes all metrics.
 * Returns a zero-filled report on error.
 */
export async function generateQualityReport(
  userId: string,
  days = 7,
): Promise<AIQualityReport> {
  try {
    const db = getAdminDb();
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const snap = await db
      .collection("ai_evals")
      .where("userId", "==", userId)
      .where("timestamp", ">=", since)
      .orderBy("timestamp", "desc")
      .get();

    if (snap.empty) return zeroReport(days);

    const evals = snap.docs.map((d) => d.data() as Omit<AIEvalRecord, "id">);
    const total = evals.length;

    // Accuracy
    const diverged = evals.filter((e) => e.divergedFromParser).length;
    const hallucinations = evals.filter((e) => e.wasHallucination).length;
    const aiAccepted = evals.filter((e) => e.userAccepted && !e.userCorrected).length;
    const parserCorrect = evals.filter((e) => !e.divergedFromParser && e.userAccepted).length;

    // Usefulness
    const useful = evals.filter((e) => e.wasUseful).length;
    const corrected = evals.filter((e) => e.userCorrected).length;
    const accepted = evals.filter((e) => e.userAccepted).length;

    // Performance
    const totalLatency = evals.reduce((sum, e) => sum + (e.latencyMs ?? 0), 0);

    // Model breakdown
    const byModel: Record<string, { evals: number; accuracy: number; avgLatency: number }> = {};
    for (const e of evals) {
      const m = e.model ?? "unknown";
      if (!byModel[m]) byModel[m] = { evals: 0, accuracy: 0, avgLatency: 0 };
      byModel[m].evals += 1;
      byModel[m].avgLatency += e.latencyMs ?? 0;
      if (e.userAccepted && !e.userCorrected) byModel[m].accuracy += 1;
    }
    for (const key of Object.keys(byModel)) {
      const entry = byModel[key];
      entry.accuracy = entry.evals > 0 ? entry.accuracy / entry.evals : 0;
      entry.avgLatency = entry.evals > 0 ? entry.avgLatency / entry.evals : 0;
    }

    const hallucinationRate = total > 0 ? hallucinations / total : 0;
    const divergenceRate = total > 0 ? diverged / total : 0;
    const aiAccuracyRate = total > 0 ? aiAccepted / total : 0;

    // Trend heuristic: compare hallucination rate against basic thresholds
    let qualityTrend: "improving" | "stable" | "degrading" = "stable";
    if (hallucinationRate > 0.15 || divergenceRate > 0.40) {
      qualityTrend = "degrading";
    } else if (hallucinationRate < 0.03 && aiAccuracyRate > 0.85) {
      qualityTrend = "improving";
    }

    // Alerts
    const alerts: string[] = [];
    if (hallucinationRate > 0.10) {
      alerts.push(`Hallucination rate above 10% (${(hallucinationRate * 100).toFixed(1)}%)`);
    }
    if (divergenceRate > 0.30) {
      alerts.push(`AI divergence from parser above 30% (${(divergenceRate * 100).toFixed(1)}%)`);
    }
    if (total > 0 && corrected / total > 0.25) {
      alerts.push(`User correction rate above 25% (${((corrected / total) * 100).toFixed(1)}%)`);
    }
    if (total > 0 && totalLatency / total > 5000) {
      alerts.push(`Average AI latency above 5s (${(totalLatency / total).toFixed(0)}ms)`);
    }

    return {
      periodDays: days,
      totalEvals: total,
      parserAccuracyRate: total > 0 ? parserCorrect / total : 0,
      aiAccuracyRate,
      divergenceRate,
      hallucinationRate,
      aiUsefulRate: total > 0 ? useful / total : 0,
      userAcceptanceRate: total > 0 ? accepted / total : 0,
      userCorrectionRate: total > 0 ? corrected / total : 0,
      avgLatencyMs: total > 0 ? totalLatency / total : 0,
      byModel,
      qualityTrend,
      alerts,
      generatedAt: new Date().toISOString(),
    };
  } catch {
    return zeroReport(days);
  }
}

// ─── detectHallucination ──────────────────────────────────────────────────────

/**
 * Heuristic hallucination detector.
 *
 * Returns true if:
 *  1. AI response contains a number that differs from parserAmount by >50%
 *     AND that number was not present in the original input text, OR
 *  2. AI response contains names/entities not in the input when the input
 *     itself has no names (i.e. AI invented people out of thin air).
 */
export function detectHallucination(
  aiResponse: string,
  originalInput: string,
  parserAmount: number,
): boolean {
  // Extract all numbers from AI response
  const aiNumbers = [...aiResponse.matchAll(/\d+(?:[.,]\d+)*/g)].map((m) =>
    parseFloat(m[0].replace(",", "")),
  );

  for (const num of aiNumbers) {
    if (parserAmount === 0) continue;
    const pctDiff = Math.abs(num - parserAmount) / Math.abs(parserAmount);
    if (pctDiff > 0.5) {
      // Check whether this number appeared in original input
      const numStr = String(Math.round(num));
      if (!originalInput.includes(numStr)) {
        return true;
      }
    }
  }

  // Name/entity check: if input has no proper names but AI response does
  const inputHasNames = /\b[A-Z][a-z]{2,}\b/.test(originalInput);
  if (!inputHasNames) {
    // Look for capitalized words in AI response that aren't at sentence start
    const aiNames = aiResponse.match(/(?<![.!?]\s)(?<!\A)\b[A-Z][a-z]{2,}\b/g) ?? [];
    // Filter out common non-name capitalized words
    const excluded = new Set([
      "The", "This", "That", "Your", "You", "We", "Our", "I", "It",
      "GH", "Ghana", "GHC", "Cedis", "Total", "Sales", "Revenue",
    ]);
    const suspiciousNames = aiNames.filter((n) => !excluded.has(n));
    if (suspiciousNames.length > 0) {
      return true;
    }
  }

  return false;
}

// ─── assessAIUsefulness ───────────────────────────────────────────────────────

/**
 * AI was useful if:
 *   - Parser confidence was below 0.60 (parser was struggling), AND
 *   - Either the AI agreed with the parser (didn't diverge) OR the user accepted the AI output.
 *
 * The idea: AI adds genuine value when parser struggled and the output was accepted.
 */
export function assessAIUsefulness(
  parserConfidence: number,
  divergedFromParser: boolean,
  userAccepted: boolean,
): boolean {
  const parserWasStruggling = parserConfidence < 0.60;
  const outputWasAccepted = !divergedFromParser || userAccepted;
  return parserWasStruggling && outputWasAccepted;
}
