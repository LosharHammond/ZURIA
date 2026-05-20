/**
 * lib/memory/operational-memory.ts
 *
 * Business identity and operational intelligence engine.
 * Infers business profile from transaction patterns stored in Firestore.
 *
 * SERVER-ONLY — never import from client components.
 */

import { getAdminDb } from "@/lib/firebase/admin";
import { collections } from "@/lib/firebase/collections";
import type { BusinessCategory, Transaction, Debt } from "@/types/domain";
import { REVENUE_TYPES, OPERATING_COST_TYPES } from "@/types/domain";

// ─── Public Interfaces ────────────────────────────────────────────────────────

export interface BusinessProfile {
  userId: string;
  businessId: string;
  inferredCategory: BusinessCategory | "unknown";
  categoryConfidence: number; // 0–1
  primaryProducts: string[]; // top 5 product names by frequency
  primarySuppliers: string[]; // recurring supplier names
  primaryCustomers: string[]; // recurring customer names (debt relationships)
  averageDailyRevenue: number; // rolling 7-day average
  averageDailyExpenses: number; // rolling 7-day average
  topDebtCustomers: Array<{ name: string; amount: number }>;
  cashFlowPattern: "stable" | "volatile" | "growing" | "declining";
  riskLevel: "low" | "medium" | "high";
  preferredPaymentMethod: "cash" | "momo" | "bank" | "mixed";
  activeDebtCount: number;
  totalDebtOutstanding: number;
  lastUpdated: string; // ISO timestamp
}

export interface OperationalInsight {
  type: "warning" | "opportunity" | "pattern" | "risk";
  message: string;
  metric?: number;
  timestamp: string;
}

// ─── Category keyword map ─────────────────────────────────────────────────────

const CATEGORY_KEYWORDS: Record<BusinessCategory, string[]> = {
  provision: [
    "bread", "rice", "beans", "tin", "canned", "sugar", "oil", "flour",
    "cereal", "pasta", "milk", "water", "gari", "kenkey", "fufu",
  ],
  food: [
    "waakye", "jollof", "banku", "plantain", "chicken", "fish", "meat",
    "pepper", "tomato", "onion", "vegetable", "stew",
  ],
  pharmacy: [
    "medicine", "tablet", "syrup", "capsule", "drug", "paracetamol",
    "vitamin", "cream", "lotion", "injection",
  ],
  hardware: [
    "nail", "cement", "paint", "rod", "iron", "wire", "wood", "plank",
    "screw", "bolt", "sand", "gravel", "tile",
  ],
  cosmetics: [
    "hair", "weave", "extension", "lace", "wig", "makeup", "lipstick",
    "powder", "perfume", "cream", "lotion", "shea",
  ],
  salon: [
    "relaxer", "treatment", "set", "blow dry", "braid", "trim", "cut",
    "wash", "style",
  ],
  momo: [
    "momo", "mobile money", "transfer", "float", "cash in", "cash out",
  ],
  barber: ["barb", "shave", "fade", "haircut", "clipper"],
  restaurant: ["jollof", "rice", "plate", "food", "lunch", "dinner", "breakfast", "takeaway"],
  "spare-parts": ["part", "spare", "engine", "filter", "belt", "plug", "tyre", "brake", "clutch"],
  other: [],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function emptyProfile(userId: string, businessId: string): BusinessProfile {
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

/** Count frequency of items in an array, return top-N by count. */
function topByFrequency(items: string[], n: number): string[] {
  const freq = new Map<string, number>();
  for (const item of items) {
    const key = item.trim().toLowerCase();
    if (key) freq.set(key, (freq.get(key) ?? 0) + 1);
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([name]) => name);
}

/** Sum amounts for transactions whose type is in the given set. */
function sumByTypes(txns: Transaction[], types: readonly string[]): number {
  return txns.reduce(
    (acc, t) => (types.includes(t.type) ? acc + t.amount : acc),
    0,
  );
}

/** Determine preferred payment method from transactions. */
function inferPaymentMethod(
  txns: Transaction[],
): "cash" | "momo" | "bank" | "mixed" {
  const counts: Record<string, number> = { cash: 0, momo: 0, bank: 0 };
  for (const t of txns) {
    if (t.paymentMethod === "cash") counts.cash++;
    else if (t.paymentMethod === "momo") counts.momo++;
    else if (t.paymentMethod === "bank") counts.bank++;
  }
  const total = counts.cash + counts.momo + counts.bank;
  if (total === 0) return "cash";
  const dominant = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  const dominantShare = dominant[1] / total;
  if (dominantShare >= 0.7) return dominant[0] as "cash" | "momo" | "bank";
  return "mixed";
}

// ─── Pure function: inferBusinessCategory ────────────────────────────────────

export function inferBusinessCategory(productNames: string[]): {
  category: BusinessCategory | "unknown";
  confidence: number;
} {
  if (productNames.length === 0) return { category: "unknown", confidence: 0 };

  const combined = productNames.join(" ").toLowerCase();
  const scores: Partial<Record<BusinessCategory, number>> = {};

  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS) as Array<
    [BusinessCategory, string[]]
  >) {
    if (cat === "other") continue;
    let score = 0;
    for (const kw of keywords) {
      if (combined.includes(kw)) score++;
    }
    if (score > 0) scores[cat] = score;
  }

  if (Object.keys(scores).length === 0) return { category: "unknown", confidence: 0 };

  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]) as Array<
    [BusinessCategory, number]
  >;
  const [topCat, topScore] = sorted[0];
  const totalKeywords = CATEGORY_KEYWORDS[topCat].length;
  const confidence = Math.min(topScore / Math.max(totalKeywords * 0.3, 1), 1);

  return { category: topCat, confidence: Math.round(confidence * 100) / 100 };
}

