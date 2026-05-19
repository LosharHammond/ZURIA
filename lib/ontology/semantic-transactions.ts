/**
 * ZURIA Semantic Transaction Ontology
 *
 * Canonical intent mapping and business vocabulary for African SME contexts.
 * Resolves user messages to structured intents used by the routing engine.
 */

import type { TransactionType } from "@/types/domain";

// ─── Semantic Intent ──────────────────────────────────────────────────────────

export type SemanticIntent =
  | "sale"
  | "expense"
  | "customer_debt"
  | "partial_repayment"
  | "full_repayment"
  | "payroll"
  | "inventory_purchase"
  | "inventory_loss"
  | "supplier_payment"
  | "utility_expense"
  | "logistics_expense"
  | "operational_expense"
  | "transfer"
  | "refund"
  | "spoilage"
  | "investment"
  | "withdrawal"
  | "stock_depletion"
  | "operational_stress_signal"
  | "query_balance"
  | "query_debts"
  | "query_inventory"
  | "query_report";

// ─── Ontology Entry ───────────────────────────────────────────────────────────

export interface OntologyEntry {
  canonicalIntent: SemanticIntent;
  transactionType: TransactionType | "none";
  phrases: string[];
  contextSignals: string[];
  antiPatterns: string[];
  isMoneyIn: boolean;
  isMoneyOut: boolean;
  requiresAmount: boolean;
  requiresEntity: boolean;
  isQuery: boolean;
}

// ─── Full Ontology ────────────────────────────────────────────────────────────

