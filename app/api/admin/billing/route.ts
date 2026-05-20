/**
 * GET /api/admin/billing
 *
 * Returns the full billing dashboard data for admin monitoring.
 * Supports replay and recovery actions via POST.
 *
 * Auth: x-admin-key === CRON_SECRET  OR  Firebase Bearer token from admin phone.
 */

import { NextResponse, type NextRequest } from "next/server";
import { getBillingDashboardData } from "@/lib/billing";
import { replayDeadLetter, resolveDeadLetter } from "@/lib/billing/webhooks";
import { recoverPayment } from "@/lib/billing/recovery";

// ─── Auth helper ──────────────────────────────────────────────────────────────

async function isAuthorized(request: NextRequest): Promise<boolean> {
  const adminKey   = request.headers.get("x-admin-key") ?? "";
  const cronSecret = process.env.CRON_SECRET ?? "";
  const adminPhone = process.env.ADMIN_PHONE ?? "";

  if (cronSecret && adminKey === cronSecret) return true;

  if (adminPhone) {
    const authHeader = request.headers.get("authorization");
    if (authHeader?.startsWith("Bearer ")) {
      try {
        const { verifyAdminToken } = await import("@/lib/firebase/admin");
        const decoded = await verifyAdminToken(authHeader);
        if (decoded) return true;
      } catch {
        // token verification failed
      }
    }
  }

  return false;
}

// ─── GET — billing dashboard data ────────────────────────────────────────────

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const data = await getBillingDashboardData();
    return NextResponse.json(data, { status: 200 });
  } catch {
    return NextResponse.json({ error: "Failed to load billing data" }, { status: 500 });
  }
}

// ─── POST — actions (replay, recover, resolve) ────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { action?: string; id?: string; reference?: string; note?: string };
  try {
    body = await request.json() as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { action, id, reference, note } = body;

  switch (action) {
    case "replay_dead_letter": {
      if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
      const success = await replayDeadLetter(id);
      return NextResponse.json({ success, action: "replay_dead_letter", id });
    }

    case "resolve_dead_letter": {
      if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
      await resolveDeadLetter(id, note);
      return NextResponse.json({ success: true, action: "resolve_dead_letter", id });
    }

    case "recover_payment": {
      if (!reference) return NextResponse.json({ error: "reference is required" }, { status: 400 });
      const result = await recoverPayment(reference);
      return NextResponse.json(result);
    }

    default:
      return NextResponse.json({ error: `Unknown action: ${action ?? ""}` }, { status: 400 });
  }
}
