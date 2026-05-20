"use client";

/**
 * lib/observability/client-logger.ts
 *
 * Client-safe structured logger for browser-side code.
 *
 * Cannot use the server logger (it imports firebase-admin).
 * This provides the same interface — createLogger(module) — but
 * outputs to the browser console with structured formatting.
 *
 * In production:
 *   - info/debug are suppressed
 *   - warn/error are emitted with module context
 *
 * Usage (in any "use client" file):
 *   import { createClientLogger } from "@/lib/observability/client-logger";
 *   const logger = createClientLogger("my-service");
 *   logger.error("fetch failed", { err: String(err) });
 */

export type ClientLogLevel = "debug" | "info" | "warn" | "error";

export interface ClientLogger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

const IS_DEV = process.env.NODE_ENV !== "production";

export function createClientLogger(module: string): ClientLogger {
  const prefix = `[ZURIA:${module}]`;

  return {
    debug(message, data) {
      if (!IS_DEV) return;
      console.debug(prefix, message, data ?? "");
    },
    info(message, data) {
      if (!IS_DEV) return;
      console.info(prefix, message, data ?? "");
    },
    warn(message, data) {
      console.warn(prefix, message, data ?? "");
    },
    error(message, data) {
      console.error(prefix, message, data ?? "");
    },
  };
}