export const ONTOLOGY: OntologyEntry[] = [
  // ── 1. Sale ─────────────────────────────────────────────────────────────────
  {
    canonicalIntent: "sale",
    transactionType: "sale",
    phrases: [
      "sold", "i sell", "i sold", "customer pay", "customer paid",
      "sold rice", "sold goods", "made a sale", "cash sale", "sell",
      "customer buy", "customer bought", "i make sale", "collected cash",
    ],
    contextSignals: ["customer", "cash", "momo", "bank", "paid", "buy"],
    antiPatterns: ["on credit", "owes", "borrow", "owe me"],
    isMoneyIn: true,
    isMoneyOut: false,
    requiresAmount: true,
    requiresEntity: false,
    isQuery: false,
  },

  // ── 2. Expense ───────────────────────────────────────────────────────────────
  {
    canonicalIntent: "expense",
    transactionType: "expense",
    phrases: [
      "bought", "paid for", "expense", "spent", "i pay",
      "i paid", "used money for", "spent on", "bought something",
      "paid something", "my expense",
    ],
    contextSignals: ["fuel", "water", "transport", "food", "cost", "spend"],
    antiPatterns: ["customer", "sold", "salary", "worker", "ECG", "electricity"],
    isMoneyIn: false,
    isMoneyOut: true,
    requiresAmount: true,
    requiresEntity: false,
    isQuery: false,
  },

  // ── 3. Customer Debt ─────────────────────────────────────────────────────────
  {
    canonicalIntent: "customer_debt",
    transactionType: "debt",
    phrases: [
      "owes me", "on credit", "take am", "borrow goods", "gave on credit",
      "took on credit", "customer take", "sell on credit", "credit sale",
      "they owe", "gave credit", "promised to pay", "take am on credit",
      "customer borrow", "carry go pay later",
    ],
    contextSignals: ["credit", "owe", "later", "promise", "tomorrow"],
    antiPatterns: ["paid", "cleared", "repay", "pay back"],
    isMoneyIn: false,
    isMoneyOut: false,
    requiresAmount: true,
    requiresEntity: true,
    isQuery: false,
  },

  // ── 4. Partial Repayment ─────────────────────────────────────────────────────
  {
    canonicalIntent: "partial_repayment",
    transactionType: "repayment",
    phrases: [
      "paid part", "gave small", "part payment", "paid small",
      "clear small", "ama clear small", "pay small", "part pay",
      "partial payment", "gave me some", "bring small", "brought small",
    ],
    contextSignals: ["part", "small", "some", "partial", "little"],
    antiPatterns: ["everything", "all", "fully", "complete", "total"],
    isMoneyIn: true,
    isMoneyOut: false,
    requiresAmount: true,
    requiresEntity: true,
    isQuery: false,
  },

  // ── 5. Full Repayment ────────────────────────────────────────────────────────
  {
    canonicalIntent: "full_repayment",
    transactionType: "repayment",
    phrases: [
      "paid everything", "cleared all", "paid back fully", "clear all",
      "paid full", "paid complete", "paid off", "fully paid",
      "cleared debt", "finished paying", "complete payment", "paid all",
      "settle everything", "closed debt",
    ],
    contextSignals: ["everything", "all", "full", "complete", "total", "cleared"],
    antiPatterns: ["small", "part", "some", "little", "partial"],
    isMoneyIn: true,
    isMoneyOut: false,
    requiresAmount: false,
    requiresEntity: true,
    isQuery: false,
  },

  // ── 6. Payroll ───────────────────────────────────────────────────────────────
  {
    canonicalIntent: "payroll",
    transactionType: "salary",
    phrases: [
      "paid salary", "worker pay", "staff pay", "paid workers",
      "employee salary", "pay staff", "gave salary", "workers paid",
      "pay worker", "gave worker money", "paid employee",
    ],
    contextSignals: ["salary", "worker", "staff", "employee", "monthly"],
    antiPatterns: ["customer", "supplier", "rent"],
    isMoneyIn: false,
    isMoneyOut: true,
    requiresAmount: true,
    requiresEntity: false,
    isQuery: false,
  },

  // ── 7. Inventory Purchase ────────────────────────────────────────────────────
  {
    canonicalIntent: "inventory_purchase",
    transactionType: "stock_purchase",
    phrases: [
      "stocked up", "bought goods", "received stock", "got delivery",
      "bought stock", "restock", "buy goods", "purchased goods",
      "brought goods", "ordered goods", "bought items", "got stock",
    ],
    contextSignals: ["stock", "goods", "delivery", "supplier", "restock"],
    antiPatterns: ["sold", "customer", "salary"],
    isMoneyIn: false,
    isMoneyOut: true,
    requiresAmount: true,
    requiresEntity: false,
    isQuery: false,
  },

  // ── 8. Inventory Loss ────────────────────────────────────────────────────────
  {
    canonicalIntent: "inventory_loss",
    transactionType: "expense",
    phrases: [
      "damaged", "expired", "spoiled", "missing stock", "broken",
      "goods spoil", "lost goods", "items missing", "stock missing",
      "product damaged", "food go bad", "bread spoil",
    ],
    contextSignals: ["damaged", "missing", "spoiled", "expired", "broken"],
    antiPatterns: ["sold", "bought", "customer"],
    isMoneyIn: false,
    isMoneyOut: true,
    requiresAmount: false,
    requiresEntity: false,
    isQuery: false,
  },

  // ── 9. Supplier Payment ──────────────────────────────────────────────────────
  {
    canonicalIntent: "supplier_payment",
    transactionType: "expense",
    phrases: [
      "paid supplier", "pay supplier", "gave supplier money",
      "settled supplier", "paid vendor", "pay vendor",
      "bought from supplier", "supplier payment",
    ],
    contextSignals: ["supplier", "vendor", "wholesale", "distributor"],
    antiPatterns: ["customer", "salary", "ECG"],
    isMoneyIn: false,
    isMoneyOut: true,
    requiresAmount: true,
    requiresEntity: true,
    isQuery: false,
  },

  // ── 10. Utility Expense ──────────────────────────────────────────────────────
  {
    canonicalIntent: "utility_expense",
    transactionType: "cost",
    phrases: [
      "ECG", "water bill", "electricity", "pay light bill",
      "paid electricity", "paid water", "paid ECG", "light bill",
      "internet bill", "utility bill", "GWCL", "pay water",
    ],
    contextSignals: ["electricity", "water", "light", "internet", "bill"],
    antiPatterns: ["sold", "customer", "salary"],
    isMoneyIn: false,
    isMoneyOut: true,
    requiresAmount: true,
    requiresEntity: false,
    isQuery: false,
  },

  // ── 11. Logistics Expense ────────────────────────────────────────────────────
  {
    canonicalIntent: "logistics_expense",
    transactionType: "expense",
    phrases: [
      "transport", "fuel", "delivery cost", "rider pay",
      "paid driver", "car fuel", "motorbike fuel", "shipping cost",
      "delivery fee", "car wash", "vehicle repair",
    ],
    contextSignals: ["transport", "fuel", "delivery", "driver", "rider", "vehicle"],
    antiPatterns: ["customer", "salary"],
    isMoneyIn: false,
    isMoneyOut: true,
    requiresAmount: true,
    requiresEntity: false,
    isQuery: false,
  },

  // ── 12. Operational Expense ──────────────────────────────────────────────────
  {
    canonicalIntent: "operational_expense",
    transactionType: "expense",
    phrases: [
      "rent", "paid rent", "maintenance", "repair", "cleaning",
      "supplies", "office cost", "running cost", "operational cost",
    ],
    contextSignals: ["rent", "repair", "maintenance", "operational"],
    antiPatterns: ["customer", "salary", "ECG"],
    isMoneyIn: false,
    isMoneyOut: true,
    requiresAmount: true,
    requiresEntity: false,
    isQuery: false,
  },

  // ── 13. Transfer ─────────────────────────────────────────────────────────────
  {
    canonicalIntent: "transfer",
    transactionType: "transfer",
    phrases: [
      "transfer", "send momo", "send money", "moved money",
      "sent to account", "bank transfer", "momo transfer",
    ],
    contextSignals: ["transfer", "send", "momo", "bank"],
    antiPatterns: ["customer", "sold", "expense"],
    isMoneyIn: false,
    isMoneyOut: false,
    requiresAmount: true,
    requiresEntity: false,
    isQuery: false,
  },

  // ── 14. Refund ───────────────────────────────────────────────────────────────
  {
    canonicalIntent: "refund",
    transactionType: "refund_out",
    phrases: [
      "refunded", "gave back money", "returned money", "customer refund",
      "took back goods", "reversed payment", "paid back customer",
    ],
    contextSignals: ["refund", "return", "reverse", "back"],
    antiPatterns: ["salary", "ECG", "transport"],
    isMoneyIn: false,
    isMoneyOut: true,
    requiresAmount: true,
    requiresEntity: false,
    isQuery: false,
  },

  // ── 15. Spoilage ─────────────────────────────────────────────────────────────
  {
    canonicalIntent: "spoilage",
    transactionType: "expense",
    phrases: [
      "food spoil", "items spoil", "perishable gone bad", "waste",
      "throwaway", "throw away goods", "spoilage", "goods rotten",
    ],
    contextSignals: ["spoil", "waste", "rotten", "bad"],
    antiPatterns: ["sold", "customer"],
    isMoneyIn: false,
    isMoneyOut: true,
    requiresAmount: false,
    requiresEntity: false,
    isQuery: false,
  },

  // ── 16. Investment ───────────────────────────────────────────────────────────
  {
    canonicalIntent: "investment",
    transactionType: "investment",
    phrases: [
      "invested", "put money in business", "capital injection",
      "business investment", "added capital", "personal money added",
    ],
    contextSignals: ["invest", "capital", "inject", "own money"],
    antiPatterns: ["customer", "sold", "expense"],
    isMoneyIn: true,
    isMoneyOut: false,
    requiresAmount: true,
    requiresEntity: false,
    isQuery: false,
  },

  // ── 17. Withdrawal ───────────────────────────────────────────────────────────
  {
    canonicalIntent: "withdrawal",
    transactionType: "withdrawal",
    phrases: [
      "withdrew", "took from business", "took money out",
      "personal withdrawal", "take from shop", "drew cash",
    ],
    contextSignals: ["withdraw", "take out", "personal"],
    antiPatterns: ["customer", "sold", "expense", "salary"],
    isMoneyIn: false,
    isMoneyOut: true,
    requiresAmount: true,
    requiresEntity: false,
    isQuery: false,
  },

  // ── 18. Stock Depletion ──────────────────────────────────────────────────────
  {
    canonicalIntent: "stock_depletion",
    transactionType: "none",
    phrases: [
      "sold out", "stock finish", "ran out", "empty",
      "no more goods", "finish", "stock don finish", "nothing left",
    ],
    contextSignals: ["finish", "out", "empty", "none", "sold out"],
    antiPatterns: ["sold", "bought", "customer"],
    isMoneyIn: false,
    isMoneyOut: false,
    requiresAmount: false,
    requiresEntity: false,
    isQuery: false,
  },

  // ── 19. Operational Stress Signal ────────────────────────────────────────────
  {
    canonicalIntent: "operational_stress_signal",
    transactionType: "none",
    phrases: [
      "business hard", "chop loss", "market slow", "nobody came",
      "today bad", "things slow", "no sales", "bad day",
      "wahala today", "nothing happen today", "nobody enter",
      "i chop loss", "business no move", "slow day", "market dead",
    ],
    contextSignals: ["hard", "slow", "bad", "loss", "wahala", "stress"],
    antiPatterns: ["sold", "customer paid", "made money"],
    isMoneyIn: false,
    isMoneyOut: false,
    requiresAmount: false,
    requiresEntity: false,
    isQuery: false,
  },

  // ── 20. Query: Balance ───────────────────────────────────────────────────────
  {
    canonicalIntent: "query_balance",
    transactionType: "none",
    phrases: [
      "how much", "my balance", "what's my total", "profit today",
      "how much i make", "today's total", "what i have",
      "check balance", "show balance", "my money", "today total",
    ],
    contextSignals: ["how much", "balance", "total", "profit", "today"],
    antiPatterns: ["owes", "debt", "inventory", "stock"],
    isMoneyIn: false,
    isMoneyOut: false,
    requiresAmount: false,
    requiresEntity: false,
    isQuery: true,
  },

  // ── 21. Query: Debts ─────────────────────────────────────────────────────────
  {
    canonicalIntent: "query_debts",
    transactionType: "none",
    phrases: [
      "who owes me", "list debts", "my debtors", "show debts",
      "all debtors", "who owe me", "debt list", "check debts",
      "show my debtors", "who haven't paid", "outstanding debts",
    ],
    contextSignals: ["owe", "debt", "debtor", "credit", "outstanding"],
    antiPatterns: ["balance", "profit", "inventory", "stock"],
    isMoneyIn: false,
    isMoneyOut: false,
    requiresAmount: false,
    requiresEntity: false,
    isQuery: true,
  },

  // ── 22. Query: Inventory ─────────────────────────────────────────────────────
  {
    canonicalIntent: "query_inventory",
    transactionType: "none",
    phrases: [
      "check stock", "what's in stock", "inventory list",
      "show inventory", "what do i have", "list items",
      "stock count", "my goods", "what i have in store",
    ],
    contextSignals: ["stock", "inventory", "items", "goods", "store"],
    antiPatterns: ["balance", "profit", "owes", "debt"],
    isMoneyIn: false,
    isMoneyOut: false,
    requiresAmount: false,
    requiresEntity: false,
    isQuery: true,
  },

  // ── 23. Query: Report ────────────────────────────────────────────────────────
  {
    canonicalIntent: "query_report",
    transactionType: "none",
    phrases: [
      "show report", "business report", "my report",
      "summary report", "show summary", "generate report",
      "weekly report", "monthly report", "full report",
    ],
    contextSignals: ["report", "summary", "weekly", "monthly", "overview"],
    antiPatterns: ["balance", "stock", "debts"],
    isMoneyIn: false,
    isMoneyOut: false,
    requiresAmount: false,
    requiresEntity: false,
    isQuery: true,
  },
];

