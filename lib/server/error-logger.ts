import { getAdminDb } from "@/lib/firebase/admin";
import { collections } from "@/lib/firebase/collections";

export interface ErrorLog {
  id: string;
  context: string;       // e.g. "[webhook]", "[admin/stats]"
  message: string;
  stack?: string;
  phone?: string;        // masked phone if relevant
  meta?: Record<string, unknown>;
  severity: "error" | "warn" | "critical";
  createdAt: string;
}

// ─── Structured console output ────────────────────────────────────────────────
function structuredLog(severity: ErrorLog["severity"], context: string, message: string, extra?: Record<string, unknown>) {
  const ts = new Date().toISOString();
  const prefix = severity === "critical" ? "🚨 CRITICAL" : severity === "error" ? "❌ ERROR" : "⚠️ WARN";
  const payload = { ts, context, message, ...extra };
  if (severity === "warn") {
    console.warn(`[ZURIA][${prefix}]`, JSON.stringify(payload));
  } else {
    console.error(`[ZURIA][${prefix}]`, JSON.stringify(payload));
  }
}

// ─── Retry helper for Firestore writes ───────────────────────────────────────
async function writeWithRetry(fn: () => Promise<void>, retries = 1): Promise<void> {
  try {
    await fn();
  } catch (firstErr) {
    if (retries <= 0) throw firstErr;
    await new Promise((r) => setTimeout(r, 600));
    await fn(); // one retry after 600 ms
  }
}

/**
 * Write an error entry to Firestore for admin visibility.
 *
 * - Severity "critical": also logs to console as a hard error so it appears
 *   in Vercel function logs even if Firestore is unavailable.
 * - Retries the Firestore write once (600 ms delay) before giving up.
 * - Never throws — logging must never crash the calling code path.
 */
export async function logError(
  context: string,
  error: unknown,
  options: {
    phone?: string;
    meta?: Record<string, unknown>;
    severity?: "error" | "warn" | "critical";
  } = {}
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const stack   = error instanceof Error ? (error.stack ?? undefined) : undefined;
  const severity = options.severity ?? "error";

  // Always emit a structured console line so Vercel/hosting logs capture it
  structuredLog(severity, context, message, {
    ...(options.phone ? { phone: maskPhone(options.phone) } : {}),
    ...(options.meta  ? { meta: options.meta } : {}),
    ...(stack         ? { stack: stack.slice(0, 500) } : {}),
  });

  // Persist to Firestore with one retry
  try {
    await writeWithRetry(async () => {
      const ref = getAdminDb().collection(collections.errors).doc();
      await ref.set({
        id: ref.id,
        context,
        message,
        stack: stack?.slice(0, 2000) ?? null,
        phone: options.phone ? maskPhone(options.phone) : null,
        meta: options.meta ?? null,
        severity,
        createdAt: new Date().toISOString(),
      });
    });
  } catch (persistErr) {
    // Last-resort: emit to console so it at minimum appears in hosting logs
    console.error("[ZURIA][errorLogger] Firestore persist failed after retry:", {
      originalContext: context,
      originalMessage: message,
      persistError: persistErr instanceof Error ? persistErr.message : String(persistErr),
    });
  }
}

// Mask phone: "+233241234567" → "+233241****67"
function maskPhone(phone: string): string {
  if (phone.length < 6) return "****";
  return phone.slice(0, phone.length - 6) + "****" + phone.slice(-2);
}
