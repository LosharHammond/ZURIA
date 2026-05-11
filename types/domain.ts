// ─── Business & User ──────────────────────────────────────────────────────────

export type BusinessCategory =
  | "provision"
  | "food"
  | "salon"
  | "barber"
  | "cosmetics"
  | "pharmacy"
  | "restaurant"
  | "spare-parts"
  | "hardware"
  | "momo"
  | "other";

export type PreferredLanguage = "english" | "twi" | "ga" | "ewe" | "hausa" | "fante";

// ─── Transaction Types ─────────────────────────────────────────────────────────
// Every business activity type, from simple sales to enterprise finance

export type TransactionType =
  | "sale"            // Selling goods/services → money in
  | "expense"         // General ad-hoc expense → money out
  | "debt"            // Customer owes you (credit sale, no cash yet)
  | "repayment"       // Customer pays back goods credit → money in
  | "stock_purchase"  // Buying inventory/goods to sell → money out
  | "cost"            // Fixed/recurring costs: rent, utilities → money out
  | "salary"          // Employee wages → money out
  | "tax"             // Tax, levy, GRA, customs → money out
  | "borrow_in"       // You took a loan from someone → money in, creates liability
  | "borrow_out"      // You lent money to someone → money out, creates receivable
  | "loan_repay_out"  // You pay back a loan you took → money out, reduces liability
  | "loan_collect_in" // You collect money you lent → money in, reduces receivable
  | "investment"      // Capital injected into business → money in
  | "withdrawal"      // Owner draws money from business → money out
  | "refund_out"      // You refund a customer → money out
  | "refund_in"       // Supplier/bank refunds you → money in
  | "transfer";       // Move between accounts (neutral, no net cash change)

export type PaymentMethod = "cash" | "momo" | "bank" | "unknown";

export type NotificationKind =
  | "sales_nudge"
  | "debt_reminder"
  | "expense_warning"
  | "low_stock"
  | "loan_due"
  | "summary";

export type SyncStatus = "pending" | "synced" | "failed";

// ─── Money-flow helpers ────────────────────────────────────────────────────────

export const MONEY_IN_TYPES: TransactionType[] = [
  "sale",
  "repayment",
  "borrow_in",
  "loan_collect_in",
  "investment",
  "refund_in",
];

export const MONEY_OUT_TYPES: TransactionType[] = [
  "expense",
  "stock_purchase",
  "cost",
  "salary",
  "tax",
  "borrow_out",
  "loan_repay_out",
  "withdrawal",
  "refund_out",
];

export const REVENUE_TYPES: TransactionType[] = ["sale", "repayment"];
export const OPERATING_COST_TYPES: TransactionType[] = ["expense", "stock_purchase", "cost", "salary", "tax"];
export const FINANCING_IN_TYPES: TransactionType[] = ["borrow_in", "loan_collect_in", "investment", "refund_in"];
export const FINANCING_OUT_TYPES: TransactionType[] = ["borrow_out", "loan_repay_out", "withdrawal", "refund_out"];

// ─── Human labels for each type ───────────────────────────────────────────────

export const TRANSACTION_TYPE_LABELS: Record<TransactionType, string> = {
  sale: "You sold something",
  expense: "You spent money",
  debt: "They owe you (credit)",
  repayment: "They paid you back",
  stock_purchase: "You bought goods",
  cost: "Business bill",
  salary: "Worker pay",
  tax: "Tax / Government levy",
  borrow_in: "You borrowed money",
  borrow_out: "You gave a loan",
  loan_repay_out: "You paid back a loan",
  loan_collect_in: "Got your loan money back",
  investment: "Money put in",
  withdrawal: "Money taken out",
  refund_out: "You gave a refund",
  refund_in: "You got a refund",
  transfer: "Money moved",
};

// ─── User & Business ──────────────────────────────────────────────────────────

