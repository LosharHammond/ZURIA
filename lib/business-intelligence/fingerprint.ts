/**
 * lib/business-intelligence/fingerprint.ts
 *
 * Business fingerprinting system.
 * Creates a unique behavioral signature for each business from transaction
 * patterns. Used for anomaly detection and clustering.
 *
 * Server-only.
 */

import type { Transaction, Debt } from "@/types/domain";
import { REVENUE_TYPES, OPERATING_COST_TYPES } from "@/types/domain";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BusinessFingerprint {
  businessId: string;
  fingerprint: string;  // deterministic hash-like string from behavior
  avgDailyRevenue: number;
  avgTransactionSize: number;
  dominantTransactionType: string;
  debtRatio: number;        // outstanding debt / 30-day revenue
  expenseRatio: number;     // expenses / revenue
  uniqueCustomers: number;
  uniqueSuppliers: number;
  preferredPaymentMethod: string;
  languageProfile: "english" | "pidgin" | "twi" | "mixed";
  anomalyBaseline: {
    maxNormalDailyRevenue: number;  // mean + 2 stddev
    minNormalDailyRevenue: number;  // max(0, mean - 2 stddev)
    maxNormalTransactionAmount: number;
  };
  generatedAt: string;
}

// ─── Language detection keywords ──────────────────────────────────────────────

const PIDGIN_WORDS = [
  "dey", "wahala", "chop", "abeg", "oga", "mama", "no be", "dem", "e don",
  "wey", "them", "make", "naa", "sah",
];

