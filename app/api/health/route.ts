import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { APP_URL } from "@/lib/config";

export const dynamic = "force-dynamic";

/**
 * GET /api/health
 *
 * Deployment health-check endpoint for Vercel, uptime monitors, and CI/CD.
 * Returns HTTP 200 when all critical services are reachable, 503 otherwise.
 *
 * Checks:
 *  - Required environment variables are set
 *  - Firestore Admin SDK can initialise (cold connectivity probe)
 *
 * Safe to call publicly — no data is returned.
 */
export async function GET() {
  const t0 = Date.now();

  // ── 1. Environment variable checks ─────────────────────────────────────────
  const CRITICAL_ENVS = [
    "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
    "FIREBASE_CLIENT_EMAIL",
    "FIREBASE_PRIVATE_KEY",
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
    "TWILIO_WHATSAPP_NUMBER",
    "ADMIN_PHONE",
  ];
  const OPTIONAL_ENVS = ["PAYSTACK_SECRET_KEY", "NEXT_PUBLIC_WA_NUMBER", "NEXT_PUBLIC_APP_URL"];

  const missingCritical = CRITICAL_ENVS.filter((k) => !process.env[k]);
  const missingOptional = OPTIONAL_ENVS.filter((k) => !process.env[k]);

  // ── 2. Firestore connectivity probe ────────────────────────────────────────
  let firestoreOk = false;
  let firestoreError: string | null = null;
  try {
    const db = getAdminDb();
    // listCollections() is a lightweight admin-level call — no document reads needed
    await db.listCollections();
    firestoreOk = true;
  } catch (err) {
    firestoreError = err instanceof Error ? err.message.slice(0, 120) : "unknown";
  }

  const allCriticalOk = missingCritical.length === 0 && firestoreOk;
  const latencyMs = Date.now() - t0;

  const body: Record<string, unknown> = {
    status:    allCriticalOk ? "ok" : "degraded",
    latencyMs,
    appUrl:    APP_URL,
    ts:        new Date().toISOString(),
    checks: {
      env:        missingCritical.length === 0 ? "ok" : "error",
      firestore:  firestoreOk                  ? "ok" : "error",
    },
    env: {
      criticalConfigured: CRITICAL_ENVS.length - missingCritical.length,
      criticalTotal: CRITICAL_ENVS.length,
      optionalConfigured: OPTIONAL_ENVS.length - missingOptional.length,
      optionalTotal: OPTIONAL_ENVS.length,
    },
  };

  if (firestoreError)             body.firestoreError  = firestoreError;

  return NextResponse.json(body, { status: allCriticalOk ? 200 : 503 });
}
