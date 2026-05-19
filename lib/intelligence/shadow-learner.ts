/**
 * Shadow Learning System
 *
 * Even when the deterministic parser has HIGH confidence (≥ 85%), ZURIA
 * occasionally sends a sampled message silently to the AI for comparison.
 *
 * Purpose:
 *  - Continuously benchmark parser accuracy against AI intelligence
 *  - Detect categories where the parser systematically diverges from AI
 *  - Surface training data candidates for parser improvement
 *  - Measure extraction drift over time
 *
 * Design:
 *  - 10% sample rate at high confidence (configurable via SHADOW_SAMPLE_RATE)
 *  - Fully fire-and-forget — never blocks the response path
 *  - Results stored in shadow_learning_logs for offline analysis
 *  - Divergences emitted as events for real-time monitoring
 *
 * Server-only.
 */

import { getAdminDb } from "@/lib/firebase/admin";
import { collections } from "@/lib/firebase/collections";
import type { ParsedTransaction } from "@/types/domain";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ShadowLearningResult {
  id: string;
  userId: string;
  rawInput: string;
  normalizedInput: string;

  // Parser output
  parser: {
    type: string;
    amount: number;
    confidence: number;
    productName: string | null;
    customerName: string | null;
  };

  // AI output (null if AI unavailable or failed)
  ai: {
    type: string | null;
    amount: number | null;
    rawResponse: string;
    model: string;
  } | null;

  // Divergence analysis
  diverged: boolean;
  divergenceFields: Array<"type" | "amount" | "entity">;
  divergenceScore: number;    // 0–1 — how different the outputs are

  timestamp: string;
  sampledAt: string;
}

// ─── Configuration ────────────────────────────────────────────────────────────

/**
 * Probability of shadow-sampling a high-confidence message.
 * Set via SHADOW_SAMPLE_RATE env var (0.0–1.0). Default: 10%.
 */
function getSampleRate(): number {
  const rate = parseFloat(process.env.SHADOW_SAMPLE_RATE ?? "0.10");
  return Number.isNaN(rate) ? 0.10 : Math.max(0, Math.min(1, rate));
}

/**
 * Whether shadow learning is enabled globally.
 */
function isShadowLearningEnabled(): boolean {
  return process.env.AI_SHADOW_LEARNING !== "false";
}

// ─── Sampling decision ────────────────────────────────────────────────────────

/**
 * Decide whether to shadow-sample this message.
 * - Always sample if confidence is LOW (< 0.60) — maximum learning signal
 * - Sample at SHADOW_SAMPLE_RATE probability for MEDIUM confidence (0.60–0.84)
 * - Sample at getSampleRate() * 0.3 probability for HIGH confidence (≥ 0.85)
 *   — the parser is probably right, but we still want occasional validation
 */
export function shouldShadowSample(parserConfidence: number): boolean {
  if (!isShadowLearningEnabled()) return false;
  if (parserConfidence < 0.60) return true;          // always capture low-confidence
  const rate = getSampleRate();
  if (parserConfidence < 0.85) return Math.random() < rate;           // medium
  return Math.random() < rate * 0.3;                  // high — sparse sampling
}

// ─── Divergence analysis ──────────────────────────────────────────────────────

/**
 * Compare parser output to AI output and compute divergence.
 */
function analyzeDivergence(
  parser: ShadowLearningResult["parser"],
  ai: NonNullable<ShadowLearningResult["ai"]>,
): { diverged: boolean; fields: Array<"type" | "amount" | "entity">; score: number } {
  const fields: Array<"type" | "amount" | "entity"> = [];

  // Type divergence: parser and AI disagree on transaction type
  if (ai.type && ai.type !== parser.type) {
    // Treat semantically-equivalent types as non-divergent
    const equivalents: Record<string, string[]> = {
      expense:      ["cost", "tax"],
      debt_record:  ["debt", "repayment"],
      sale:         ["income", "received"],
      stock_purchase: ["expense"],
    };
    const equiv = equivalents[parser.type] ?? [];
    if (!equiv.includes(ai.type)) {
      fields.push("type");
    }
  }

  // Amount divergence: more than 5% difference
  if (ai.amount !== null && parser.amount > 0) {
    const diff = Math.abs(ai.amount - parser.amount) / parser.amount;
    if (diff > 0.05) fields.push("amount");
  }

  const diverged = fields.length > 0;
  const score = fields.length / 3; // 0, 0.33, 0.67, or 1.0

  return { diverged, fields, score };
}

