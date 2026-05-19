// FILE: lib/ai/groq.ts
// Server-only — Groq SDK singleton and generation utilities.

import Groq from "groq-sdk";

// ─── Model Constants ──────────────────────────────────────────────────────────

export const GROQ_FAST_MODEL     = "llama-3.1-8b-instant";
export const GROQ_ADVANCED_MODEL = "deepseek-r1-distill-llama-70b";
export const GROQ_GUARD_MODEL    = "meta-llama/llama-prompt-guard-2-22m";

// ─── Types ────────────────────────────────────────────────────────────────────

export type GroqModel = "fast" | "advanced" | "guard";

export interface GroqGenerateOptions {
  model: GroqModel;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}

export interface GroqGenerateResult {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

// ─── Availability Check ───────────────────────────────────────────────────────

export function isGroqAvailable(): boolean {
  return typeof process !== "undefined" &&
    !!process.env.GROQ_API_KEY &&
    process.env.GROQ_API_KEY.trim().length > 0;
}

// ─── Lazy Singleton ───────────────────────────────────────────────────────────

let _groqClient: Groq | null = null;

export function getGroqClient(): Groq {
  if (_groqClient) return _groqClient;

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey || apiKey.trim().length === 0) {
    throw new Error("[groq] GROQ_API_KEY is not set or empty");
  }

  _groqClient = new Groq({ apiKey });
  return _groqClient;
}

// ─── Model String Resolver ────────────────────────────────────────────────────

function resolveModelString(model: GroqModel): string {
  switch (model) {
    case "fast":     return GROQ_FAST_MODEL;
    case "advanced": return GROQ_ADVANCED_MODEL;
    case "guard":    return GROQ_GUARD_MODEL;
  }
}

// ─── Sleep Helper ─────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Core Generate Function ───────────────────────────────────────────────────

/**
 * Generate a completion via Groq.
 *
 * - Falls back to null if Groq is unavailable.
 * - Retries up to 3 times with exponential backoff (100 ms → 200 ms → 400 ms).
 * - Each attempt has a 15-second timeout.
 * - Never throws — returns null on any unrecoverable error.
 */
export async function groqGenerate(
  prompt: string,
  options: GroqGenerateOptions,
): Promise<GroqGenerateResult | null> {
  if (!isGroqAvailable()) return null;

  const modelString = resolveModelString(options.model);
  const backoffDelays = [100, 200, 400];
  const timeoutMs = 15_000;

  for (let attempt = 0; attempt < 3; attempt++) {
    const startMs = Date.now();

    try {
      const client = getGroqClient();

      const messages: Array<{ role: "system" | "user"; content: string }> = [];
      if (options.systemPrompt) {
        messages.push({ role: "system", content: options.systemPrompt });
      }
      messages.push({ role: "user", content: prompt });

      const timeoutSignal = AbortSignal.timeout(timeoutMs);

      const completion = await client.chat.completions.create(
        {
          model:       modelString,
          max_tokens:  options.maxTokens  ?? 512,
          temperature: options.temperature ?? 0.6,
          messages,
        },
        { signal: timeoutSignal },
      );

      const latencyMs = Date.now() - startMs;

      const text = completion.choices[0]?.message?.content ?? "";
      if (!text) {
        // Empty response — treat as a soft failure and retry
        if (attempt < 2) {
          await sleep(backoffDelays[attempt] ?? 400);
          continue;
        }
        return null;
      }

      const inputTokens  = completion.usage?.prompt_tokens     ?? 0;
      const outputTokens = completion.usage?.completion_tokens ?? 0;

      return {
        text,
        model: modelString,
        inputTokens,
        outputTokens,
        latencyMs,
      };
    } catch (err: unknown) {
      const latencyMs = Date.now() - startMs;
      console.error(`[groq] error: attempt ${attempt + 1}, latency ${latencyMs}ms`, err);

      if (attempt < 2) {
        await sleep(backoffDelays[attempt] ?? 400);
        continue;
      }

      return null;
    }
  }

  return null;
}
