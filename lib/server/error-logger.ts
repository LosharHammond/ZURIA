import { getAdminDb } from "@/lib/firebase/admin";
import { collections } from "@/lib/firebase/collections";

export interface ErrorLog {
  id: string;
  context: string;       // e.g. "[webhook]", "[admin/stats]"
  message: string;
  stack?: string;
  phone?: string;        // masked phone if relevant
  meta?: Record<string, string>;
  severity: "error" | "warn";
  createdAt: string;
}

/**
 * Write an error entry to Firestore for admin visibility.
 * Never throws — logging must never crash the calling code path.
 */
export async function logError(
  context: string,
  error: unknown,
  options: { phone?: string; meta?: Record<string, string>; severity?: "error" | "warn" } = {}
): Promise<void> {
  try {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? (error.stack ?? undefined) : undefined;
    const ref = getAdminDb().collection(collections.errors).doc();
    await ref.set({
      id: ref.id,
      context,
      message,
      stack,
      phone: options.phone ? maskPhone(options.phone) : undefined,
      meta: options.meta ?? null,
      severity: options.severity ?? "error",
      createdAt: new Date(),
    });
  } catch {
    // Silently ignore — logging must never break the caller
    console.error("[errorLogger] could not persist error:", error);
  }
}

// Mask phone: "+233241234567" → "+233241****67"
function maskPhone(phone: string): string {
  if (phone.length < 6) return "****";
  return phone.slice(0, phone.length - 6) + "****" + phone.slice(-2);
}
