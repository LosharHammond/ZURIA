"use client";

import {
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  setDoc,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { collections } from "@/lib/firebase/collections";
import { createId } from "@/lib/utils";
import type { WithdrawalMethod, WithdrawalNetwork, WithdrawalRequest } from "@/types/domain";

export async function submitWithdrawal(input: {
  userId: string;
  ownerName: string;
  phoneNumber: string;
  amount: number;
  method: WithdrawalMethod;
  accountNumber: string;
  accountName: string;
  network?: WithdrawalNetwork;
}): Promise<WithdrawalRequest> {
  if (!db) throw new Error("Firebase not configured.");

  const id = createId("wd");
  const now = new Date().toISOString();
  const request: WithdrawalRequest = {
    id,
    userId: input.userId,
    ownerName: input.ownerName,
    phoneNumber: input.phoneNumber,
    amount: input.amount,
    method: input.method,
    accountNumber: input.accountNumber,
    accountName: input.accountName,
    network: input.network,
    status: "pending",
    createdAt: now,
  };
  await setDoc(doc(db, collections.withdrawals, id), request);
  return request;
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
