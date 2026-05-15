"use client";

import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { collections } from "@/lib/firebase/collections";
import type { AppUser, Business } from "@/types/domain";

export async function getAppUser(userId: string): Promise<AppUser | undefined> {
  if (!db) return undefined;
  try {
    const snap = await getDoc(doc(db, collections.users, userId));
    if (!snap.exists()) return undefined;
    const data = snap.data();
    return {
      ...data,
      createdAt: data.createdAt?.toDate?.()?.toISOString() || data.createdAt,
      updatedAt: data.updatedAt?.toDate?.()?.toISOString() || data.updatedAt,
    } as AppUser;
  } catch (err) {
    console.error("[getAppUser]", err);
    return undefined;
  }
}

export async function getBusiness(businessId: string): Promise<Business | undefined> {
  if (!db) return undefined;
  try {
    const snap = await getDoc(doc(db, collections.businesses, businessId));
    if (!snap.exists()) return undefined;
    const data = snap.data();
    return {
      ...data,
      createdAt: data.createdAt?.toDate?.()?.toISOString() || data.createdAt,
      updatedAt: data.updatedAt?.toDate?.()?.toISOString() || data.updatedAt,
    } as Business;
  } catch (err) {
    console.error("[getBusiness]", err);
    return undefined;
  }
}

export async function updateProfile(userId: string, updates: { ownerName?: string; preferredLanguage?: string }) {
  if (!db) throw new Error("Firebase not configured.");
  const { updateDoc } = await import("firebase/firestore");
  await updateDoc(doc(db, collections.users, userId), { ...updates, updatedAt: new Date().toISOString() });
}

export async function updateBusinessProfile(businessId: string, updates: { name?: string; location?: string }) {
  if (!db) throw new Error("Firebase not configured.");
  const { updateDoc } = await import("firebase/firestore");
  await updateDoc(doc(db, collections.businesses, businessId), { ...updates, updatedAt: new Date().toISOString() });
}
