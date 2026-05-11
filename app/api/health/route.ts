import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// GET /api/health — deployment health check
// Used by hosting platforms, uptime monitors, and CI/CD pipelines.
export async function GET() {
  const checks = {
    status: "ok",
    timestamp: new Date().toISOString(),
    env: {
      firebase: !!process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      firebaseAdmin: !!process.env.FIREBASE_CLIENT_EMAIL,
      twilio: !!process.env.TWILIO_ACCOUNT_SID,
      waNumber: !!process.env.NEXT_PUBLIC_WA_NUMBER,
      paystack: !!process.env.PAYSTACK_SECRET_KEY,
      adminPhone: !!process.env.ADMIN_PHONE,
    },
  };

  const allCriticalOk =
    checks.env.firebase &&
    checks.env.firebaseAdmin &&
    checks.env.twilio &&
    checks.env.waNumber;
  const httpStatus = allCriticalOk ? 200 : 503;

  return NextResponse.json(checks, { status: httpStatus });
}
