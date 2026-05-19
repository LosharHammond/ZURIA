/**
 * lib/observability/sentry.ts
 *
 * ZURIA-specific Sentry helpers.
 *
 * Adds custom tags:
 *   - userId
 *   - businessId
 *   - parserConfidence
 *   - AIModel
 *   - platform
 *   - subscriptionTier
 *
 * Server-only.
 */

import * as Sentry from "@sentry/nextjs";

// ─── Context Types ────────────────────────────────────────────────────────────

export interface ZuriaErrorContext {
  userId?: string;
  businessId?: string;
  parserConfidence?: number;
  aiModel?: string;
  platform?: "whatsapp" | "telegram" | "web";
  subscriptionTier?: string;
  extra?: Record<string, unknown>;
}

// ─── Tag helpers ──────────────────────────────────────────────────────────────

/**
 * Capture an error with ZURIA-specific tags.
 * Safe to call from anywhere — never throws.
 */
export function captureZuriaError(
  error: unknown,
  context: ZuriaErrorContext = {},
): void {
  try {
    Sentry.withScope((scope) => {
      if (context.userId)            scope.setTag("userId",            context.userId);
      if (context.businessId)        scope.setTag("businessId",        context.businessId);
      if (context.aiModel)           scope.setTag("AIModel",           context.aiModel);
      if (context.platform)          scope.setTag("platform",          context.platform);
      if (context.subscriptionTier)  scope.setTag("subscriptionTier",  context.subscriptionTier);
      if (context.parserConfidence != null) {
        scope.setTag("parserConfidence", String(context.parserConfidence.toFixed(2)));
      }
      if (context.extra) {
        scope.setExtras(context.extra);
      }
      Sentry.captureException(error);
    });
  } catch {
    // Sentry must never cause application failures
  }
}

/**
 * Track a ZURIA business event as a Sentry breadcrumb.
 */
export function addZuriaBreadcrumb(
  message: string,
  data?: Record<string, unknown>,
  level: Sentry.SeverityLevel = "info",
): void {
  try {
    Sentry.addBreadcrumb({ message, data, level, category: "zuria" });
  } catch { /* silent */ }
}

/**
 * Set the current user context in Sentry (anonymized).
 * Only sets the ID — no name/email/IP to avoid PII collection.
 */
export function setSentryUser(userId: string): void {
  try {
    Sentry.setUser({ id: userId });
  } catch { /* silent */ }
}

/**
 * Clear Sentry user context (call on logout).
 */
export function clearSentryUser(): void {
  try {
    Sentry.setUser(null);
  } catch { /* silent */ }
}

// ─── Specific error reporters ─────────────────────────────────────────────────

/** Report a parser failure with context. */
export function reportParserFailure(
  rawInput: string,
  confidence: number,
  userId: string,
): void {
  captureZuriaError(
    new Error(`[parser] Low-confidence extraction: ${confidence.toFixed(2)}`),
    { userId, parserConfidence: confidence, extra: { rawInputLength: rawInput.length } },
  );
}

/** Report an AI failure with context. */
export function reportAIFailure(
  model: string,
  userId: string,
  reason: string,
): void {
  captureZuriaError(
    new Error(`[ai] ${model} failure: ${reason}`),
    { userId, aiModel: model },
  );
}

/** Report a webhook failure. */
export function reportWebhookFailure(
  platform: "whatsapp" | "telegram",
  reason: string,
  userId?: string,
): void {
  captureZuriaError(
    new Error(`[webhook:${platform}] ${reason}`),
    { userId, platform },
  );
}

/** Report a queue job failure. */
export function reportQueueFailure(jobType: string, jobId: string, error: unknown): void {
  captureZuriaError(error, { extra: { jobType, jobId } });
}