export interface AppUser {
  id: string;
  phoneNumber: string;
  ownerName: string;
  businessId?: string;
  onboardingComplete: boolean;
  preferredLanguage: PreferredLanguage;
  referralCode?: string;
  referralBalance?: number;
  referralCount?: number;
  referredBy?: string;
  whatsappPin?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Referral ─────────────────────────────────────────────────────────────────

export interface Referral {
  id: string;
  referrerId: string;
  refereeId: string;
  refereePhone: string;
  amount: number;
  createdAt: string;
}

// ─── Withdrawal ───────────────────────────────────────────────────────────────

export type WithdrawalMethod = "momo" | "bank";
export type WithdrawalNetwork = "MTN" | "Vodafone" | "AirtelTigo";
export type WithdrawalStatus = "pending" | "processing" | "approved" | "rejected" | "failed";

export interface WithdrawalRequest {
  id: string;
  userId: string;
  ownerName: string;
  phoneNumber: string;
  amount: number;
  method: WithdrawalMethod;
  accountNumber: string;
  accountName: string;
  network?: WithdrawalNetwork;
  status: WithdrawalStatus;
  note?: string;
  paystackRecipientCode?: string;
  paystackTransferCode?: string;
  paystackReference?: string;
  createdAt: string;
  processedAt?: string;
}

export interface Business {
  id: string;
  ownerId: string;
  ownerName: string;
  name: string;
  category: BusinessCategory;
  location: string;
  preferredLanguage: PreferredLanguage;
  createdAt: string;
  updatedAt: string;
}

// ─── Transaction ──────────────────────────────────────────────────────────────

export interface Transaction {
  id: string;
  businessId: string;
  userId: string;
  type: TransactionType;
  amount: number;
  quantity: number | null;
  productName: string | null;
  customerName: string | null;
  customerNameNormalized: string | null;
  category: string;
  paymentMethod: PaymentMethod;
  currency: "GHS, Cedis";
  notes: string;
  rawText: string;
  confidence: number;
  createdAt: string;
  synced?: string;
  syncStatus: SyncStatus;
  source: "manual" | "voice" | "imported";
}

// ─── Debt (customer owes you for goods on credit) ─────────────────────────────

export interface Debt {
  id: string;
  businessId: string;
  customerName: string | null;
  originalAmount: number;
  outstandingAmount: number;
  repaymentHistory: DebtRepayment[];
  status: "open" | "paid";
  currency: "GHS, Cedis";
  lastActivityAt: string;
  createdAt: string;
  synced?: string;
  syncStatus: SyncStatus;
}

export interface DebtRepayment {
  id: string;
  amount: number;
  currency: "GHS, Cedis";
  createdAt: string;
  transactionId?: string;
}

// ─── Loan (cash loans: you borrow or you lend) ────────────────────────────────

export interface Loan {
  id: string;
  businessId: string;
  direction: "given" | "taken"; // given = you lent money, taken = you borrowed
  counterpartyName: string | null;
  originalAmount: number;
  outstandingAmount: number;
  repaymentHistory: LoanRepayment[];
  status: "open" | "settled";
  currency: "GHS, Cedis";
  notes: string;
  lastActivityAt: string;
  createdAt: string;
  synced?: string;
  syncStatus: SyncStatus;
}

export interface LoanRepayment {
  id: string;
  amount: number;
  createdAt: string;
  transactionId?: string;
}

// ─── Inventory ────────────────────────────────────────────────────────────────

export interface InventoryItem {
  id: string;
  businessId: string;
  productName: string | null;
  quantity: number | null;
  lowStockThreshold: number;
  currency: "GHS, Cedis";
  updatedAt: string;
  createdAt: string;
  synced?: string;
  syncStatus: SyncStatus;
}

// ─── Daily Summary ────────────────────────────────────────────────────────────

export interface DailySummary {
  id: string;
  businessId: string;
  date: string;
  moneyIn: number;
  moneyOut: number;
  salesRevenue: number;
  operatingCosts: number;
  borrowingsIn: number;
  lendingsOut: number;
  estimatedProfit: number;
  currency: "GHS, Cedis";
  topProduct?: string;
  warning?: string;
  generatedText: string;
  createdAt: string;
  synced?: string;
  syncStatus: SyncStatus;
}

// ─── Smart Notification ───────────────────────────────────────────────────────

export interface SmartNotification {
  id: string;
  businessId: string;
  kind: NotificationKind;
  title: string;
  message: string;
  severity: "info" | "warning" | "success";
  read: boolean;
  createdAt: string;
  synced?: string;
  syncStatus: SyncStatus;
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export interface ChartPoint {
  label: string;
  sales: number;
  expenses: number;
  net: number;
  borrowings: number;
}

export interface DashboardData {
  moneyIn: number;
  moneyOut: number;
  netPosition: number;
  salesToday: number;
  repayments: number;
  expensesToday: number;
  stockCosts: number;
  salaryCosts: number;
  taxCosts: number;
  fixedCosts: number;
  borrowingsIn: number;
  borrowingsOut: number;
  loanRepaymentsOut: number;
  loanCollectionsIn: number;
  investmentsIn: number;
  withdrawalsOut: number;
  refundsIn: number;
  refundsOut: number;
  debtOwed: number;
  loansGiven: number;
  loansTaken: number;
  netReceivables: number;
  netLiabilities: number;
  healthScore: { score: number; trend: "up" | "down" | "stable" };
  currency: "GHS, Cedis";
  recentTransactions: Transaction[];
  chartData: ChartPoint[];
  summary: DailySummary;
  syncStatus: SyncStatus;
}

// ─── Parser output ────────────────────────────────────────────────────────────

export interface ParsedTransaction {
  type: TransactionType;
  amount: number;
  quantity: number | null;
  productName: string | null;
  customerName: string | null;
  customerNameNormalized: string | null;
  currency: "GHS, Cedis";
  category: string;
  paymentMethod: PaymentMethod;
  notes: string;
  confidence: number;
  syncStatus: SyncStatus;
  parserSignals?: string[];
}
