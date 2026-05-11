"use client";

import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { collections } from "@/lib/firebase/collections";
import type { AppUser, Business, BusinessCategory, PreferredLanguage } from "@/types/domain";
import { createId } from "@/lib/utils";
import { generateReferralCode, creditReferrer } from "@/lib/services/referral-service";

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

export async function isPhoneRegistered(phoneNumber: string): Promise<boolean> {
  if (!db) return false;
  const { collection, getDocs, query, where, limit } = await import("firebase/firestore");
  const q = query(collection(db, "users"), where("phoneNumber", "==", phoneNumber), where("onboardingComplete", "==", true), limit(1));
  const snap = await getDocs(q);
  return !snap.empty;
}

export async function saveOnboarding(input: {
  userId: string;
  phoneNumber: string;
  ownerName: string;
  businessName: string;
  category: BusinessCategory;
  location: string;
  preferredLanguage: PreferredLanguage;
  whatsappPin: string;
  referralCode?: string;  // code from the person who invited them
}) {
  if (!db) throw new Error("Firebase is not configured. Add .env.local values from .env.example.");
  const now = new Date().toISOString();
  const businessId = createId("business");
  const business: Business = {
    id: businessId,
    ownerId: input.userId,
    ownerName: input.ownerName,
    name: input.businessName,
    category: input.category,
    location: input.location,
    preferredLanguage: input.preferredLanguage,
    createdAt: now,
    updatedAt: now
  };
  const myReferralCode = generateReferralCode(input.userId);
  const user: AppUser = {
    id: input.userId,
    phoneNumber: input.phoneNumber,
    ownerName: input.ownerName,
    businessId,
    onboardingComplete: true,
    preferredLanguage: input.preferredLanguage,
    referralCode: myReferralCode,
    referralBalance: 0,
    referralCount: 0,
    createdAt: now,
    updatedAt: now
  };
  const userWithPin = { ...user, whatsappPin: input.whatsappPin };
  await Promise.all([
    setDoc(doc(db, collections.businesses, businessId), { ...business, serverCreatedAt: serverTimestamp() }),
    setDoc(doc(db, collections.users, input.userId), { ...userWithPin, serverUpdatedAt: serverTimestamp() }, { merge: true })
  ]);

  // Credit the person who referred this user (non-blocking)
  if (input.referralCode) {
    creditReferrer(input.referralCode, input.userId, input.phoneNumber).catch(() => {});
  }

  return { user, business };
}

export async function updateProfile(userId: string, updates: { ownerName?: string; whatsappPin?: string; preferredLanguage?: string }) {
  if (!db) throw new Error("Firebase not configured.");
  const { updateDoc } = await import("firebase/firestore");
  await updateDoc(doc(db, collections.users, userId), { ...updates, updatedAt: new Date().toISOString() });
}

export async function updateBusinessProfile(businessId: string, updates: { name?: string; location?: string }) {
  if (!db) throw new Error("Firebase not configured.");
  const { updateDoc } = await import("firebase/firestore");
  await updateDoc(doc(db, collections.businesses, businessId), { ...updates, updatedAt: new Date().toISOString() });
}
