import { NextResponse } from "next/server";
import { verifyIdToken } from "@/lib/firebase/admin";
import { createSessionCookieValue } from "@/lib/server/session-cookie";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const decoded = await verifyIdToken(req.headers.get("Authorization"));
  if (!decoded) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { value, maxAge } = createSessionCookieValue(decoded.uid);
  const res = NextResponse.json({ ok: true });
  res.cookies.set("zuria_auth", value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge,
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set("zuria_auth", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
  return res;
}