// ─── Shadow learning execution ────────────────────────────────────────────────

/**
 * Run shadow learning comparison asynchronously.
 * Calls AI with the fast model, compares output to parser result,
 * stores the result, and emits a divergence event if applicable.
 *
 * NEVER awaited by the caller — runs entirely in background.
 */
export function runShadowLearning(
  userId: string,
  rawInput: string,
  normalizedInput: string,
  parserResult: ParsedTransaction,
): void {
  if (!shouldShadowSample(parserResult.confidence)) return;

  // Fire-and-forget — isolated from request path
  void (async () => {
    try {
      // Lazy import to avoid circular dependencies
      const { groqGenerate, isGroqAvailable } = await import("@/lib/ai/groq");
      if (!isGroqAvailable()) return;

      const prompt = [
        `Extract the financial transaction from this business message.`,
        `Reply ONLY with JSON: {"type":"<transaction_type>","amount":<number_or_null>}`,
        `Valid types: sale, expense, debt_record, debt_payment, stock_purchase, salary, income, borrow_in, borrow_out, cost, refund_given, refund_received`,
        `Message: "${normalizedInput}"`,
      ].join("\n");

      const result = await groqGenerate(prompt, {
        model: "fast",
        maxTokens: 60,
        temperature: 0.0,   // deterministic extraction
        systemPrompt: "You are a financial transaction extractor. Return ONLY valid JSON.",
      });

      if (!result) return;

      // Parse AI response
      let aiType: string | null = null;
      let aiAmount: number | null = null;
      try {
        const cleaned = result.text.replace(/```[a-z]*/gi, "").replace(/```/g, "").trim();
        const parsed = JSON.parse(cleaned) as Record<string, unknown>;
        if (typeof parsed.type === "string") aiType = parsed.type;
        if (typeof parsed.amount === "number") aiAmount = parsed.amount;
      } catch {
        // AI didn't return clean JSON — still record the attempt
      }

      const parserSummary = {
        type:         parserResult.type,
        amount:       parserResult.amount,
        confidence:   parserResult.confidence,
        productName:  parserResult.productName,
        customerName: parserResult.customerName,
      };

      const aiSummary = {
        type:        aiType,
        amount:      aiAmount,
        rawResponse: result.text.slice(0, 500),
        model:       result.model,
      };

      const { diverged, fields, score } = analyzeDivergence(parserSummary, aiSummary);

      const shadowResult: ShadowLearningResult = {
        id:                crypto.randomUUID(),
        userId,
        rawInput:          rawInput.slice(0, 500),
        normalizedInput:   normalizedInput.slice(0, 500),
        parser:            parserSummary,
        ai:                aiSummary,
        diverged,
        divergenceFields:  fields,
        divergenceScore:   score,
        timestamp:         new Date().toISOString(),
        sampledAt:         new Date().toISOString(),
      };

      // Persist to Firestore
      await getAdminDb()
        .collection(collections.shadowLearningLogs)
        .doc(shadowResult.id)
        .set(shadowResult);

      // Emit divergence event for monitoring
      if (diverged) {
        const { emitShadowLearnDivergence } = await import("@/lib/events/emitter");
        emitShadowLearnDivergence(userId, {
          rawInput:     rawInput.slice(0, 200),
          parserType:   parserResult.type,
          aiType,
          parserAmount: parserResult.amount,
          aiAmount,
          diverged:     true,
        });
      }

      // Also collect as training example if diverged
      if (diverged) {
        const { collectTrainingExample } = await import("@/lib/parser-learning/collector");
        void collectTrainingExample({
          rawInput:         rawInput.slice(0, 500),
          normalizedInput:  normalizedInput.slice(0, 500),
          parserResult:     parserSummary,
          aiResult: {
            type:       aiType,
            amount:     aiAmount,
            confidence: 0.8,
            response:   result.text.slice(0, 300),
          },
          acceptedResult: {
            type:   parserResult.type,   // parser wins unless user corrects
            amount: parserResult.amount,
          },
          language:         "unknown",
          businessCategory: "other",
          userId,
          diverged:         true,
        });
      }
    } catch {
      // Never surface shadow learning errors to the user
    }
  })();
}