// ─── resolveIntent ────────────────────────────────────────────────────────────

/**
 * Match free-form user text to a canonical SemanticIntent.
 * Scoring: +2 per matched phrase, +1 per matched context signal, -2 per anti-pattern hit.
 */
export function resolveIntent(
  text: string,
): { intent: SemanticIntent; confidence: number } | null {
  const lower = text.toLowerCase().trim();
  if (!lower) return null;

  let bestIntent: SemanticIntent | null = null;
  let bestScore = 0;

  for (const entry of ONTOLOGY) {
    let score = 0;

    for (const phrase of entry.phrases) {
      if (lower.includes(phrase.toLowerCase())) {
        score += 2;
      }
    }

    for (const signal of entry.contextSignals) {
      if (lower.includes(signal.toLowerCase())) {
        score += 1;
      }
    }

    for (const anti of entry.antiPatterns) {
      if (lower.includes(anti.toLowerCase())) {
        score -= 2;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestIntent = entry.canonicalIntent;
    }
  }

  if (!bestIntent || bestScore <= 0) return null;

  // Clamp confidence to [0, 1] — max theoretical score is phrase matches * 2
  const maxScore = 10; // reasonable ceiling
  const confidence = Math.min(bestScore / maxScore, 1);

  return { intent: bestIntent, confidence };
}

// ─── getOntologyEntry ─────────────────────────────────────────────────────────

export function getOntologyEntry(intent: SemanticIntent): OntologyEntry | undefined {
  return ONTOLOGY.find((e) => e.canonicalIntent === intent);
}

// ─── mapTransactionTypeToIntent ───────────────────────────────────────────────

export function mapTransactionTypeToIntent(type: TransactionType): SemanticIntent {
  switch (type) {
    case "sale":            return "sale";
    case "expense":         return "expense";
    case "debt":            return "customer_debt";
    case "repayment":       return "full_repayment";
    case "stock_purchase":  return "inventory_purchase";
    case "cost":            return "utility_expense";
    case "salary":          return "payroll";
    case "tax":             return "operational_expense";
    case "borrow_in":       return "investment";
    case "borrow_out":      return "withdrawal";
    case "loan_repay_out":  return "supplier_payment";
    case "loan_collect_in": return "full_repayment";
    case "investment":      return "investment";
    case "withdrawal":      return "withdrawal";
    case "refund_out":      return "refund";
    case "refund_in":       return "sale";
    case "transfer":        return "transfer";
  }
}
