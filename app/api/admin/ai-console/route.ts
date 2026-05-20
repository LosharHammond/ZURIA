import { NextResponse, type NextRequest } from "next/server";
import { groqGenerate } from "@/lib/ai/groq";
import { isGroqAvailable } from "@/lib/ai/groq";

const SYSTEM_PROMPT =
  "You are the ZURIA System Intelligence. You have access to operational data and help the admin " +
  "understand system health, AI performance, parser quality, and infrastructure issues. " +
  "Be concise, technical, and operational. Never make up data.";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // Verify admin access
    const adminKey   = request.headers.get("x-admin-key") ?? "";
    const cronSecret = process.env.CRON_SECRET ?? "";
    const adminPhone = process.env.ADMIN_PHONE ?? "";

    let authorized = false;

    // Method 1: x-admin-key header matches CRON_SECRET
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

    // Parse body
    let message       = "";
    let systemContext = "";
    try {
      const body = await request.json() as { message?: unknown; systemContext?: unknown };
      message       = typeof body.message       === "string" ? body.message.trim()       : "";
      systemContext = typeof body.systemContext  === "string" ? body.systemContext.trim() : "";
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    if (!message) {
      return NextResponse.json({ error: "message is required" }, { status: 400 });
    }

    // Build prompt
    const prompt = systemContext
      ? `System context:\n${systemContext}\n\nAdmin query:\n${message}`
      : message;

    const timestamp = new Date().toISOString();

    if (!isGroqAvailable()) {
      return NextResponse.json({
        response:  "Groq is not available. Check GROQ_API_KEY environment variable.",
        model:     "none",
        timestamp,
      });
    }

    const result = await groqGenerate(prompt, {
      model:       "fast",
      maxTokens:   400,
      temperature: 0.4,
      systemPrompt: SYSTEM_PROMPT,
    });

    if (!result) {
      return NextResponse.json({
        response:  "Groq is not available. Check GROQ_API_KEY environment variable.",
        model:     "none",
        timestamp,
      });
    }

    return NextResponse.json({
      response:  result.text,
      model:     result.model,
      timestamp,
      latencyMs: result.latencyMs,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 },
    );
  }
}
