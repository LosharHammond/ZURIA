import type { BusinessCategory, PreferredLanguage, TransactionType } from "@/types/domain";

export const BUSINESS_CATEGORIES: { value: BusinessCategory; label: string }[] = [
  { value: "provision", label: "Provision shop" },
  { value: "food", label: "Food / market stall" },
  { value: "salon", label: "Salon" },
  { value: "barber", label: "Barber shop" },
  { value: "cosmetics", label: "Cosmetics" },
  { value: "pharmacy", label: "Pharmacy" },
  { value: "restaurant", label: "Restaurant" },
  { value: "spare-parts", label: "Spare parts" },
  { value: "hardware", label: "Hardware" },
  { value: "momo", label: "Mobile money vendor" },
  { value: "other", label: "Other business" },
];

export const LANGUAGES: { value: PreferredLanguage; label: string }[] = [
  { value: "english", label: "English" },
  { value: "twi", label: "Twi" },
  { value: "ga", label: "Ga" },
  { value: "ewe", label: "Ewe" },
  { value: "hausa", label: "Hausa" },
  { value: "fante", label: "Fante" },
];

export const GHANA_CEDI = new Intl.NumberFormat("en-GH", {
  style: "currency",
  currency: "GHS",
  maximumFractionDigits: 0,
});

// ─── Transaction type groupings for UI ───────────────────────────────────────

export const TRANSACTION_TYPE_GROUPS: { label: string; types: TransactionType[] }[] = [
  {
    label: "Revenue",
    types: ["sale", "repayment"],
  },
  {
    label: "Expenses",
    types: ["expense", "stock_purchase", "cost", "salary", "tax"],
  },
  {
    label: "Customer Credit",
    types: ["debt", "repayment"],
  },
  {
    label: "Loans & Borrowing",
    types: ["borrow_in", "borrow_out", "loan_repay_out", "loan_collect_in"],
  },
  {
    label: "Capital",
    types: ["investment", "withdrawal"],
  },
  {
    label: "Refunds & Transfers",
    types: ["refund_in", "refund_out", "transfer"],
  },
];

// ─── Category display colors ─────────────────────────────────────────────────

export const CATEGORY_COLORS: Record<string, string> = {
  sales: "#10b981",
  "debt collection": "#10b981",
  inventory: "#8b5cf6",
  "general expense": "#f43f5e",
  utilities: "#f59e0b",
  rent: "#f59e0b",
  transport: "#f59e0b",
  staff: "#3b82f6",
  tax: "#ef4444",
  tithe: "#a855f7",
  financing: "#0ea5e9",
  equity: "#14b8a6",
  refunds: "#6366f1",
  transfer: "#64748b",
  "mobile money": "#f97316",
  banking: "#0ea5e9",
  "customer credit": "#fbbf24",
  operations: "#94a3b8",
};
