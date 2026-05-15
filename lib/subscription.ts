/**
 * Shared subscription utilities — used by client, server, and API routes.
 *
 * IMPORTANT: Runtime-agnostic — no Firebase imports, no Node.js-only APIs.
 * Safe to import from browser components, API routes, and Edge runtime.
 */

import type { SubscriptionPlan } from "@/types/domain";

/**
 * Compute the effective subscription plan for a user.
 *
 * Priority:
 * 1. Active paid plan (subscriptionPlan + valid subscriptionExpiresAt)
 * 2. Referral milestone unlock (30+ referrals this month → Growth features free)
 * 3. "free" fallback
 */
export function getEffectivePlan(user: {
  subscriptionPlan?: SubscriptionPlan;
  subscriptionExpiresAt?: string | null;
  referralUnlockExpiresAt?: string | null;
}): SubscriptionPlan {
  const plan = user.subscriptionPlan ?? "free";
  const now = new Date();

  // 1. Active paid plan?
  if (plan !== "free") {
    const expiresAt = user.subscriptionExpiresAt;
    // No expiry = perpetual (e.g. admin grants), or not yet expired
    if (!expiresAt || new Date(expiresAt) > now) return plan;
  }

  // 2. Referral milestone unlock (30 referrals this month → Growth until month end)
  const unlockExpiry = user.referralUnlockExpiresAt;
  if (unlockExpiry && new Date(unlockExpiry) > now) return "growth";

  return "free";
}

/**
 * Returns true if the user is on a temporary referral unlock (not a paid plan).
 */
export function isOnReferralUnlock(user: {
  subscriptionPlan?: SubscriptionPlan;
  referralUnlockExpiresAt?: string | null;
}): boolean {
  if ((user.subscriptionPlan ?? "free") !== "free") return false;
  const unlockExpiry = user.referralUnlockExpiresAt;
  return !!(unlockExpiry && new Date(unlockExpiry) > new Date());
}

/**
 * Returns the plan expiry date formatted for display.
 */
export function formatPlanExpiry(isoDate?: string | null): string {
  if (!isoDate) return "";
  return new Date(isoDate).toLocaleDateString("en-GH", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/**
 * Returns whole days remaining until a date. Returns 0 if already expired,
 * null if no date is given.
 */
export function daysUntilExpiry(isoDate?: string | null): number | null {
  if (!isoDate) return null;
  const diff = new Date(isoDate).getTime() - Date.now();
  return diff > 0 ? Math.ceil(diff / (1000 * 60 * 60 * 24)) : 0;
}