const TWI_WORDS = [
  "cedis", "mepɛ", "ɛyɛ", "akwaaba", "medaase", "dabi", "aane", "kɔ",
  "bra", "fie", "yɛn", "wo", "me", "ɔ",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sumByTypes(txns: Transaction[], types: readonly string[]): number {
  return txns.reduce(
    (acc, t) => (types.includes(t.type) ? acc + t.amount : acc),
    0,
  );
}

function stddev(values: number[], mean: number): number {
  if (values.length === 0) return 0;
  const variance =
    values.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

function detectLanguageProfile(
  transactions: Transaction[],
): BusinessFingerprint["languageProfile"] {
  let pidginHits = 0;
  let twiHits = 0;

  for (const t of transactions) {
    const text = [t.notes, t.rawText, t.productName ?? ""]
      .join(" ")
      .toLowerCase();

    for (const word of PIDGIN_WORDS) {
      if (text.includes(word)) {
        pidginHits++;
        break;
      }
    }

    for (const word of TWI_WORDS) {
      if (text.includes(word)) {
        twiHits++;
        break;
      }
    }
  }

  const total = transactions.length || 1;
  const pidginShare = pidginHits / total;
  const twiShare = twiHits / total;

  if (pidginShare > 0.15 && twiShare > 0.1) return "mixed";
  if (pidginShare > 0.15) return "pidgin";
  if (twiShare > 0.1) return "twi";
  return "english";
}

/**
 * Build a deterministic fingerprint string from behavioral metrics.
 * Not a cryptographic hash — a compact readable signature.
 */
function buildFingerprintString(
  businessId: string,
  avgDailyRevenue: number,
  avgTransactionSize: number,
  dominantType: string,
  debtRatio: number,
  expenseRatio: number,
): string {
  const rev = Math.round(avgDailyRevenue).toString(36).toUpperCase();
  const txnSize = Math.round(avgTransactionSize).toString(36).toUpperCase();
  const dr = Math.round(debtRatio * 100).toString(36).toUpperCase();
  const er = Math.round(expenseRatio * 100).toString(36).toUpperCase();
  const typeCode = dominantType.slice(0, 3).toUpperCase();
  const idSuffix = businessId.slice(-4).toUpperCase();
  return `${idSuffix}-${typeCode}-${rev}-${txnSize}-DR${dr}-ER${er}`;
}

// ─── buildFingerprint ─────────────────────────────────────────────────────────

/**
 * Build a behavioral fingerprint for a business from its transactions and debts.
 * Pure function — no async, no side effects.
 */
export function buildFingerprint(
  businessId: string,
  transactions: Transaction[],
  debts: Debt[],
): BusinessFingerprint {
  const now = Date.now();
  const cutoff30 = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
  const recent = transactions.filter((t) => t.createdAt >= cutoff30);

  // ── Revenue & expenses ──────────────────────────────────────────────────────
  const totalRevenue = sumByTypes(recent, REVENUE_TYPES);
  const totalExpenses = sumByTypes(recent, OPERATING_COST_TYPES);
  const avgDailyRevenue = Math.round((totalRevenue / 30) * 100) / 100;

  // ── Average transaction size ────────────────────────────────────────────────
  const avgTransactionSize =
    recent.length > 0
      ? Math.round((recent.reduce((a, t) => a + t.amount, 0) / recent.length) * 100) / 100
      : 0;

  // ── Dominant transaction type ───────────────────────────────────────────────
  const typeCounts: Record<string, number> = {};
  for (const t of recent) {
    typeCounts[t.type] = (typeCounts[t.type] ?? 0) + 1;
  }
  const dominantTransactionType =
    Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "sale";

  // ── Debt ratio ──────────────────────────────────────────────────────────────
  const totalDebt = debts
    .filter((d) => d.status === "open")
    .reduce((acc, d) => acc + d.outstandingAmount, 0);
  const debtRatio =
    totalRevenue > 0 ? Math.round((totalDebt / totalRevenue) * 1000) / 1000 : 0;

  // ── Expense ratio ───────────────────────────────────────────────────────────
  const expenseRatio =
    totalRevenue > 0
      ? Math.round((totalExpenses / totalRevenue) * 1000) / 1000
      : 0;

  // ── Unique customers & suppliers ───────────────────────────────────────────
  const customers = new Set<string>();
  const suppliers = new Set<string>();

  for (const t of recent) {
    if (
      (t.type === "sale" || t.type === "debt" || t.type === "repayment") &&
      t.customerName
    ) {
      customers.add(t.customerName.toLowerCase().trim());
    }
    if (t.type === "stock_purchase" && t.customerName) {
      suppliers.add(t.customerName.toLowerCase().trim());
    }
  }

  // ── Preferred payment method ────────────────────────────────────────────────
  const methodCounts: Record<string, number> = { cash: 0, momo: 0, bank: 0 };
  for (const t of recent) {
    if (t.paymentMethod && t.paymentMethod !== "unknown") {
      methodCounts[t.paymentMethod] = (methodCounts[t.paymentMethod] ?? 0) + 1;
    }
  }
  const preferredPaymentMethod =
    Object.entries(methodCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "cash";

  // ── Language profile ────────────────────────────────────────────────────────
  const languageProfile = detectLanguageProfile(recent);

  // ── Anomaly baseline from daily revenue distribution ───────────────────────
  // Group revenue by calendar day
  const dailyRevMap: Map<string, number> = new Map();
  for (const t of recent) {
    if (!REVENUE_TYPES.includes(t.type)) continue;
    const day = t.createdAt.slice(0, 10); // "YYYY-MM-DD"
    dailyRevMap.set(day, (dailyRevMap.get(day) ?? 0) + t.amount);
  }

  const dailyRevValues = Array.from(dailyRevMap.values());
  const meanDailyRev =
    dailyRevValues.length > 0
      ? dailyRevValues.reduce((a, b) => a + b, 0) / dailyRevValues.length
      : avgDailyRevenue;
  const sd = stddev(dailyRevValues, meanDailyRev);

  const maxNormalDailyRevenue = Math.round((meanDailyRev + 2 * sd) * 100) / 100;
  const minNormalDailyRevenue = Math.max(
    0,
    Math.round((meanDailyRev - 2 * sd) * 100) / 100,
  );

  // Max normal transaction: mean + 2 stddev of individual transaction amounts
  const revTxnAmounts = recent
    .filter((t) => REVENUE_TYPES.includes(t.type))
    .map((t) => t.amount);
  const txnMean =
    revTxnAmounts.length > 0
      ? revTxnAmounts.reduce((a, b) => a + b, 0) / revTxnAmounts.length
      : 0;
  const txnSd = stddev(revTxnAmounts, txnMean);
  const maxNormalTransactionAmount = Math.round((txnMean + 2 * txnSd) * 100) / 100;

  // ── Fingerprint string ──────────────────────────────────────────────────────
  const fingerprint = buildFingerprintString(
    businessId,
    avgDailyRevenue,
    avgTransactionSize,
    dominantTransactionType,
    debtRatio,
    expenseRatio,
  );

  return {
    businessId,
    fingerprint,
    avgDailyRevenue,
    avgTransactionSize,
    dominantTransactionType,
    debtRatio,
    expenseRatio,
    uniqueCustomers: customers.size,
    uniqueSuppliers: suppliers.size,
    preferredPaymentMethod,
    languageProfile,
    anomalyBaseline: {
      maxNormalDailyRevenue,
      minNormalDailyRevenue,
      maxNormalTransactionAmount,
    },
    generatedAt: new Date().toISOString(),
  };
}

// ─── detectTransactionAnomaly ─────────────────────────────────────────────────

/**
 * Check if a transaction amount is outside the business's normal range.
 */
export function detectTransactionAnomaly(
  amount: number,
  fingerprint: BusinessFingerprint,
): { isAnomaly: boolean; reason: string | null } {
  const max = fingerprint.anomalyBaseline.maxNormalTransactionAmount;

  if (max > 0 && amount > max) {
    return {
      isAnomaly: true,
      reason: `Amount GH₵${amount.toFixed(2)} exceeds normal transaction ceiling of GH₵${max.toFixed(2)}`,
    };
  }

  return { isAnomaly: false, reason: null };
}
