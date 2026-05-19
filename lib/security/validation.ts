// Shared input validation, sanitization, and abuse detection utilities

import { z } from "zod";

// ─── Zod Schemas ──────────────────────────────────────────────────────────────

/** Validates a phone number in E.164-like or local format (7–15 digits, optional leading +). */
export const PhoneNumberSchema = z
  .string()
  .regex(/^\+?[0-9]{7,15}$/, "Invalid phone number");

/** Validates a monetary amount (min 0.01, max 10,000,000). */
export const AmountSchema = z.number().min(0.01).max(10_000_000);

/** Validates a transaction type string against the full set of known types. */
export const TransactionTypeSchema = z.enum([
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
  "tax",
  "investment",
  "withdrawal",
  "repayment",
  "transfer",
]);

/** Validates an incoming webhook payload envelope. */
export const WebhookPayloadSchema = z.object({
  event: z.string(),
  data: z.record(z.unknown()),
  timestamp: z.string().optional(),
});

/** Validates a user message submitted via the chat/command API. */
export const UserMessageSchema = z.object({
  message: z.string().min(1).max(4000),
  userId: z.string().min(1).max(128),
  platform: z.enum(["whatsapp", "telegram"]).optional(),
});

// ─── sanitizeInput ────────────────────────────────────────────────────────────

/**
 * Sanitize a raw text string for safe processing.
 *
 * Steps applied:
 * 1. Strip HTML tags (< … >).
 * 2. Remove zero-width and invisible Unicode characters.
 * 3. Collapse runs of whitespace to a single space.
 * 4. Trim leading/trailing whitespace.
 * 5. Truncate to 4000 characters.
 *
 * @param text Raw input string.
 * @returns Sanitized string safe for further processing.
 */
export function sanitizeInput(text: string): string {
  return text
    // 1. Strip HTML tags
    .replace(/<[^>]*>/g, "")
    // 2. Remove zero-width characters and other invisible Unicode
    .replace(/[​-‍﻿⁠­]/g, "")
    // 3. Collapse multiple whitespace characters into a single space
    .replace(/\s+/g, " ")
    // 4. Trim
    .trim()
    // 5. Truncate
    .slice(0, 4000);
}

// ─── detectCSRF ───────────────────────────────────────────────────────────────

/** Allowed origins derived from the NEXT_PUBLIC_APP_URL env var plus localhost. */
function getAllowedOrigins(): Set<string> {
  const origins = new Set<string>(["http://localhost:3000", "http://localhost"]);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (appUrl) {
    try {
      origins.add(new URL(appUrl).origin);
    } catch {
      // malformed URL — ignore
    }
  }
  return origins;
}

/**
 * Check whether an incoming request exhibits CSRF characteristics.
 *
 * Returns `true` (CSRF detected) when:
 * - The `Origin` header is present AND does not match an allowed origin, OR
 * - The `Origin` header is absent but the `Referer` header points to an
 *   unexpected host.
 *
 * Returns `false` (safe) when the origin is missing entirely (e.g. server-to-
 * server calls) or matches an allowed origin.
 *
 * @param headers  A flat map of lowercase header names to their values.
 * @returns `true` if CSRF is detected, `false` otherwise.
 */
export function detectCSRF(
  headers: Record<string, string | undefined>,
): boolean {
  const allowedOrigins = getAllowedOrigins();

  const origin = headers["origin"];
  if (origin !== undefined && origin !== "") {
    return !allowedOrigins.has(origin);
  }

  // Fallback: check Referer
  const referer = headers["referer"];
  if (referer) {
    try {
      const refOrigin = new URL(referer).origin;
      return !allowedOrigins.has(refOrigin);
    } catch {
      // Malformed Referer — treat as suspicious
      return true;
    }
  }

  // No origin info — not a browser request (e.g. server-to-server), allow
  return false;
}

// ─── isReplayAttack ───────────────────────────────────────────────────────────

/**
 * Detect whether a message ID has already been processed (replay attack).
 *
 * As a side-effect, the `messageId` is added to `seenIds` so subsequent calls
 * with the same ID will return `true`.
 *
 * @param messageId  The unique identifier for the incoming message.
 * @param seenIds    A caller-managed Set of previously processed IDs.
 * @returns `true` if the message ID was already in `seenIds` (replay), `false` if new.
 */
export function isReplayAttack(messageId: string, seenIds: Set<string>): boolean {
  if (seenIds.has(messageId)) return true;
  seenIds.add(messageId);
  return false;
}

// ─── scoreAbuseRisk ───────────────────────────────────────────────────────────

/**
 * Compute a 0–100 abuse risk score for a given request context.
 *
 * Score contributions:
 * - Message length > 3000 chars: +20
 * - More than 10 requests per minute: +30
 * - Contains prompt injection keywords: +40
 * - New user sending > 3 requests per minute: +10
 *
 * @returns An integer in the range [0, 100].
 */
export function scoreAbuseRisk(params: {
  messageLength: number;
  requestsPerMinute: number;
  hasPromptInjectionKeywords: boolean;
  isNewUser: boolean;
}): number {
  let score = 0;

  if (params.messageLength > 3000) score += 20;
  if (params.requestsPerMinute > 10) score += 30;
  if (params.hasPromptInjectionKeywords) score += 40;
  if (params.isNewUser && params.requestsPerMinute > 3) score += 10;

  return Math.min(score, 100);
}

// ─── validateWebhookPayload ───────────────────────────────────────────────────

/**
 * Safe-parse an unknown payload against any Zod schema.
 *
 * Returns the parsed, typed value on success, or `null` if validation fails.
 * Never throws.
 *
 * @param schema   Any Zod schema (`z.ZodTypeAny`).
 * @param payload  The raw unknown value to validate.
 * @returns The validated value typed as `z.infer<T>`, or `null`.
 */
export function validateWebhookPayload<T extends z.ZodTypeAny>(
  schema: T,
  payload: unknown,
): z.infer<T> | null {
  const result = schema.safeParse(payload);
  return result.success ? result.data : null;
}
