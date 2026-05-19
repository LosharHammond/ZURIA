// Parser benchmarking — tracks extraction precision, recall, and accuracy over time

import { getAdminDb } from "@/lib/firebase/admin";

// ─── Interfaces ───────────────────────────────────────────────────────────────

/**
 * A single benchmark observation for the transaction parser.
 */
export interface ParserBenchmarkEntry {
  id: string;
  userId: string;
  rawInput: string;
  expectedType: string | null;
  predictedType: string;
  expectedAmount: number | null;
  predictedAmount: number;
  confidence: number;
  /** True when both type and amount are correct */
  correct: boolean;
  typeCorrect: boolean;
  amountCorrect: boolean;
  /** True when the AI override disagrees with the deterministic parser */
  divergedFromAI: boolean;
  language: string;
  timestamp: string;
}

/**
 * Aggregated quality metrics computed from a set of benchmark entries.
 */
export interface ParserQualityReport {
  totalSamples: number;
  precision: number;
  recall: number;
  f1: number;
  averageConfidence: number;
  typeAccuracy: number;
  amountAccuracy: number;
  divergenceRate: number;
  byLanguage: Record<string, { samples: number; accuracy: number }>;
  generatedAt: string;
}

// ─── recordBenchmarkEntry ─────────────────────────────────────────────────────

/**
 * Fire-and-forget — writes a benchmark entry to Firestore.
 * Never throws; errors are silently swallowed.
 *
 * @param entry  The benchmark observation (without id and timestamp).
 */
export async function recordBenchmarkEntry(
  entry: Omit<ParserBenchmarkEntry, "id" | "timestamp">,
): Promise<void> {
  try {
    const db = getAdminDb();
    const docRef = db.collection("parser_benchmark_logs").doc();
    const fullEntry: ParserBenchmarkEntry = {
      ...entry,
      id: docRef.id,
      timestamp: new Date().toISOString(),
    };
    await docRef.set(fullEntry);
  } catch {
    // Intentionally silent
  }
}

// ─── generateQualityReport ────────────────────────────────────────────────────

/** A zero-filled report returned when there is no data or on any error. */
function emptyReport(): ParserQualityReport {
  return {
    totalSamples: 0,
    precision: 0,
    recall: 0,
    f1: 0,
    averageConfidence: 0,
    typeAccuracy: 0,
    amountAccuracy: 0,
    divergenceRate: 0,
    byLanguage: {},
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Read the last `days` days of benchmark entries for `userId` from Firestore
 * and compute an aggregated quality report.
 *
 * Returns a zero-filled report on any error or when there are no entries.
 *
 * @param userId  The business/user ID to scope the query.
 * @param days    Number of days of history to include (default: 7).
 */
export async function generateQualityReport(
  userId: string,
  days = 7,
): Promise<ParserQualityReport> {
  try {
    const db = getAdminDb();
    const since = new Date(
      Date.now() - days * 24 * 60 * 60 * 1000,
    ).toISOString();

    const snap = await db
      .collection("parser_benchmark_logs")
      .where("userId", "==", userId)
      .where("timestamp", ">=", since)
      .orderBy("timestamp", "desc")
      .limit(1000)
      .get();

    if (snap.empty) return emptyReport();

    const entries = snap.docs.map((d) => d.data() as ParserBenchmarkEntry);
    const total = entries.length;

    // ── Accuracy metrics ───────────────────────────────────────────────────
    const typeCorrectCount = entries.filter((e) => e.typeCorrect).length;
    const amountCorrectCount = entries.filter((e) => e.amountCorrect).length;
    const correctCount = entries.filter((e) => e.correct).length;
    const divergedCount = entries.filter((e) => e.divergedFromAI).length;

    const typeAccuracy = total > 0 ? typeCorrectCount / total : 0;
    const amountAccuracy = total > 0 ? amountCorrectCount / total : 0;
    const divergenceRate = total > 0 ? divergedCount / total : 0;

    // ── Precision & recall (using type classification as the positive case) ─
    // True Positives: predicted type matches expected type and expected is non-null
    const tp = entries.filter(
      (e) => e.expectedType !== null && e.typeCorrect,
    ).length;
    // False Positives: predicted a type but it was wrong
    const fp = entries.filter(
      (e) => e.expectedType !== null && !e.typeCorrect,
    ).length;
    // False Negatives: expected type was null but parser predicted something
    // (treated as parser hallucinating a type)
    const fn = entries.filter(
      (e) => e.expectedType === null,
    ).length;

    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1 = computeF1(precision, recall);

    // ── Average confidence ─────────────────────────────────────────────────
    const totalConfidence = entries.reduce((acc, e) => acc + e.confidence, 0);
    const averageConfidence = total > 0 ? totalConfidence / total : 0;

    // ── Per-language breakdown ─────────────────────────────────────────────
    const langMap = new Map<string, { samples: number; correct: number }>();
    for (const e of entries) {
      const lang = e.language || "unknown";
      const existing = langMap.get(lang) ?? { samples: 0, correct: 0 };
      langMap.set(lang, {
        samples: existing.samples + 1,
        correct: existing.correct + (e.correct ? 1 : 0),
      });
    }

    const byLanguage: Record<string, { samples: number; accuracy: number }> = {};
    for (const [lang, stats] of langMap.entries()) {
      byLanguage[lang] = {
        samples: stats.samples,
        accuracy: stats.samples > 0 ? stats.correct / stats.samples : 0,
      };
    }

    // correctCount is intentionally unused in the returned report (it would
    // equal typeCorrectCount && amountCorrectCount combined); kept for
    // potential future "fully correct" metric.
    void correctCount;

    return {
      totalSamples: total,
      precision: Math.round(precision * 10000) / 10000,
      recall: Math.round(recall * 10000) / 10000,
      f1: Math.round(f1 * 10000) / 10000,
      averageConfidence: Math.round(averageConfidence * 10000) / 10000,
      typeAccuracy: Math.round(typeAccuracy * 10000) / 10000,
      amountAccuracy: Math.round(amountAccuracy * 10000) / 10000,
      divergenceRate: Math.round(divergenceRate * 10000) / 10000,
      byLanguage,
      generatedAt: new Date().toISOString(),
    };
  } catch {
    return emptyReport();
  }
}

// ─── computeF1 ───────────────────────────────────────────────────────────────

/**
 * Compute the F1 score from precision and recall.
 *
 * Returns 0 when both precision and recall are 0 (avoids division by zero).
 *
 * @param precision  Precision value in [0, 1].
 * @param recall     Recall value in [0, 1].
 * @returns F1 score in [0, 1].
 */
export function computeF1(precision: number, recall: number): number {
  const denom = precision + recall;
  if (denom === 0) return 0;
  return (2 * precision * recall) / denom;
}
