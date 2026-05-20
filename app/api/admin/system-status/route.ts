import { NextResponse, type NextRequest } from "next/server";
import { getSystemHealthReport } from "@/lib/health";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const adminKey   = request.headers.get("x-admin-key") ?? "";
    const cronSecret = process.env.CRON_SECRET ?? "";
    const adminPhone = process.env.ADMIN_PHONE ?? "";

    let authorized = false;

    // Method 1: x-admin-key matches CRON_SECRET
    if (cronSecret && adminKey === cronSecret) {
      authorized = true;
    }

    // Method 2: Firebase auth token contains admin phone
    if (!authorized && adminPhone) {
      const authHeader = request.headers.get("authorization");
      if (authHeader?.startsWith("Bearer ")) {
        try {
          const { verifyAdminToken } = await import("@/lib/firebase/admin");
          const decoded = await verifyAdminToken(authHeader);
          if (decoded) authorized = true;
        } catch {
          // token verification failed
        }
      }
    }

    if (!authorized) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const report = await getSystemHealthReport();
    return NextResponse.json(report, { status: 200 });
  } catch {
    return NextResponse.json(
      { error: "health check failed", status: "unknown" },
      { status: 200 },
    );
  }
}
