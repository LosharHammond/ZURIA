/**
 * lib/finance/ledger/journal.ts
 *
 * Journal Entry System.
 *
 * Converts ZURIA transactions into double-entry journal entries.
 * Each transaction produces balanced debits and credits.
 *
 * Server-only.
 */

import { CHART_OF_ACCOUNTS, type AccountCode } from "./accounts";

export interface JournalLine {
  accountCode: AccountCode;
  accountName: string;
  debit: number;
  credit: number;
}

export interface JournalEntry {
  id: string;
  transactionId: string;
  businessId: string;
  date: string;        // ISO date string
  description: string;
  lines: JournalLine[];
  totalDebits: number;
  totalCredits: number;
  isBalanced: boolean; // totalDebits === totalCredits
  createdAt: string;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function resolveAccountName(code: AccountCode): string {
  return CHART_OF_ACCOUNTS[code]?.name ?? code;
}

function makeLine(accountCode: AccountCode, debit: number, credit: number): JournalLine {
  return {
    accountCode,
    accountName: resolveAccountName(accountCode),
    debit,
    credit,
  };
}

/**
 * Derives the (debit account, credit account) pair for a given transaction type.
 * Returns a tuple [debitCode, creditCode].
 */
function resolveAccounts(type: string): [AccountCode, AccountCode] {
  switch (type) {
    case "sale":
      return ["1000", "4000"]; // DR Cash / CR Sales Revenue
    case "expense":
    case "cost":
      return ["5100", "1000"]; // DR Operating Expenses / CR Cash
    case "salary":
      return ["5200", "1000"]; // DR Salary Expense / CR Cash
    case "stock_purchase":
      return ["1200", "1000"]; // DR Inventory / CR Cash
    case "debt":
    case "debt_record":
      return ["1100", "4000"]; // DR Accounts Receivable / CR Sales Revenue
    case "debt_payment":
    case "repayment":
      return ["1000", "1100"]; // DR Cash / CR Accounts Receivable
    case "borrow_in":
      return ["1000", "2100"]; // DR Cash / CR Loans Payable
    case "borrow_out":
      return ["1300", "1000"]; // DR Other Assets / CR Cash
    case "income":
      return ["1000", "4100"]; // DR Cash / CR Other Income
    case "tax":
      return ["5500", "1000"]; // DR Other Expenses / CR Cash
    case "investment":
      return ["1000", "3000"]; // DR Cash / CR Owner's Equity
    case "withdrawal":
      return ["3000", "1000"]; // DR Owner's Equity / CR Cash
    default:
      return ["5500", "1000"]; // DR Other Expenses / CR Cash
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Converts a ZURIA transaction into a balanced double-entry journal entry.
 *
 * The entry always has exactly two lines (one debit, one credit) and
 * isBalanced is guaranteed to be true for any valid positive amount.
 */
export function createJournalEntry(transaction: {
  id: string;
  businessId: string;
  type: string;
  amount: number;
  description?: string;
  createdAt: string;
  paymentMethod?: string;
}): JournalEntry {
  const [debitCode, creditCode] = resolveAccounts(transaction.type);
  const amount = Math.abs(transaction.amount);

  const lines: JournalLine[] = [
    makeLine(debitCode, amount, 0),
    makeLine(creditCode, 0, amount),
  ];

  const totalDebits = lines.reduce((sum, l) => sum + l.debit, 0);
  const totalCredits = lines.reduce((sum, l) => sum + l.credit, 0);

  const description =
    transaction.description?.trim() ||
    `${transaction.type} — ${resolveAccountName(debitCode)} / ${resolveAccountName(creditCode)}`;

  return {
    id: `je_${transaction.id}`,
    transactionId: transaction.id,
    businessId: transaction.businessId,
    date: transaction.createdAt.slice(0, 10), // YYYY-MM-DD
    description,
    lines,
    totalDebits,
    totalCredits,
    isBalanced: totalDebits === totalCredits,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Validates a journal entry for structural and financial correctness.
 *
 * Checks:
 *  - isBalanced: debits equal credits
 *  - All line amounts are positive
 *  - No account code appears more than once
 *  - At least two lines exist
 */
export function validateJournalEntry(entry: JournalEntry): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!entry.isBalanced) {
    errors.push(
      `Entry is not balanced: totalDebits=${entry.totalDebits}, totalCredits=${entry.totalCredits}`,
    );
  }

  if (entry.lines.length < 2) {
    errors.push(`Entry must have at least 2 lines, found ${entry.lines.length}.`);
  }

  for (const line of entry.lines) {
    if (line.debit < 0 || line.credit < 0) {
      errors.push(
        `Account ${line.accountCode} has a negative amount (debit=${line.debit}, credit=${line.credit}).`,
      );
    }
    if (line.debit === 0 && line.credit === 0) {
      errors.push(`Account ${line.accountCode} has zero debit and zero credit — line is empty.`);
    }
  }

  const seen = new Set<AccountCode>();
  for (const line of entry.lines) {
    if (seen.has(line.accountCode)) {
      errors.push(`Account ${line.accountCode} appears more than once in the same entry.`);
    }
    seen.add(line.accountCode);
  }

  return { valid: errors.length === 0, errors };
}
