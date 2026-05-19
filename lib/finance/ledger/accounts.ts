/**
 * lib/finance/ledger/accounts.ts
 *
 * Chart of Accounts — ZURIA double-entry foundation.
 *
 * Standard double-entry bookkeeping accounts adapted for African SMEs.
 * Currently hidden from users but powers reconciliation, integrity checks,
 * and future integrations (tax, banking, accounting APIs).
 *
 * Server-only.
 */

export type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense";

export type AccountCode =
  | "1000" // Cash
  | "1100" // Accounts Receivable (customer debts)
  | "1200" // Inventory
  | "1300" // Other Assets
  | "2000" // Accounts Payable (supplier debts)
  | "2100" // Loans Payable (borrowed money)
  | "3000" // Owner's Equity
  | "4000" // Sales Revenue
  | "4100" // Other Income
  | "5000" // Cost of Goods Sold
  | "5100" // Operating Expenses
  | "5200" // Salary Expense
  | "5300" // Transport/Logistics
  | "5400" // Utilities
  | "5500"; // Other Expenses

export interface Account {
  code: AccountCode;
  name: string;
  type: AccountType;
  normalBalance: "debit" | "credit"; // debit for assets/expenses, credit for liabilities/equity/revenue
  description: string;
}

export const CHART_OF_ACCOUNTS: Record<AccountCode, Account> = {
  "1000": {
    code: "1000",
    name: "Cash",
    type: "asset",
    normalBalance: "debit",
    description: "Physical cash and mobile money (MoMo) held by the business.",
  },
  "1100": {
    code: "1100",
    name: "Accounts Receivable",
    type: "asset",
    normalBalance: "debit",
    description: "Amounts owed by customers who received goods/services on credit.",
  },
  "1200": {
    code: "1200",
    name: "Inventory",
    type: "asset",
    normalBalance: "debit",
    description: "Goods purchased for resale that are currently in stock.",
  },
  "1300": {
    code: "1300",
    name: "Other Assets",
    type: "asset",
    normalBalance: "debit",
    description: "Money lent to third parties and other miscellaneous assets.",
  },
  "2000": {
    code: "2000",
    name: "Accounts Payable",
    type: "liability",
    normalBalance: "credit",
    description: "Amounts owed to suppliers for goods or services received on credit.",
  },
  "2100": {
    code: "2100",
    name: "Loans Payable",
    type: "liability",
    normalBalance: "credit",
    description: "Money borrowed from individuals, banks, or microfinance institutions.",
  },
  "3000": {
    code: "3000",
    name: "Owner's Equity",
    type: "equity",
    normalBalance: "credit",
    description: "The owner's stake in the business: capital invested minus withdrawals plus retained earnings.",
  },
  "4000": {
    code: "4000",
    name: "Sales Revenue",
    type: "revenue",
    normalBalance: "credit",
    description: "Income from selling goods or services to customers.",
  },
  "4100": {
    code: "4100",
    name: "Other Income",
    type: "revenue",
    normalBalance: "credit",
    description: "Miscellaneous income not classified as direct sales (e.g. commissions, bonuses).",
  },
  "5000": {
    code: "5000",
    name: "Cost of Goods Sold",
    type: "expense",
    normalBalance: "debit",
    description: "Direct cost of the goods sold to customers during a period.",
  },
  "5100": {
    code: "5100",
    name: "Operating Expenses",
    type: "expense",
    normalBalance: "debit",
    description: "Day-to-day costs of running the business such as rent, supplies, and general overhead.",
  },
  "5200": {
    code: "5200",
    name: "Salary Expense",
    type: "expense",
    normalBalance: "debit",
    description: "Wages and salaries paid to employees and workers.",
  },
  "5300": {
    code: "5300",
    name: "Transport/Logistics",
    type: "expense",
    normalBalance: "debit",
    description: "Costs of transporting goods: delivery fees, fuel, vehicle hire.",
  },
  "5400": {
    code: "5400",
    name: "Utilities",
    type: "expense",
    normalBalance: "debit",
    description: "Electricity, water, internet, and other utility bills.",
  },
  "5500": {
    code: "5500",
    name: "Other Expenses",
    type: "expense",
    normalBalance: "debit",
    description: "Miscellaneous expenses not captured in other expense categories (e.g. taxes, fines, sundries).",
  },
};

/**
 * Returns the account for the given code.
 * Throws if the code is not found in the chart of accounts.
 */
export function getAccount(code: AccountCode): Account {
  const account = CHART_OF_ACCOUNTS[code];
  if (!account) {
    throw new Error(`[accounts] Account code "${code}" not found in chart of accounts.`);
  }
  return account;
}

/**
 * Returns all accounts of a given type.
 */
export function getAccountsByType(type: AccountType): Account[] {
  return Object.values(CHART_OF_ACCOUNTS).filter((a) => a.type === type);
}

/**
 * Returns all accounts with a normal debit balance (assets and expenses).
 */
export function getDebitAccounts(): Account[] {
  return Object.values(CHART_OF_ACCOUNTS).filter((a) => a.normalBalance === "debit");
}

/**
 * Returns all accounts with a normal credit balance (liabilities, equity, revenue).
 */
export function getCreditAccounts(): Account[] {
  return Object.values(CHART_OF_ACCOUNTS).filter((a) => a.normalBalance === "credit");
}
