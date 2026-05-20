/**
 * lib/confidence/calibration/index.ts
 *
 * Confidence calibration — tracks historical accuracy per confidence band
 * to detect systematic over/under confidence and apply corrections.
 *
 * Server-only: firebase-admin.
 */

import { getAdminDb } from "@/lib/firebase/admin";
import { collections } from "@/lib/firebase/collections";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CalibrationRecord {
  id: string;
  confidence: number;
  /** Band: "0-50", "50-75", "75-90", "90-100" */
  band: string;
  /** Did the AI or human accept this extraction as correct? */
  wasCorrect: boolean;
  transactionType: string;
  userId: string;
  businessId?: string;
  recordedAt: string;
}

export interface CalibrationStats {
  band: string;
  count: number;
  accuracyRate: number;
  avgConfidence: number;
  /** Calibration error: |predicted_confidence - actual_accuracy| */
  calibrationError: number;
}

// ─── Band Classification ──────────────────────────────────────────────────────

export function getConfidenceBand(confidence: number): string {
  if (confidence >= 0.90) return "90-100";
  if (confidence >= 0.75) return "75-90";
  if (confidence >= 0.50) return "50-75";
  return "0-50";
}

// ─── Record a calibration data point ─────────────────────────────────────────

/**
 * Record the outcome of a confidence prediction.
 * Called when a user accepts (wasCorrect=true) or corrects (wasCorrect=false)
 * a transaction.
 *
 * Fire-and-forget.
 */
export async function recordCalibrationOutcome(
  confidence: number,
  wasCorrect: boolean,
  transactionType: string,
  userId: string,
  businessId?: string,
): Promise<void> {
  try {
    const db   = getAdminDb();
    const ref  = db.collection(collections.parserBenchmarkLogs).doc();
    const band = getConfidenceBand(confidence);

    const record: CalibrationRecord = {
      id:              ref.id,
      confidence,
      band,
      wasCorrect,
      transactionType,
      userId,
      ...(businessId ? { businessId } : {}),
      recordedAt: new Date().toISOString(),
    };

    await ref.set(record);
  } catch {
    // Calibration logging is best-effort
  }
}

// ─── Read calibration stats ───────────────────────────────────────────────────

/**
 * Compute calibration statistics across all four confidence bands.
 * Returns null on error.
 */
export async function getCalibrationStats(): Promise<CalibrationStats[] | null> {
  try {
    const db   = getAdminDb();
    const snap = await db
      .collection(collections.parserBenchmarkLogs)
      .orderBy("recordedAt", "desc")
      .limit(5_000)
      .get();

    // Group by band
    const bands: Record<string, { totalCount: number; correctCount: number; sumConfidence: number }> = {};

    for (const doc of snap.docs) {
      const d    = doc.data() as CalibrationRecord;
      const band = d.band ?? getConfidenceBand(d.confidence);
      if (!bands[band]) bands[band] = { totalCount: 0, correctCount: 0, sumConfidence: 0 };
      bands[band].totalCount++;
      if (d.wasCorrect) bands[band].correctCount++;
      bands[band].sumConfidence += d.confidence;
    }

    const BAND_MIDPOINTS: Record<string, number> = {
      "0-50":    0.25,
      "50-75":   0.625,
      "75-90":   0.825,
      "90-100":  0.95,
    };

    return Object.entries(bands).map(([band, data]) => {
      const accuracyRate   = data.totalCount > 0 ? data.correctCount / data.totalCount : 0;
      const avgConfidence  = data.totalCount > 0 ? data.sumConfidence / data.totalCount : BAND_MIDPOINTS[band] ?? 0.5;
      const calibrationError = Math.abs(avgConfidence - accuracyRate);

      return {
        band,
        count:            data.totalCount,
        accuracyRate,
        avgConfidence,
        calibrationError,
      };
    }).sort((a, b) => {
      const order = ["0-50", "50-75", "75-90", "90-100"];
      return order.indexOf(a.band) - order.indexOf(b.band);
    });
  } catch {
    return null;
  }
}

/**
 * Get the calibration-adjusted confidence for a raw confidence score.
 *
 * If the model is systematically overconfident in a band, we nudge it down.
 * Returns the original score if calibration data is unavailable.
 */
export async function getCalibratedConfidence(rawConfidence: number): Promise<number> {
  try {
    const stats = await getCalibrationStats();
    if (!stats) return rawConfidence;

    const band      = getConfidenceBand(rawConfidence);
    const bandStats = stats.find((s) => s.band === band);
    if (!bandStats || bandStats.count < 50) return rawConfidence; // insufficient data

    // Simple Platt scaling approximation: blend raw confidence with empirical accuracy
    const alpha       = Math.min(1, bandStats.count / 500); // trust calibration more with more data
    const calibrated  = (1 - alpha) * rawConfidence + alpha * bandStats.accuracyRate;
    return Math.max(0, Math.min(1, calibrated));
  } catch {
    return rawConfidence;
  }
}
