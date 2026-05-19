/**
 * lib/finance/ledger/reconciliation.ts
 *
 * Ledger Reconciliation.
 *
 * Validates financial integrity: running balances, account consistency,
 * and drift detection. Used by cron jobs and admin health checks.
 *
 * Server-only.
 */

import { CHART_OF_ACCOUNTS, type AccountCode, type AccountType } from "./accounts";
import type { JournalEntry } from "./journal";

export interface AccountBalance {
  accountCode: AccountCode;
  accountName: string;
  accountType: AccountType;
  balance: number;       // positive number
  normalBalance: "debit" | "credit";
}

export interface ReconciliationReport {
  businessId: string;
  periodStart: string;
  periodEnd: string;
  accountBalances: AccountBalance[];
  totalAssets: number;
  totalLiabilities: number;
  totalRevenue: number;
  totalExpenses: number;
  estimatedProfit: number;     // revenue - expenses
  netWorth: number;             // assets - liabilities
  isBalanced: boolean;          // assets ≈ liabilities + equity (within rounding)
  driftAmount: number;          // |assets - (liabilities + equity)|
  transactionCount: number;
  generatedAt: string;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Validates that a string looks like a valid AccountCode in our chart.
 */
function isKnownAccountCode(code: string): code is AccountCode {
  return Object.prototype.hasOwnProperty.call(CHART_OF_ACCOUNTS, code);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Processes all journal lines and computes net balances per account.
 *
 * For debit-normal accounts (assets, expenses): balance = total_debits - total_credits
 * For credit-normal accounts (liabilities, equity, revenue): balance = total_credits - total_debits
 *
 * Returns only accounts that appear in the journal entries.
 */
export function computeAccountBalances(journalEntries: JournalEntry[]): AccountBalance[] {
  // Accumulate raw debit and credit totals per account code
  const totals = new Map<AccountCode, { debits: number; credits: number }>();

  for (const entry of journalEntries) {
    for (const line of entry.lines) {
      if (!isKnownAccountCode(line.accountCode)) continue;

      const current = totals.get(line.accountCode) ?? { debits: 0, credits: 0 };
      totals.set(line.accountCode, {
        debits: current.debits + line.debit,
        credits: current.credits + line.credit,
      });
    }
  }

  const balances: AccountBalance[] = [];

  for (const [code, { debits, credits }] of totals.entries()) {
    const account = CHART_OF_ACCOUNTS[code];
    if (!account) continue;

    const balance =
      account.normalBalance === "debit"
        ? debits - credits
        : credits - debits;

    balances.push({
      accountCode: code,
      accountName: account.name,
      accountType: account.type,
      balance: Math.max(0, balance), // floor at zero; negative signals over-application
      normalBalance: account.normalBalance,
    });
  }

  // Sort by account code for deterministic output
  balances.sort((a, b) => a.accountCode.localeCompare(b.accountCode));

  return balances;
}

/**
 * Generates a full reconciliation report for a business over a given period.
 *
 * The balance equation check is: |assets - (liabilities + equity)| < 1.0 GHS,
 * allowing for minor floating-point / rounding differences.
 */
export function generateReconciliationReport(
  businessId: string,
  journalEntries: JournalEntry[],
  periodStart: string,
  periodEnd: string,
): ReconciliationReport {
  const accountBalances = computeAccountBalances(journalEntries);

  let totalAssets = 0;
  let totalLiabilities = 0;
  let totalEquity = 0;
  let totalRevenue = 0;
  let totalExpenses = 0;

  for (const ab of accountBalances) {
    switch (ab.accountType) {
      case "asset":
        totalAssets += ab.balance;
        break;
      case "liability":
        totalLiabilities += ab.balance;
        break;
      case "equity":
        totalEquity += ab.balance;
        break;
      case "revenue":
        totalRevenue += ab.balance;
        break;
      case "expense":
        totalExpenses += ab.balance;
        break;
    }
  }

  const estimatedProfit = totalRevenue - totalExpenses;
  const netWorth = totalAssets - totalLiabilities;

  // Accounting equation: Assets = Liabilities + Equity
  // Equity includes retained earnings (revenue - expenses) so we add those in.
  const liabilitiesPlusEquity = totalLiabilities + totalEquity + estimatedProfit;
  const driftAmount = Math.abs(totalAssets - liabilitiesPlusEquity);
  const isBalanced = driftAmount < 1.0;

  return {
    businessId,
    periodStart,
    periodEnd,
    accountBalances,
    totalAssets,
    totalLiabilities,
    totalRevenue,
    totalExpenses,
    estimatedProfit,
    netWorth,
    isBalanced,
    driftAmount,
    transactionCount: journalEntries.length,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Inspects a reconciliation report for financial drift and returns a severity
 * classification with a human-readable message.
 *
 * - none   : driftAmount === 0 — perfectly balanced
 * - minor  : 0 < driftAmount < 100 GHS — acceptable rounding/timing difference
 * - major  : driftAmount >= 100 GHS — investigate immediately
 */
export function detectReconciliationDrift(report: ReconciliationReport): {
  hasDrift: boolean;
  severity: "none" | "minor" | "major";
  message: string;
} {
  if (report.driftAmount === 0) {
    return {
      hasDrift: false,
      severity: "none",
      message: "Ledger is perfectly balanced. No drift detected.",
    };
  }

  if (report.driftAmount < 100) {
    return {
      hasDrift: true,
      severity: "minor",
      message: `Minor ledger drift of GHS ${report.driftAmount.toFixed(2)} detected. Likely a rounding or timing difference — monitor over the next reconciliation cycle.`,
    };
  }

  return {
    hasDrift: true,
    severity: "major",
    message: `Major ledger drift of GHS ${report.driftAmount.toFixed(2)} detected for business ${report.businessId}. Immediate investigation required — possible data corruption or missing journal entries.`,
  };
}
