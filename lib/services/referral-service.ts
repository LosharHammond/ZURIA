"use client";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { collections } from "@/lib/firebase/collections";
import { createId } from "@/lib/utils";
import type { Referral } from "@/types/domain";

export const REFERRAL_REWARD = 0.5;           // GHS per successful invite
export const WITHDRAWAL_THRESHOLD = 5.0;     // GHS minimum to request cash out (10 referrals)
export const MILESTONE_REFERRALS = 30;        // referrals this month → Growth features unlocked
export const MILESTONE_BALANCE = MILESTONE_REFERRALS * REFERRAL_REWARD; // GHS 15.00

// ─── Generate a deterministic 6-char code from userId ────────────────────────

export function generateReferralCode(userId: string): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1 to avoid confusion
  let hash = 5381;
  for (let i = 0; i < userId.length; i++) {
    hash = (((hash << 5) + hash) ^ userId.charCodeAt(i)) >>> 0;
  }
  let code = "";
  let n = hash;
  for (let i = 0; i < 6; i++) {
    code += chars[n % chars.length];
    n = Math.floor(n / chars.length);
  }
  return code;
}

// ─── Credit the referrer when a new user completes onboarding ─────────────────
// Returns the referrer's userId if credit succeeded, null otherwise

export async function creditReferrer(
  refCode: string,
  refereeId: string,
  refereePhone: string
): Promise<string | null> {
  if (!db || !refCode) return null;

  // Find the user who owns this referral code
  const q = query(
    collection(db, collections.users),
    where("referralCode", "==", refCode),
    limit(1)
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;

  const referrerDoc = snap.docs[0];
  const referrerId = referrerDoc.id;

  // Don't allow self-referral
  if (referrerId === refereeId) return null;

  // Don't credit twice for the same referee
  const dupQ = query(
    collection(db, collections.referrals),
    where("referrerId", "==", referrerId),
    where("refereeId", "==", refereeId),
    limit(1)
  );
  const dup = await getDocs(dupQ);
  if (!dup.empty) return null;

  // Record the referral
  const refId = createId("ref");
  const now = new Date().toISOString();
  const referral: Referral = {
    id: refId,
    referrerId,
    refereeId,
    refereePhone,
    amount: REFERRAL_REWARD,
    createdAt: now,
  };
  await setDoc(doc(db, collections.referrals, refId), referral);

  // Credit referrer's balance and count
  await updateDoc(doc(db, collections.users, referrerId), {
    referralBalance: increment(REFERRAL_REWARD),
    referralCount: increment(1),
    updatedAt: now,
  });

  return referrerId;
}

// ─── Get all referrals made by a user ────────────────────────────────────────

export async function getUserReferrals(userId: string): Promise<Referral[]> {
  if (!db) return [];
  const q = query(
    collection(db, collections.referrals),
    where("referrerId", "==", userId)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as Referral);
}

// ─── Get fresh referral stats for a user ─────────────────────────────────────

export interface ReferralStats {
  balance: number;
  count: number;
  code: string;
  /** How many referrals the user has made in the current calendar month */
  monthlyCount: number;
  /** ISO date string — when the Growth milestone unlock expires (if active) */
  referralUnlockExpiresAt: string | null;
}

export async function getReferralStats(userId: string): Promise<ReferralStats> {
  const empty: ReferralStats = { balance: 0, count: 0, code: "", monthlyCount: 0, referralUnlockExpiresAt: null };
  if (!db) return empty;
  try {
    const snap = await getDoc(doc(db, collections.users, userId));
    if (!snap.exists()) return empty;
    const data = snap.data();

    // Monthly count — reset if stored key doesn't match current month
    const thisMonth = new Date().toISOString().slice(0, 7);
    const storedKey = (data.referralMonthlyResetKey as string | undefined) ?? "";
    const monthlyCount = storedKey === thisMonth
      ? ((data.referralMonthlyCount as number) ?? 0)
      : 0;

    return {
      balance: (data.referralBalance as number) ?? 0,
      count: (data.referralCount as number) ?? 0,
      code: (data.referralCode as string) ?? "",
      monthlyCount,
      referralUnlockExpiresAt: (data.referralUnlockExpiresAt as string | undefined) ?? null,
    };
  } catch (err) {
    console.error("[getReferralStats]", err);
    return empty;
  }
}
