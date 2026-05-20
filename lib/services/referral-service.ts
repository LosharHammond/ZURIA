"use client";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { collections } from "@/lib/firebase/collections";
import type { Referral } from "@/types/domain";
import { createClientLogger } from "@/lib/observability/client-logger";
const logger = createClientLogger("services:referral");

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

// NOTE: creditReferrer has been intentionally removed from this client-side module.
// Referral rewards are a financial operation and MUST only be triggered server-side.
// The sole authoritative trigger is POST /api/welcome (app/api/welcome/route.ts),
// which runs after the user has a valid Firebase ID token and onboarding is complete.
// Any client-side call to credit a referrer would bypass security rules and risk
// double-crediting or fraud. Do not re-add this function here.

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
    const userRef = doc(db, collections.users, userId);
    const snap = await getDoc(userRef);
    if (!snap.exists()) return empty;
    const data = snap.data();

    // Monthly count — reset if stored key doesn't match current month
    const thisMonth = new Date().toISOString().slice(0, 7);
    const storedKey = (data.referralMonthlyResetKey as string | undefined) ?? "";
    const monthlyCount = storedKey === thisMonth
      ? ((data.referralMonthlyCount as number) ?? 0)
      : 0;

    // Self-heal: if the user has no referral code (created before this feature,
    // or a Firestore doc gap), generate one deterministically and save it back.
    // generateReferralCode is a pure hash of userId so it always produces the
    // same code for the same user — safe to call idempotently.
    let code = (data.referralCode as string | undefined) ?? "";
    if (!code) {
      code = generateReferralCode(userId);
      try {
        await updateDoc(userRef, { referralCode: code });
      } catch (writeErr) {
        logger.warn("could not save generated referralCode", { err: String(writeErr) });
      }
    }

    return {
      balance: (data.referralBalance as number) ?? 0,
      count: (data.referralCount as number) ?? 0,
      code,
      monthlyCount,
      referralUnlockExpiresAt: (data.referralUnlockExpiresAt as string | undefined) ?? null,
    };
  } catch (err) {
    logger.error("getReferralStats failed", { err: String(err) });
    return empty;
  }
}
