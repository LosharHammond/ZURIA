import { getAdminDb } from "@/lib/firebase/admin";
import { collections } from "@/lib/firebase/collections";

// ─── WhatsApp session document ────────────────────────────────────────────────
// Stored at whatsapp_sessions/{normalizedPhone}

export interface WaSession {
  phone: string;
  businessId: string;
  userId: string;
  ownerName: string;
  state: "pending_pin" | "active" | "locked";
  failedAttempts: number;
  verifiedAt: string | null;    // ISO — when last PIN was accepted
  expiresAt: string | null;     // ISO — session valid until
  lockedAt: string | null;
  lastMessageAt: string;
  lastSenderPhone?: string;     // tracks which phone last sent a message in this session
}

const SESSION_TTL_HOURS = 24;
const MAX_FAILED = 3;

// ─── Read / create session ────────────────────────────────────────────────────

export async function getOrCreateSession(
  phone: string,
  businessId: string,
  userId: string,
  ownerName: string
): Promise<WaSession> {
  const db = getAdminDb();
  const ref = db.collection(collections.whatsappSessions).doc(phone);
  const snap = await ref.get();
  const now = new Date().toISOString();

  if (snap.exists) {
    const s = snap.data() as WaSession;
    await ref.update({ lastMessageAt: now });

    // Reset locked session after 1 hour
    if (s.state === "locked" && s.lockedAt) {
      const lockedMs = Date.now() - new Date(s.lockedAt).getTime();
      if (lockedMs > 60 * 60 * 1000) {
        const reset: Partial<WaSession> = { state: "pending_pin", failedAttempts: 0, lockedAt: null, lastMessageAt: now };
        await ref.update(reset);
        return { ...s, ...reset } as WaSession;
      }
    }
    return { ...s, lastMessageAt: now };
  }

  // New session — start in pending_pin
  const session: WaSession = {
    phone,
    businessId,
    userId,
    ownerName,
    state: "pending_pin",
    failedAttempts: 0,
    verifiedAt: null,
    expiresAt: null,
    lockedAt: null,
    lastMessageAt: now,
  };
  await ref.set(session);
  return session;
}

// ─── Check if session is valid (active + not expired) ────────────────────────

export function isSessionActive(session: WaSession): boolean {
  if (session.state !== "active") return false;
  if (!session.expiresAt) return false;
  return new Date(session.expiresAt) > new Date();
}

// ─── Verify PIN ───────────────────────────────────────────────────────────────

export async function verifyPin(
  session: WaSession,
  enteredPin: string,
  storedPin: string
): Promise<{ ok: boolean; locked: boolean; attemptsLeft: number }> {
  const db = getAdminDb();
  const ref = db.collection(collections.whatsappSessions).doc(session.phone);
  const now = new Date().toISOString();

  if (enteredPin === storedPin) {
    const expiry = new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000).toISOString();
    await ref.update({ state: "active", failedAttempts: 0, verifiedAt: now, expiresAt: expiry });
    return { ok: true, locked: false, attemptsLeft: MAX_FAILED };
  }

  const newFails = session.failedAttempts + 1;
  if (newFails >= MAX_FAILED) {
    await ref.update({ state: "locked", failedAttempts: newFails, lockedAt: now });
    return { ok: false, locked: true, attemptsLeft: 0 };
  }

  await ref.update({ failedAttempts: newFails });
  return { ok: false, locked: false, attemptsLeft: MAX_FAILED - newFails };
}

// ─── Force expire session (suspicious activity) ───────────────────────────────

export async function expireSession(phone: string): Promise<void> {
  const db = getAdminDb();
  await db.collection(collections.whatsappSessions).doc(phone).update({
    state: "pending_pin",
    failedAttempts: 0,
    expiresAt: null,
    verifiedAt: null,
  });
}

// ─── Suspicious activity detection ───────────────────────────────────────────
// Compares the incoming phone against the last recorded sender stored on the
// session document — no composite index required.

export function isSuspiciousActivity(session: WaSession, fromPhone: string): boolean {
  if (!session.lastSenderPhone) return false;
  return session.lastSenderPhone !== fromPhone;
}

// ─── Record which phone sent the current message ──────────────────────────────

export async function stampSenderPhone(phone: string, senderPhone: string): Promise<void> {
  await getAdminDb()
    .collection(collections.whatsappSessions)
    .doc(phone)
    .update({ lastSenderPhone: senderPhone });
}
