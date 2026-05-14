"use client";

import {
  collection,
  getDocs,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { collections } from "@/lib/firebase/collections";
import type { WithdrawalMethod, WithdrawalNetwork, WithdrawalRequest } from "@/types/domain";

/**
 * @deprecated DO NOT USE — bypasses critical server logic:
 *   - referral balance is NOT deducted
 *   - Paystack transfer is NOT initiated
 *   - Admin notification is NOT sent
 *
 * Use POST /api/referral/withdraw with a Firebase ID token instead.
 * The referrals page already calls the API endpoint directly.
 */
export async function submitWithdrawal(_input: {
  userId: string;
  ownerName: string;
  phoneNumber: string;
  amount: number;
  method: WithdrawalMethod;
  accountNumber: string;
  accountName: string;
  network?: WithdrawalNetwork;
}): Promise<WithdrawalRequest> {
  throw new Error(
    "[submitWithdrawal] This function is deprecated and must not be used. " +
    "Call POST /api/referral/withdraw with Authorization header instead."
  );
}

export async function getUserWithdrawals(userId: string): Promise<WithdrawalRequest[]> {
  if (!db) return [];
  try {
    const q = query(
      collection(db, collections.withdrawals),
      where("userId", "==", userId),
      orderBy("createdAt", "desc")
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as WithdrawalRequest);
  } catch (err) {
    console.error("[getUserWithdrawals]", err);
    return [];
  }
}
