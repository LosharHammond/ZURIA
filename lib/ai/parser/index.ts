// Server-only — AI-assisted transaction parser enhancement

import { groqGenerate } from "@/lib/ai/groq";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * The result of an AI-assisted parse enhancement attempt.
 */
export interface AIParserResult {
  type: string | null;
  amount: number | null;
  productName: string | null;
  customerName: string | null;
  /** Confidence level — always 0.75 for AI-derived extractions */
  confidence: number;
  /** Raw text response from the model */
  rawResponse: string;
  /** Model identifier string that was used */
  model: string;
}

/** Valid transaction type values the AI must choose from. */
const VALID_TYPES = new Set([
  "sale",
  "expense",
  "debt_record",
  "debt_payment",
  "stock_purchase",
  "salary",
  "income",
  "borrow_in",
  "borrow_out",
  "cost",
  "refund_given",
  "refund_received",
]);

// ─── buildParserPrompt ────────────────────────────────────────────────────────

/**
 * Build the structured extraction prompt sent to the Groq model.
 * Exported separately so it can be unit-tested without making network calls.
 *
 * @param rawText        The original, un-normalised user message.
 * @param normalizedText The normalised version after basic pre-processing.
 * @param parserResult   The deterministic parser's best attempt so far.
 */
export function buildParserPrompt(
  rawText: string,
  normalizedText: string,
  parserResult: { type: string; amount: number },
): string {
  const validTypesList = [...VALID_TYPES].join(", ");

  return `You are a financial transaction extractor for a small African business bookkeeping app.

Extract the transaction details from the user message below. Respond ONLY with valid JSON — no explanation, no markdown, no extra text.

Valid transaction types: ${validTypesList}

User message (raw): """${rawText}"""
Normalised message: """${normalizedText}"""
Deterministic parser guess — type: "${parserResult.type}", amount: ${parserResult.amount}

Respond with exactly this JSON shape:
{"type":"<one of the valid types or null>","amount":<number or null>,"productName":"<string or null>","customerName":"<string or null>"}`;
}

// ─── enhanceWithAI ────────────────────────────────────────────────────────────

/**
 * Take a raw user message that the deterministic parser extracted with LOW
 * confidence and ask Groq to improve the extraction.
 *
 * Model selection:
 * - confidence 0.60–0.84 → "fast"  (llama-3.1-8b-instant)
 * - confidence < 0.60    → "advanced" (deepseek-r1-distill-llama-70b)
 *
 * Returns `null` on any error or if Groq is unavailable.
 * Never throws.
 *
 * @param rawText        Original un-normalised user message.
 * @param normalizedText Normalised version of the message.
 * @param parserResult   Deterministic parser result to improve on.
 * @param userId         User identifier (used for logging/rate-limiting upstream).
 */
export async function enhanceWithAI(
  rawText: string,
  normalizedText: string,
  parserResult: {
    type: string;
    amount: number;
    confidence: number;
    productName?: string | null;
    customerName?: string | null;
  },
  userId: string,
): Promise<AIParserResult | null> {
  // userId is accepted for future logging/rate-limiting by callers
  void userId;

  try {
    const model = parserResult.confidence < 0.6 ? "advanced" : "fast";
    const prompt = buildParserPrompt(rawText, normalizedText, parserResult);

    const result = await groqGenerate(prompt, {
      model,
      temperature: 0.1,
      maxTokens: 80,
    });

    if (!result) return null;

    const rawResponse = result.text.trim();

    // ── Safe JSON parse ───────────────────────────────────────────────────
    let parsed: unknown;
    try {
      // The model may wrap the JSON in markdown code fences — strip them
      const cleaned = rawResponse
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "")
        .trim();
      parsed = JSON.parse(cleaned);
    } catch {
      return null;
    }

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return null;
    }

    const obj = parsed as Record<string, unknown>;

    // ── Extract and validate fields ───────────────────────────────────────
    const rawType = typeof obj["type"] === "string" ? obj["type"] : null;
    const type =
      rawType !== null && VALID_TYPES.has(rawType) ? rawType : null;

    const rawAmount = obj["amount"];
    const amount =
      typeof rawAmount === "number" && isFinite(rawAmount) && rawAmount > 0
        ? rawAmount
        : null;

    const productName =
      typeof obj["productName"] === "string" && obj["productName"].trim() !== ""
        ? obj["productName"].trim()
        : null;

    const customerName =
      typeof obj["customerName"] === "string" &&
      obj["customerName"].trim() !== ""
        ? obj["customerName"].trim()
        : null;

    return {
      type,
      amount,
      productName,
      customerName,
      confidence: 0.75,
      rawResponse,
      model: result.model,
    };
  } catch {
    return null;
  }
}
