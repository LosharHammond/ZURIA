/**
 * lib/memory/index.ts
 *
 * Memory facade — public API for all ZURIA operational memory operations.
 * Consumers should import from this file rather than the sub-modules directly.
 *
 * SERVER-ONLY — never import from client components.
 */

import {
  getOrRefreshProfile,
  generateInsights,
  type BusinessProfile,
  type OperationalInsight,
} from "./operational-memory";

import {
  loadMemoryContext,
  buildContextSummary,
  type MemoryContext,
} from "./retrieval";

// ─── Public bundle type ───────────────────────────────────────────────────────

export interface MemoryBundle {
  profile: BusinessProfile;
  context: MemoryContext;
  contextSummary: string;
  insights: OperationalInsight[];
}

// ─── Safe defaults ────────────────────────────────────────────────────────────

function safeEmptyProfile(userId: string, businessId: string): BusinessProfile {
  return {
    userId,
    businessId,
    inferredCategory: "unknown",
    categoryConfidence: 0,
    primaryProducts: [],
    primarySuppliers: [],
    primaryCustomers: [],
    averageDailyRevenue: 0,
    averageDailyExpenses: 0,
    topDebtCustomers: [],
    cashFlowPattern: "stable",
    riskLevel: "low",
    preferredPaymentMethod: "cash",
    activeDebtCount: 0,
    totalDebtOutstanding: 0,
    lastUpdated: new Date().toISOString(),
  };
}

function safeEmptyContext(): MemoryContext {
  return {
    lastSupplier: null,
    lastCustomer: null,
    lastProduct: null,
    lastAmount: null,
    lastTransactionType: null,
    recentDebts: [],
    recentTransactions: [],
  };
}

// ─── loadMemory ───────────────────────────────────────────────────────────────

export async function loadMemory(
  userId: string,
  businessId: string,
): Promise<MemoryBundle> {
  let profile: BusinessProfile = safeEmptyProfile(userId, businessId);
  let context: MemoryContext = safeEmptyContext();

  try {
    [profile, context] = await Promise.all([
      getOrRefreshProfile(userId, businessId),
      loadMemoryContext(userId, businessId),
    ]);
  } catch {
    // both already defaulted above; partial failures handled inside each fn
  }

  const insights = generateInsights(profile);
  const contextSummary = buildContextSummary(context, profile);

  return { profile, context, contextSummary, insights };
}

// ─── Re-exports ───────────────────────────────────────────────────────────────

export type { BusinessProfile, OperationalInsight } from "./operational-memory";
export type { MemoryContext } from "./retrieval";
export { resolveReference } from "./retrieval";
export { buildBusinessProfile, saveProfile, inferBusinessCategory } from "./operational-memory";