// ─── buildBusinessProfile ────────────────────────────────────────────────────

export async function buildBusinessProfile(
  userId: string,
  businessId: string,
): Promise<BusinessProfile> {
  try {
    const db = getAdminDb();
    const now = Date.now();
    // 60 days aligns with the spec-mandated free-tier history window.
    // Paid tiers have unlimited history — 60 days is sufficient for profile
    // inference (cash flow pattern, category, top customers, etc.).
    const sixtyDaysAgo   = new Date(now - 60 * 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo   = new Date(now - 7  * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString();

    // ── Fetch transactions (last 60 days, limit 500) ───────────────────────
    const txnSnap = await db
      .collection(collections.transactions)
      .where("businessId", "==", businessId)
      .where("createdAt", ">=", sixtyDaysAgo)
      .orderBy("createdAt", "desc")
      .limit(500)
      .get();

    const transactions = txnSnap.docs.map((d) => d.data() as Transaction);

    // ── Fetch open debts ───────────────────────────────────────────────────
    const debtSnap = await db
      .collection(collections.debts)
      .where("businessId", "==", businessId)
      .where("status", "==", "open")
      .get();

    const debts = debtSnap.docs.map((d) => d.data() as Debt);

    // ── Category inference ─────────────────────────────────────────────────
    const productNames = transactions
      .map((t) => t.productName)
      .filter((p): p is string => p !== null && p.trim() !== "");

    const { category, confidence } = inferBusinessCategory(productNames);

    // ── Top products (sale/stock_purchase) ────────────────────────────────
    const saleProducts = transactions
      .filter((t) => t.type === "sale" || t.type === "stock_purchase")
      .map((t) => t.productName)
      .filter((p): p is string => p !== null && p.trim() !== "");
    const primaryProducts = topByFrequency(saleProducts, 5);

    // ── Primary suppliers: customerName on stock_purchase transactions ─────
    const supplierNames = transactions
      .filter((t) => t.type === "stock_purchase" && t.customerName)
      .map((t) => t.customerName as string);
    const primarySuppliers = topByFrequency(supplierNames, 5);

    // ── Primary customers: customerName on sale/debt transactions ──────────
    const customerNames = transactions
      .filter((t) => (t.type === "sale" || t.type === "debt") && t.customerName)
      .map((t) => t.customerName as string);
    const primaryCustomers = topByFrequency(customerNames, 5);

    // ── Rolling 7-day averages ─────────────────────────────────────────────
    const last7 = transactions.filter((t) => t.createdAt >= sevenDaysAgo);
    const revenue7 = sumByTypes(last7, REVENUE_TYPES);
    const expenses7 = sumByTypes(last7, OPERATING_COST_TYPES);
    const averageDailyRevenue = Math.round((revenue7 / 7) * 100) / 100;
    const averageDailyExpenses = Math.round((expenses7 / 7) * 100) / 100;

    // ── Cash flow pattern: last 7 days vs prev 7 days ─────────────────────
    const prev7 = transactions.filter(
      (t) => t.createdAt >= fourteenDaysAgo && t.createdAt < sevenDaysAgo,
    );
    const prevRevenue7 = sumByTypes(prev7, REVENUE_TYPES);
    const cashFlowPattern = determineCashFlowPattern(revenue7, prevRevenue7, expenses7);

    // ── Debt metrics ───────────────────────────────────────────────────────
    const activeDebtCount = debts.length;
    const totalDebtOutstanding = debts.reduce(
      (acc, d) => acc + d.outstandingAmount,
      0,
    );
    const topDebtCustomers = debts
      .filter((d) => d.customerName !== null)
      .sort((a, b) => b.outstandingAmount - a.outstandingAmount)
      .slice(0, 5)
      .map((d) => ({ name: d.customerName as string, amount: d.outstandingAmount }));

    // ── Risk level ─────────────────────────────────────────────────────────
    const riskLevel = determineRiskLevel(
      totalDebtOutstanding,
      averageDailyRevenue,
      averageDailyExpenses,
      activeDebtCount,
    );

    // ── Preferred payment method ───────────────────────────────────────────
    const preferredPaymentMethod = inferPaymentMethod(transactions);

    return {
      userId,
      businessId,
      inferredCategory: category,
      categoryConfidence: confidence,
      primaryProducts,
      primarySuppliers,
      primaryCustomers,
      averageDailyRevenue,
      averageDailyExpenses,
      topDebtCustomers,
      cashFlowPattern,
      riskLevel,
      preferredPaymentMethod,
      activeDebtCount,
      totalDebtOutstanding,
      lastUpdated: new Date().toISOString(),
    };
  } catch {
    return emptyProfile(userId, businessId);
  }
}

function determineCashFlowPattern(
  revenue7: number,
  prevRevenue7: number,
  expenses7: number,
): "stable" | "volatile" | "growing" | "declining" {
  if (prevRevenue7 === 0 && revenue7 === 0) return "stable";

  const change =
    prevRevenue7 === 0
      ? 1
      : (revenue7 - prevRevenue7) / prevRevenue7;

  if (change > 0.15) return "growing";
  if (change < -0.15) return "declining";

  // Volatile: high expense ratio relative to revenue
  const expenseRatio = revenue7 === 0 ? 1 : expenses7 / revenue7;
  if (expenseRatio > 0.85) return "volatile";

  return "stable";
}

function determineRiskLevel(
  totalDebt: number,
  dailyRevenue: number,
  dailyExpenses: number,
  debtCount: number,
): "low" | "medium" | "high" {
  let riskScore = 0;

  // High debt relative to revenue
  const weeklyRevenue = dailyRevenue * 7;
  if (weeklyRevenue > 0 && totalDebt > weeklyRevenue * 4) riskScore += 2;
  else if (weeklyRevenue > 0 && totalDebt > weeklyRevenue * 2) riskScore += 1;

  // High expense ratio
  if (dailyRevenue > 0 && dailyExpenses / dailyRevenue > 0.9) riskScore += 2;
  else if (dailyRevenue > 0 && dailyExpenses / dailyRevenue > 0.7) riskScore += 1;

  // Many debtors
  if (debtCount > 15) riskScore += 2;
  else if (debtCount > 8) riskScore += 1;

  if (riskScore >= 4) return "high";
  if (riskScore >= 2) return "medium";
  return "low";
}

// ─── getOrRefreshProfile ──────────────────────────────────────────────────────

// "business_profiles" is used as a literal collection name string.
// TODO: add businessProfiles: "business_profiles" to lib/firebase/collections.ts
const BUSINESS_PROFILES_COLLECTION = "business_profiles";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

export async function getOrRefreshProfile(
  userId: string,
  businessId: string,
): Promise<BusinessProfile> {
  try {
    const db = getAdminDb();
    const docRef = db.collection(BUSINESS_PROFILES_COLLECTION).doc(businessId);
    const snap = await docRef.get();

    if (snap.exists) {
      const cached = snap.data() as BusinessProfile;
      const age = Date.now() - new Date(cached.lastUpdated).getTime();
      if (age < CACHE_TTL_MS) return cached;
    }
  } catch {
    // fall through to rebuild
  }

  const fresh = await buildBusinessProfile(userId, businessId);

  // fire-and-forget
  saveProfile(fresh).catch(() => undefined);

  return fresh;
}

// ─── saveProfile ──────────────────────────────────────────────────────────────

export async function saveProfile(profile: BusinessProfile): Promise<void> {
  try {
    const db = getAdminDb();
    await db
      .collection(BUSINESS_PROFILES_COLLECTION)
      .doc(profile.businessId)
      .set(profile, { merge: true });
  } catch {
    // silent
  }
}

// ─── generateInsights ─────────────────────────────────────────────────────────

export function generateInsights(profile: BusinessProfile): OperationalInsight[] {
  const insights: OperationalInsight[] = [];
  const now = new Date().toISOString();

  // Risk: High outstanding debt
  if (
    profile.averageDailyRevenue > 0 &&
    profile.totalDebtOutstanding > profile.averageDailyRevenue * 5
  ) {
    insights.push({
      type: "warning",
      message: `High outstanding debt of GH₵${profile.totalDebtOutstanding.toFixed(2)} — over 5 days' revenue.`,
      metric: profile.totalDebtOutstanding,
      timestamp: now,
    });
  }

  // Warning: Revenue declining
  if (profile.cashFlowPattern === "declining") {
    insights.push({
      type: "warning",
      message: "Revenue has been declining over the past 7 days compared to the previous week.",
      timestamp: now,
    });
  }

  // Risk: Many customers on credit
  if (profile.activeDebtCount > 10) {
    insights.push({
      type: "risk",
      message: `${profile.activeDebtCount} customers currently owe you money. Consider reducing credit sales.`,
      metric: profile.activeDebtCount,
      timestamp: now,
    });
  }

  // Risk: Overall high risk level
  if (profile.riskLevel === "high") {
    insights.push({
      type: "risk",
      message: "Your business risk level is high. Review expenses and outstanding debts urgently.",
      timestamp: now,
    });
  }

  // Return at most 4, highest priority already ordered above
  return insights.slice(0, 4);
}
