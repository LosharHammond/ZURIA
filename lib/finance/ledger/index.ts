/**
 * lib/finance/ledger/index.ts
 *
 * Financial Ledger Engine — main facade.
 *
 * Provides double-entry bookkeeping, journal management,
 * and reconciliation for ZURIA businesses.
 *
 * "Future-proof financial foundation — even if invisible to users today."
 *
 * Server-only.
 */

import { getAdminDb } from "@/lib/firebase/admin";
import type { Transaction } from "@/types/domain";
import { createJournalEntry } from "./journal";
import { generateReconciliationReport } from "./reconciliation";
import type { JournalEntry } from "./journal";
import type { ReconciliationReport } from "./reconciliation";
import { createLogger } from "@/lib/observability/logger";

const logger = createLogger("ledger");

// ─── Firestore collection name ────────────────────────────────────────────────
// journal_entries will be added to collections.ts separately.
const JOURNAL_ENTRIES_COLLECTION = "journal_entries";

// ─── Re-exports ───────────────────────────────────────────────────────────────

export type {
  AccountType,
  AccountCode,
  Account,
} from "./accounts";

export {
  CHART_OF_ACCOUNTS,
  getAccount,
  getAccountsByType,
  getDebitAccounts,
  getCreditAccounts,
} from "./accounts";

export type { JournalLine, JournalEntry } from "./journal";

export { createJournalEntry, validateJournalEntry } from "./journal";

export type { AccountBalance, ReconciliationReport } from "./reconciliation";

export {
  computeAccountBalances,
  generateReconciliationReport,
  detectReconciliationDrift,
} from "./reconciliation";

// ─── Facade functions ─────────────────────────────────────────────────────────

/**
 * Converts a ZURIA Transaction into a double-entry journal entry and
 * persists it to Firestore. Always returns the entry — even if Firestore
 * write fails — so callers can proceed without blocking.
 */
export async function processTransactionToLedger(
  transaction: Transaction,
): Promise<JournalEntry> {
  const entry = createJournalEntry({
    id: transaction.id,
    businessId: transaction.businessId,
    type: transaction.type,
    amount: transaction.amount,
    description: transaction.notes ?? undefined,
    createdAt: transaction.createdAt,
    paymentMethod: transaction.paymentMethod,
  });

  try {
    const db = getAdminDb();
    await db.collection(JOURNAL_ENTRIES_COLLECTION).doc(entry.id).set(entry);
  } catch (err) {
    logger.error("Failed to persist journal entry", {
      entryId: entry.id,
      transactionId: transaction.id,
      error: String(err),
    });
    // Intentionally swallowed — callers always receive the entry.
  }

  return entry;
}

/**
 * Fetches all journal entries for a business since the given ISO date string.
 * Returns an empty array on any error.
 */
export async function getBusinessJournalEntries(
  businessId: string,
  since: string,
): Promise<JournalEntry[]> {
  try {
    const db = getAdminDb();
    const snap = await db
      .collection(JOURNAL_ENTRIES_COLLECTION)
      .where("businessId", "==", businessId)
      .where("date", ">=", since.slice(0, 10))
      .get();

    return snap.docs.map((d) => d.data() as JournalEntry);
  } catch (err) {
    logger.error("Failed to fetch journal entries", { businessId, since, error: String(err) });
    return [];
  }
}

/**
 * Runs a full ledger reconciliation for the given business over the past
 * `periodDays` days (default 30). Returns a zero-filled report on any error.
 */
export async function runReconciliation(
  businessId: string,
  periodDays = 30,
): Promise<ReconciliationReport> {
  const now = new Date();
  const periodEnd = now.toISOString().slice(0, 10);
  const periodStart = new Date(now.getTime() - periodDays * 86_400_000)
    .toISOString()
    .slice(0, 10);

  try {
    const entries = await getBusinessJournalEntries(businessId, periodStart);
    return generateReconciliationReport(businessId, entries, periodStart, periodEnd);
  } catch (err) {
    logger.error("Reconciliation failed", { businessId, periodDays, error: String(err) });

    // Return a zero-filled report so callers never need to handle null/undefined.
    return {
      businessId,
      periodStart,
      periodEnd,
      accountBalances: [],
      totalAssets: 0,
      totalLiabilities: 0,
      totalRevenue: 0,
      totalExpenses: 0,
      estimatedProfit: 0,
      netWorth: 0,
      isBalanced: true,
      driftAmount: 0,
      transactionCount: 0,
      generatedAt: now.toISOString(),
    };
  }
}
