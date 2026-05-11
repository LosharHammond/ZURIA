import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

// Lazy singleton — initialized on first use, not at module load time.
// This avoids Next.js static-build errors when env vars are absent.
let _db: ReturnType<typeof getFirestore> | null = null;

export function getAdminDb(): ReturnType<typeof getFirestore> {
  if (_db) return _db;

  const existing = getApps().find((a) => a.name === "admin");
  if (existing) {
    _db = getFirestore(existing);
    return _db;
  }

  const projectId =
    process.env.FIREBASE_PROJECT_ID ?? process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  let rawKey = process.env.FIREBASE_PRIVATE_KEY ?? "";

  // Strip surrounding quotes (added by some dotenv parsers for double-quoted values)
  if (rawKey.startsWith('"') && rawKey.endsWith('"')) rawKey = rawKey.slice(1, -1);
  if (rawKey.startsWith("'") && rawKey.endsWith("'")) rawKey = rawKey.slice(1, -1);
  // Replace escaped newlines (literal \n) → real newlines
  // Also normalise Windows CRLF just in case
  const privateKey = rawKey
    .replace(/\\n/g, "\n")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");

  const isConfigured =
    !!clientEmail &&
    !!privateKey &&
    !clientEmail.includes("paste_") &&
    !clientEmail.includes("from Firebase") &&
    privateKey.includes("BEGIN PRIVATE KEY");

  const app = isConfigured
    ? initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) }, "admin")
    : initializeApp({ projectId }, "admin"); // ADC fallback for GCP / emulator

  _db = getFirestore(app);
  return _db;
}

// ─── Token verification helper ────────────────────────────────────────────────

function getAdminApp() {
  const existing = getApps().find((a) => a.name === "admin");
  if (existing) return existing;
  getAdminDb(); // initialize via existing path
  const initialized = getApps().find((a) => a.name === "admin");
  if (!initialized) throw new Error("Firebase Admin SDK failed to initialize. Check FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY.");
  return initialized;
}

/**
 * Verify a Firebase ID token from the `Authorization: Bearer <token>` header.
 * Returns the decoded token (which contains uid, phone_number, etc.) or null.
 */
export async function verifyIdToken(authHeader: string | null) {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  try {
    return await getAuth(getAdminApp()).verifyIdToken(token);
  } catch {
    return null;
  }
}

/**
 * Check if the request bearer token belongs to the admin phone.
 * Returns the decoded token if admin, null otherwise.
 */
export async function verifyAdminToken(authHeader: string | null) {
  const decoded = await verifyIdToken(authHeader);
  if (!decoded) return null;
  const adminPhone = process.env.ADMIN_PHONE ?? "";
  if (!adminPhone || decoded.phone_number !== adminPhone) return null;
  return decoded;
}
