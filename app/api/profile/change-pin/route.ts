import { NextResponse } from "next/server";
import { verifyIdToken, getAdminDb } from "@/lib/firebase/admin";
import { collections } from "@/lib/firebase/collections";

export async function POST(req: Request) {
  const decoded = await verifyIdToken(req.headers.get("Authorization"));
  if (!decoded) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { currentPin?: string; newPin?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { currentPin, newPin } = body;
  if (!currentPin || !/^\d{4}$/.test(currentPin) || !newPin || !/^\d{4}$/.test(newPin)) {
    return NextResponse.json({ error: "Both PINs must be exactly 4 digits" }, { status: 400 });
  }

  const db = getAdminDb();
  const snap = await db.collection(collections.users).doc(decoded.uid).get();
  if (!snap.exists) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const stored = snap.data()?.whatsappPin as string | undefined;
  if (!stored || stored !== currentPin) {
    return NextResponse.json({ error: "Current PIN is incorrect" }, { status: 403 });
  }

  await db.collection(collections.users).doc(decoded.uid).update({
    whatsappPin: newPin,
    updatedAt: new Date().toISOString(),
  });

  return NextResponse.json({ ok: true });
}
