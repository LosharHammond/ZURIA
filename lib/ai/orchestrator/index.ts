// FILE: lib/ai/orchestrator/index.ts
// Server-only — AI orchestration engine.
// The main routing brain that every message handler calls.

import { groqGenerate, isGroqAvailable } from "../groq";
import { ZURIA_SYSTEM_PROMPT } from "@/lib/intelligence/ai-provider";
import { isAIEnabled } from "../cost-governance";

// ─── Confidence Thresholds ────────────────────────────────────────────────────

/** 85%+ → save immediately, no AI needed */
export const CONF_HIGH   = 0.85;
/** 60–84% → lightweight AI enhancement (fast model) */
export const CONF_MEDIUM = 0.60;
/** 0–59% → advanced AI reasoning (advanced model) */
export const CONF_LOW    = 0.00;

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface OrchestratorInput {
  /** User's original message */
  rawText: string;
  /** After Ghanaian normalizer */
  normalizedText: string;
  /** 0–1 from parser */
  parserConfidence: number;
  /** Parsed transaction type */
  parserType: string;
  /** Owner name, plan, category */
  businessContext: string;
  /** Last 5 turns as text */
  conversationHistory: string;
  /** Today's financial snapshot */
  financialContext: string;
  /** Classified intent label */
  intentContext?: string;
  /** Detected tone */
  emotionalTone?: string;
  userId: string;
  /** Debt/payroll/withdrawal require higher confidence */
  isCriticalTransaction?: boolean;
}

export interface OrchestratorResult {
  /** The final response text to send to user */
  response: string;
  usedAI: boolean;
  aiModel?: string;
  /** Effective confidence after AI processing */
  confidence: number;
  /** Whether the transaction should be saved */
  shouldSave: boolean;
  /** Whether to ask user to confirm */
  requiresConfirmation: boolean;
  routingPath: "deterministic" | "ai_enhanced" | "ai_reasoning" | "fallback";
}

// ─── Pure Helpers ─────────────────────────────────────────────────────────────

export function getRoutingPath(
  confidence: number,
): "deterministic" | "ai_enhanced" | "ai_reasoning" {
  if (confidence >= CONF_HIGH)   return "deterministic";
  if (confidence >= CONF_MEDIUM) return "ai_enhanced";
  return "ai_reasoning";
}

export function shouldRequireConfirmation(
  confidence: number,
  isCritical: boolean,
): boolean {
  if (isCritical && confidence < 0.70) return true;
  return false;
}

// ─── Prompt Builder ───────────────────────────────────────────────────────────

function buildUserPrompt(input: OrchestratorInput): string {
  const lines: string[] = [
    `Business context: ${input.businessContext}`,
  ];

  if (input.financialContext) {
    lines.push(`Financial data: ${input.financialContext}`);
  }
  if (input.intentContext) {
    lines.push(`Classified intent: ${input.intentContext}`);
  }
  if (input.emotionalTone && input.emotionalTone !== "neutral") {
    lines.push(`Emotional tone detected: ${input.emotionalTone}`);
  }
  if (input.conversationHistory) {
    lines.push(`Recent conversation:\n${input.conversationHistory}`);
  }

  lines.push(`User message: "${input.rawText}"`);
  lines.push(`Normalized: "${input.normalizedText}"`);
  lines.push(`Parser type: ${input.parserType} (confidence: ${(input.parserConfidence * 100).toFixed(0)}%)`);
  lines.push(``);
  lines.push(`Generate a brief ZURIA response. 2–4 lines max. No JSON. No internal labels. Just the reply.`);

  return lines.join("\n");
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

/**
 * Main orchestration function — routes each message to the appropriate engine.
 *
 * @param input            Structured context from the caller.
 * @param generateRuleBasedResponse  Zero-arg factory that produces the rule-based fallback text.
 */
export async function orchestrate(
  input: OrchestratorInput,
  generateRuleBasedResponse: () => string,
): Promise<OrchestratorResult> {
  const {
    parserConfidence: confidence,
    isCriticalTransaction = false,
    userId,
  } = input;

  // ── 1. Critical transaction guard ──────────────────────────────────────────
  const requiresConfirmation = shouldRequireConfirmation(confidence, isCriticalTransaction);

  // ── 2 & 3. High-confidence deterministic path ──────────────────────────────
  if (confidence >= CONF_HIGH) {
    const aiAvailable = isGroqAvailable() && isAIEnabled();

    // Shadow-learn: 10% chance, fire-and-forget, never block
    if (aiAvailable) {
      if (Math.random() < 0.10) {
        void (async () => {
          try {
            await groqGenerate(buildUserPrompt(input), {
              model:       "fast",
              systemPrompt: ZURIA_SYSTEM_PROMPT,
              maxTokens:   256,
              temperature: 0.4,
            });
            console.log(`[orchestrator] shadow-learn fired for user ${userId}`);
          } catch {
            // intentionally silent
          }
        })();
      }
    }

    return {
      response:             generateRuleBasedResponse(),
      usedAI:               false,
      confidence,
      shouldSave:           true,
      requiresConfirmation,
      routingPath:          "deterministic",
    };
  }

  // ── AI paths ───────────────────────────────────────────────────────────────
  const aiEnabled   = isAIEnabled();
  const aiAvailable = isGroqAvailable() && aiEnabled;

  if (aiAvailable) {
    const useAdvanced = confidence < CONF_MEDIUM;
    const model       = useAdvanced ? "advanced" : "fast";
    const routingPath = useAdvanced ? "ai_reasoning" : "ai_enhanced";

    const result = await groqGenerate(buildUserPrompt(input), {
      model,
      systemPrompt: ZURIA_SYSTEM_PROMPT,
      maxTokens:   300,
      temperature: 0.6,
    });

    if (result && result.text.trim().length > 0) {
      return {
        response:             result.text.trim(),
        usedAI:               true,
        aiModel:              result.model,
        confidence,
        shouldSave:           confidence >= CONF_MEDIUM,
        requiresConfirmation,
        routingPath,
      };
    }
  }

  // ── Fallback ───────────────────────────────────────────────────────────────
  return {
    response:             generateRuleBasedResponse(),
    usedAI:               false,
    confidence,
    shouldSave:           confidence >= CONF_HIGH,
    requiresConfirmation,
    routingPath:          "fallback",
  };
}
