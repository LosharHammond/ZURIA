// Server-only — AI request/response structured logging

import { getAdminDb } from "@/lib/firebase/admin";

// ─── Interfaces ───────────────────────────────────────────────────────────────

/**
 * A structured log entry for a single AI inference attempt.
 */
export interface AIRequestLog {
  id: string;
  userId: string;
  model: string;
  /** Prompt text truncated to 500 characters */
  prompt: string;
  /** Response text truncated to 500 characters */
  response: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUSD: number;
  latencyMs: number;
  success: boolean;
  routingPath: string;
  timestamp: string;
}

// ─── logAIRequest ─────────────────────────────────────────────────────────────

/**
 * Fire-and-forget — writes a single AI request log entry to Firestore.
 * Never throws; all errors are silently swallowed to avoid impacting the caller.
 */
export async function logAIRequest(
  log: Omit<AIRequestLog, "id" | "timestamp">,
): Promise<void> {
  try {
    const db = getAdminDb();
    const docRef = db.collection("ai_request_logs").doc();
    const entry: AIRequestLog = {
      ...log,
      id: docRef.id,
      // Enforce 500-char truncation at write time in case caller skipped it
      prompt: log.prompt.slice(0, 500),
      response: log.response.slice(0, 500),
      timestamp: new Date().toISOString(),
    };
    await docRef.set(entry);
  } catch {
    // Intentionally silent — logging must never break the calling code path
  }
}

// ─── createAIRequestLogger ───────────────────────────────────────────────────

/**
 * Factory that returns a logging bracket for a single AI call.
 *
 * Usage:
 * ```ts
 * const logger = createAIRequestLogger(userId, "llama-3.1-8b-instant");
 * const finish = logger.start();
 * const result = await groqGenerate(myPrompt, options);
 * await finish(result, "fast-path");
 * ```
 *
 * The `start()` call captures the start time and returns a `finish` function.
 * Call `finish(result, routingPath)` after the AI call completes.
 * Pass `null` as `result` to record a failure.
 * The `prompt` field in the log is derived from the `result.text` context;
 * callers that need to log the input prompt should set it via `logAIRequest`
 * directly, or pass a pre-truncated string when wrapping this factory.
 */
export function createAIRequestLogger(
  userId: string,
  model: string,
): {
  start: () => (
    result: {
      text: string;
      inputTokens: number;
      outputTokens: number;
      latencyMs: number;
    } | null,
    routingPath: string,
  ) => Promise<void>;
} {
  return {
    start() {
      // Record the wall-clock start so the finish function can compute latency
      // independently if the caller's result latencyMs is unavailable.
      const _startMs = Date.now();

      return async function finish(
        result: {
          text: string;
          inputTokens: number;
          outputTokens: number;
          latencyMs: number;
        } | null,
        routingPath: string,
      ): Promise<void> {
        const success = result !== null;
        const latencyMs = result?.latencyMs ?? Date.now() - _startMs;

        await logAIRequest({
          userId,
          model,
          prompt: "", // prompt not available at finish-time; callers that need it should use logAIRequest directly
          response: (result?.text ?? "").slice(0, 500),
          inputTokens: result?.inputTokens ?? 0,
          outputTokens: result?.outputTokens ?? 0,
          estimatedCostUSD: 0,
          latencyMs,
          success,
          routingPath,
        });
      };
    },
  };
}
