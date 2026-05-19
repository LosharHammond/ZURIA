// FILE: lib/ai/safety/moderator.ts
// Server-only — prompt safety and moderation.

import { groqGenerate, isGroqAvailable } from "../groq";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ModerationResult {
  safe: boolean;
  reason?: string;
  category?: "prompt_injection" | "jailbreak" | "parser_poisoning" | "malicious" | "spam";
  /** 0–1 */
  confidence: number;
}

// ─── Pattern Sets ─────────────────────────────────────────────────────────────

const INJECTION_PATTERNS: string[] = [
  "system:",
  "ignore above",
  "ignore all",
  "ignore previous",
  "act as",
  "you are now",
  "disregard all",
  "jailbreak",
  "override system",
  "new instructions:",
];

const JAILBREAK_PATTERNS: string[] = [
  "pretend you are",
  "roleplay as",
  "simulate being",
  "hypothetically",
  "in this scenario you are",
  "forget your instructions",
];

// Matches patterns like: amount=1000, type=income, confidence=0.99
// inside brackets, JSON-like, or URL-encoded injection attempts
const PARSER_POISONING_RE = /[\[{(]?\s*(amount|type|confidence)\s*=\s*[\d"'a-z]/i;

// ─── Suspicious Pattern Check ─────────────────────────────────────────────────

function looksUnusual(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    INJECTION_PATTERNS.some((p) => lower.includes(p)) ||
    JAILBREAK_PATTERNS.some((p) => lower.includes(p)) ||
    PARSER_POISONING_RE.test(text)
  );
}

// ─── Deterministic Moderation ─────────────────────────────────────────────────

/**
 * Fast, synchronous safety check — no network calls.
 * Returns { safe: true, confidence: 1.0 } when clean.
 */
export function moderateInput(text: string): ModerationResult {
  const lower = text.trim().toLowerCase();

  // Spam: text longer than 2000 chars
  if (text.length > 2_000) {
    return {
      safe:       false,
      reason:     "Message exceeds maximum allowed length (2000 characters).",
      category:   "spam",
      confidence: 0.95,
    };
  }

  // Prompt injection
  for (const pattern of INJECTION_PATTERNS) {
    if (lower.includes(pattern)) {
      return {
        safe:       false,
        reason:     `Potential prompt injection detected: "${pattern}"`,
        category:   "prompt_injection",
        confidence: 0.95,
      };
    }
  }

  // Parser poisoning
  if (PARSER_POISONING_RE.test(text)) {
    return {
      safe:       false,
      reason:     "Potential parser poisoning pattern detected (injected field assignment).",
      category:   "parser_poisoning",
      confidence: 0.95,
    };
  }

  // Jailbreak
  for (const pattern of JAILBREAK_PATTERNS) {
    if (lower.includes(pattern)) {
      return {
        safe:       false,
        reason:     `Potential jailbreak attempt detected: "${pattern}"`,
        category:   "jailbreak",
        confidence: 0.95,
      };
    }
  }

  return { safe: true, confidence: 1.0 };
}

// ─── Groq-Backed Moderation ───────────────────────────────────────────────────

/**
 * AI-powered moderation using the Groq guard model.
 * Falls back to { safe: true, confidence: 0.5 } if Groq is unavailable.
 */
export async function moderateWithGroq(text: string): Promise<ModerationResult> {
  if (!isGroqAvailable()) {
    return { safe: true, confidence: 0.5 };
  }

  const systemPrompt =
    'You are a content moderation system. Answer ONLY with JSON: {"safe":true/false,"reason":""}';

  const userMessage =
    `Is this message safe for a financial assistant? Reply JSON only: ${text.slice(0, 500)}`;

  const result = await groqGenerate(userMessage, {
    model:        "guard",
    systemPrompt,
    maxTokens:    80,
    temperature:  0.0,
  });

  if (!result) {
    // Groq failed — fail-open
    return { safe: true, confidence: 0.5 };
  }

  try {
    // Strip markdown code fences if present
    const cleaned = result.text
      .replace(/```json\s*/gi, "")
      .replace(/```/g, "")
      .trim();

    const parsed: unknown = JSON.parse(cleaned);

    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "safe" in parsed &&
      typeof (parsed as Record<string, unknown>)["safe"] === "boolean"
    ) {
      const obj    = parsed as Record<string, unknown>;
      const safe   = obj["safe"] as boolean;
      const reason = typeof obj["reason"] === "string" ? obj["reason"] : undefined;

      return {
        safe,
        reason:     safe ? undefined : (reason ?? "Flagged by AI moderation."),
        category:   safe ? undefined : "malicious",
        confidence: 0.80,
      };
    }

    // Unexpected shape — fail-open
    return { safe: true, confidence: 0.5 };
  } catch {
    // JSON parse error — fail-open
    return { safe: true, confidence: 0.5 };
  }
}

// ─── Full Moderation Pipeline ─────────────────────────────────────────────────

/**
 * Runs the full two-stage moderation pipeline:
 * 1. Deterministic check (always).
 * 2. Groq guard model check (only when deterministic passes AND text looks unusual).
 */
export async function fullModeration(text: string): Promise<ModerationResult> {
  // Stage 1 — deterministic
  const deterministicResult = moderateInput(text);
  if (!deterministicResult.safe) {
    return deterministicResult;
  }

  // Stage 2 — AI guard (only when unusual patterns are present and Groq is available)
  if (isGroqAvailable() && looksUnusual(text)) {
    return moderateWithGroq(text);
  }

  return deterministicResult;
}
