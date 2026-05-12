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

// ─── Subscription ─────────────────────────────────────────────────────────────

/**
 * ZURIA Subscription Plans
 *  free       → Starter Ledger  — 10 AI entries/day, 30-day history
 *  growth     → ZURIA Growth    — GHS 20/month, 200 entries/month
 *  pro        → ZURIA Pro       — GHS 50/month, unlimited
 *  enterprise → ZURIA Enterprise— GHS 100/month, unlimited + multi-branch
 */
export type SubscriptionPlan = "free" | "growth" | "pro" | "enterprise";

export interface SubscriptionTier {
  plan: SubscriptionPlan;
  /** Marketing label shown to users */
  label: string;
  /** Sub-brand name e.g. "ZURIA Growth" */
  brand: string;
  priceGHS: number;
  /**
   * Daily limit for "free", monthly limit for "growth", null = unlimited.
   * The period is stored in the plan itself so callers don't need to branch.
   */
  limitPeriod: "daily" | "monthly" | null;
  messageLimit: number | null;
  features: string[];
  reports: ("daily" | "weekly" | "monthly" | "full_dashboard")[];
}

export const SUBSCRIPTION_TIERS: Record<SubscriptionPlan, SubscriptionTier> = {
  free: {
    plan: "free",
    label: "Starter Ledger",
    brand: "ZURIA Free",
    priceGHS: 0,
    limitPeriod: "daily",
    messageLimit: 10,
    features: [
      "Voice/text transaction recording",
      "AI transaction parsing (Twi, Ga, Hausa, Ewe, Fante, English)",
      "Sales, expense & debt logging",
      "Simple debt tracking",
      "Daily business summary",
      "Weekly SMS-style report",
      "Basic business health score",
      "Low-stock alerts",
      "Offline-first — works without internet",
      "Up to 10 AI entries per day",
      "30-day transaction history",
    ],
    reports: ["daily", "weekly"],
  },
  growth: {
    plan: "growth",
    label: "ZURIA Growth",
    brand: "ZURIA Growth",
    priceGHS: 20,
    limitPeriod: "monthly",
    messageLimit: 200,
    features: [
      "Everything in Starter Ledger",
      "200 AI entries per month",
      "Unlimited voice notes",
      "Smart transaction categorization",
      "Auto debt reminders via WhatsApp",
      "AI-generated sales insights in local language",
      "AI business tips daily",
      "Monthly profit reports",
      "Expense analysis & breakdown",
      "Top-selling products report",
      "Customer debt summaries",
      "Inventory tracking & restock predictions",
      "Low-stock forecasting",
      "Multi-device sync",
      "Export to PDF/Excel",
      "WhatsApp daily summaries",
      "Custom business name & branding",
    ],
    reports: ["daily", "weekly", "monthly"],
  },
  pro: {
    plan: "pro",
    label: "ZURIA Pro",
    brand: "ZURIA Pro",
    priceGHS: 50,
    limitPeriod: null,
    messageLimit: null,
    features: [
      "Everything in ZURIA Growth",
      "Unlimited AI entries",
      "AI detects unusual spending patterns",
      "AI cash-flow forecasting",
      "Predictive business health scoring",
      "AI profit leakage detection",
      "AI recommendations engine",
      "Staff accounts & employee permissions",
      "Activity logs & staff sales tracking",
      "Advanced analytics dashboard",
      "Profit trends & peak sales hours",
      "Expense heatmaps",
      "Debt recovery probability scoring",
      "Customer purchase history & smart insights",
      "Loyal customer tracking",
      "Auto-generated invoices",
      "Smart recurring reminders",
      "Scheduled reports",
      "AI business coach chatbot",
      "Biometric login & cloud backup priority",
    ],
    reports: ["daily", "weekly", "monthly", "full_dashboard"],
  },
  enterprise: {
    plan: "enterprise",
    label: "ZURIA Enterprise",
    brand: "ZURIA Enterprise",
    priceGHS: 100,
    limitPeriod: null,
    messageLimit: null,
    features: [
      "Everything in ZURIA Pro",
      "Multi-branch management",
      "Consolidated analytics & regional dashboards",
      "Branch comparison AI",
      "Executive KPI dashboards",
      "AI growth forecasting",
      "Business valuation estimates",
      "Expansion recommendations",
      "Supplier management & purchase orders",
      "Bulk stock intelligence & supplier debt tracking",
      "Cash-flow simulations",
      "Tax estimation & audit logs",
      "Advanced financial exports",
      "Ask AI anything — natural language queries",
      "Unlimited staff & department roles",
      "Approval systems",
      "POS, MoMo & bank integrations",
      "API access",
      "Dedicated support & onboarding assistance",
      "Data migration service",
    ],
    reports: ["daily", "weekly", "monthly", "full_dashboard"],
  },
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
  referralCount?: number;          // all-time total
  referralMonthlyCount?: number;   // referrals this calendar month
  referralMonthlyResetKey?: string; // "YYYY-MM" — resets each new month
  /**
   * If set and in the future, this user has earned Growth features by
   * referring 30 people in the current calendar month.
   * Expires at midnight on the last day of the month.
   */
  referralUnlockExpiresAt?: string;
  referredBy?: string;
  whatsappPin?: string;
  // ── Subscription ─────────────────────────────────────────────────────────
  subscriptionPlan?: SubscriptionPlan;       // defaults to "free"
  subscriptionExpiresAt?: string | null;     // ISO timestamp; null on free (no expiry)
  /**
   * Message counter for the current period.
   * Free  → resets every calendar day  (reset key = "YYYY-MM-DD")
   * Growth→ resets every calendar month (reset key = "YYYY-MM")
   */
  whatsappMessageCount?: number;
  /** The period key when the counter was last reset. Format depends on plan:
   *  "YYYY-MM-DD" for free (daily reset) | "YYYY-MM" for growth (monthly reset) */
  whatsappMessageResetKey?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Referral ─────────────────────────────────────────────────────────────────

export interface Referral {
  id: string;
  referrerId: string;
  refereeId: string;      // Firebase UID of the new user
  refereePhone: string;   // Phone number of the new user
  amount: number;
  createdAt: string;
}

// ─── Payment claim (persisted when user sends "PAID GROWTH/PRO/ENTERPRISE") ──

export type PaymentClaimStatus = "pending" | "verified" | "rejected";

export interface PaymentClaim {
  id: string;
  userId: string;
  ownerName: string;
  phone: string;
  plan: SubscriptionPlan;
  annual: boolean;
  amount: number;          // GHS amount expected
  status: PaymentClaimStatus;
  businessName: string;
  claimedAt: string;       // ISO timestamp when user sent the claim
  verifiedAt?: string;     // ISO timestamp when admin activated the plan
  verifiedBy?: string;     // Admin UID who activated
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
  source: "manual" | "voice" | "imported" | "system";
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
