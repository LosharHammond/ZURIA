/**
 * lib/confidence/index.ts
 *
 * Main entry point for the ZURIA Confidence Engine.
 *
 * Exposes the complete 4-tier ensemble confidence system:
 *  - 90%+  → DETERMINISTIC_AUTO      (save immediately)
 *  - 75%+  → AI_ENHANCEMENT          (fast Groq model)
 *  - 50%+  → HUMAN_CLARIFICATION     (ask user to confirm)
 *  - <50%  → REJECT_UNSAFE           (explain and ask again)
 *
 * Runtime-agnostic for the synchronous path;
 * calibrated path requires server (firebase-admin).
 */

export {
  computeEnsembleConfidence,
  getTier,
  TIER_THRESHOLDS,
  type ConfidenceTier,
  type EnsembleInput,
  type EnsembleResult,
} from "./evaluation";

export {
  scoreAmount,
  scoreTransactionType,
  scoreLanguageClarity,
  scoreEntityClarity,
  scoreAmbiguity,
  type SignalScore,
} from "./scoring";

export {
  getConfidenceBand,
  recordCalibrationOutcome,
  getCalibrationStats,
  getCalibratedConfidence,
  type CalibrationStats,
} from "./calibration";

// ─── Convenience: routing decision helper ─────────────────────────────────────

import { computeEnsembleConfidence, type EnsembleInput } from "./evaluation";

/**
 * One-shot confidence decision for message handlers.
 *
 * Returns routing guidance without requiring callers to understand
 * the full ensemble internals.
 */
export function decideRoutingFromConfidence(input: EnsembleInput): {
  confidence: number;
  routingPath: "deterministic" | "ai_enhanced" | "ai_reasoning" | "human_required" | "reject";
  requiresAI: boolean;
  requiresHuman: boolean;
  shouldReject: boolean;
  recoverySuggestions: string[];
} {
  const result = computeEnsembleConfidence(input);

  let routingPath: "deterministic" | "ai_enhanced" | "ai_reasoning" | "human_required" | "reject";

  switch (result.tier) {
    case "DETERMINISTIC_AUTO":
      routingPath = "deterministic";
      break;
    case "AI_ENHANCEMENT":
      // 75–84%: fast model; 85–89%: still fast but borderline
      routingPath = result.confidence >= 0.85 ? "ai_enhanced" : "ai_reasoning";
      break;
    case "HUMAN_CLARIFICATION":
      routingPath = "human_required";
      break;
    case "REJECT_UNSAFE":
    default:
      routingPath = "reject";
  }

  return {
    confidence:          result.confidence,
    routingPath,
    requiresAI:          result.requiresAI,
    requiresHuman:       result.requiresHuman,
    shouldReject:        result.shouldReject,
    recoverySuggestions: result.recoverySuggestions,
  };
}
