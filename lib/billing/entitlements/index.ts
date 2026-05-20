/**
 * lib/billing/entitlements/index.ts
 *
 * Entitlement verification layer — resolves the feature set a user can access
 * based on their active subscription plan and caches the result in Firestore
 * for fast server-side middleware checks.
 *
 * Server-only: firebase-admin.
 */

import { getAdminDb } from "@/lib/firebase/admin";
import { collections } from "@/lib/firebase/collections";
import { getEffectivePlan } from "@/lib/subscription";
import type { SubscriptionPlan } from "@/types/domain";

// ─── Feature Catalogue ────────────────────────────────────────────────────────

export type Feature =
  | "ai_transactions"        // Record transactions via AI
  | "ai_insights"            // AI-generated business insights
  | "ai_forecasting"         // Cash-flow / sales forecasting
  | "ai_anomaly"             // Unusual pattern detection
  | "ai_coaching"            // Business coach chatbot
  | "ai_reports"             // AI executive reports
  | "ai_advanced_model"      // Access to deepseek advanced model
  | "debt_reminders"         // Auto WhatsApp debt reminders
  | "export_pdf"             // Export reports to PDF
  | "multi_device_sync"      // Sync across devices
  | "staff_accounts"         // Staff permission management
  | "multi_branch"           // Multi-branch management
  | "unlimited_history"      // Unlimited transaction history
  | "invoices"               // Auto-generated invoices
  | "scheduled_reports"      // Scheduled email/WhatsApp reports
  | "api_access";            // API integration access

// Feature sets per plan
const PLAN_FEATURES: Record<SubscriptionPlan, Feature[]> = {
  free: [
    "ai_transactions",
  ],
  growth: [
    "ai_transactions",
    "ai_insights",
    "ai_reports",
    "debt_reminders",
    "export_pdf",
    "multi_device_sync",
    "unlimited_history",
  ],
  pro: [
    "ai_transactions",
    "ai_insights",
    "ai_forecasting",
    "ai_anomaly",
    "ai_coaching",
    "ai_reports",
    "ai_advanced_model",
    "debt_reminders",
    "export_pdf",
    "multi_device_sync",
    "staff_accounts",
    "unlimited_history",
    "invoices",
    "scheduled_reports",
  ],
  enterprise: [
    "ai_transactions",
    "ai_insights",
    "ai_forecasting",
    "ai_anomaly",
    "ai_coaching",
    "ai_reports",
    "ai_advanced_model",
    "debt_reminders",
    "export_pdf",
    "multi_device_sync",
    "staff_accounts",
    "multi_branch",
    "unlimited_history",
    "invoices",
    "scheduled_reports",
    "api_access",
  ],
};

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EntitlementSet {
  userId: string;
  plan: SubscriptionPlan;
  features: Feature[];
  aiDailyLimit: number | null;    // null = unlimited
  aiMonthlyLimit: number | null;  // null = unlimited
  updatedAt: string;
}

// ─── Core Functions ───────────────────────────────────────────────────────────

/**
 * Resolves the feature set for a plan.
 */
export function getFeatureSet(plan: SubscriptionPlan): Feature[] {
  return PLAN_FEATURES[plan] ?? PLAN_FEATURES.free;
}

/**
 * Returns true if the plan has the given feature.
 */
export function planHasFeature(plan: SubscriptionPlan, feature: Feature): boolean {
  return getFeatureSet(plan).includes(feature);
}

/**
 * Returns the AI entry limit for a plan (daily for free, monthly for growth).
 * null = unlimited.
 */
export function getPlanAILimit(plan: SubscriptionPlan): { daily: number | null; monthly: number | null } {
  switch (plan) {
    case "free":       return { daily: 10, monthly: null };
    case "growth":     return { daily: null, monthly: 200 };
    case "pro":        return { daily: null, monthly: null };
    case "enterprise": return { daily: null, monthly: null };
  }
}

// ─── Firestore Cache ──────────────────────────────────────────────────────────

/**
 * Write (or overwrite) the entitlement cache for a user.
 * Called after subscription activation or plan change.
 * Fire-and-forget safe.
 */
export async function refreshEntitlements(
  userId: string,
  plan: SubscriptionPlan,
): Promise<void> {
  try {
    const db     = getAdminDb();
    const limits = getPlanAILimit(plan);
    const entry: EntitlementSet = {
      userId,
      plan,
      features:       getFeatureSet(plan),
      aiDailyLimit:   limits.daily,
      aiMonthlyLimit: limits.monthly,
      updatedAt:      new Date().toISOString(),
    };
    await db.collection(collections.entitlementCache).doc(userId).set(entry);
  } catch {
    // Non-fatal — the live user document is always the source of truth
  }
}

/**
 * Server-side entitlement check. Reads the live user document to avoid
 * stale cache issues.
 *
 * Returns true if the user has the requested feature.
 * Fails open (returns true) on Firestore errors to avoid blocking users.
 */
export async function verifyEntitlement(
  userId: string,
  feature: Feature,
): Promise<boolean> {
  try {
    const db       = getAdminDb();
    const userSnap = await db.collection(collections.users).doc(userId).get();
    if (!userSnap.exists) return false;

    const data   = userSnap.data() ?? {};
    const plan   = getEffectivePlan({
      subscriptionPlan:       data.subscriptionPlan as SubscriptionPlan | undefined,
      subscriptionExpiresAt:  data.subscriptionExpiresAt as string | null | undefined,
      referralUnlockExpiresAt: data.referralUnlockExpiresAt as string | null | undefined,
    });

    return planHasFeature(plan, feature);
  } catch {
    return true; // fail-open
  }
}

/**
 * Get the full entitlement set for a user based on their live plan.
 * Never throws.
 */
export async function getUserEntitlements(userId: string): Promise<EntitlementSet | null> {
  try {
    const db       = getAdminDb();
    const userSnap = await db.collection(collections.users).doc(userId).get();
    if (!userSnap.exists) return null;

    const data = userSnap.data() ?? {};
    const plan = getEffectivePlan({
      subscriptionPlan:        data.subscriptionPlan as SubscriptionPlan | undefined,
      subscriptionExpiresAt:   data.subscriptionExpiresAt as string | null | undefined,
      referralUnlockExpiresAt: data.referralUnlockExpiresAt as string | null | undefined,
    });

    const limits = getPlanAILimit(plan);
    return {
      userId,
      plan,
      features:       getFeatureSet(plan),
      aiDailyLimit:   limits.daily,
      aiMonthlyLimit: limits.monthly,
      updatedAt:      new Date().toISOString(),
    };
  } catch {
    return null;
  }
}
