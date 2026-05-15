import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyIdToken, getAdminDb } from "@/lib/firebase/admin";
import { collections } from "@/lib/firebase/collections";
import { hashPin, verifyPin } from "@/lib/security/pin";

export const dynamic = "force-dynamic";

const PinSchema = z.object({
  currentPin: z.string().regex(/^\d{4}$/, "PIN must be exactly 4 digits"),
  newPin:     z.string().regex(/^\d{4}$/, "PIN must be exactly 4 digits"),
}).refine((d) => d.currentPin !== d.newPin, {
  message: "New PIN must be different from current PIN",
  path: ["newPin"],
});

export async function POST(req: Request) {
  const decoded = await verifyIdToken(req.headers.get("Authorization"));
  if (!decoded) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = PinSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 422 }
    );
  }

  const { currentPin, newPin } = parsed.data;

  const db = getAdminDb();
  const snap = await db.collection(collections.users).doc(decoded.uid).get();
  if (!snap.exists) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const stored = snap.data()?.whatsappPin as string | undefined;
  const pinCheck = verifyPin(currentPin, stored);
  if (!pinCheck.valid) {
    return NextResponse.json({ error: "Current PIN is incorrect" }, { status: 403 });
  }

  await db.collection(collections.users).doc(decoded.uid).update({
    whatsappPin: hashPin(newPin),
    updatedAt: new Date().toISOString(),
  });

  return NextResponse.json({ ok: true });
}
