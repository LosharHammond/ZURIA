/**
 * lib/recovery/index.ts
 *
 * Human Recovery UX.
 *
 * When ZURIA is uncertain, it does not fake confidence.
 * Instead it asks intelligent recovery questions that:
 *   1. Recover the correct transaction
 *   2. Improve the parser with training data
 *   3. Build user trust through transparency
 *
 * "Did you mean: A) expense  B) inventory purchase  C) supplier debt?"
 *
 * Server-only.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RecoveryOption {
  key: "A" | "B" | "C" | "D";
  label: string;        // Transaction type label
  description: string;  // e.g. "Record as a business expense"
  transactionType: string;
}

export interface RecoveryQuestion {
  id: string;
  originalText: string;
  question: string;
  options: RecoveryOption[];
  confidence: number;       // Parser confidence that triggered recovery
  parserGuess: string;      // What the parser thought it was
  formattedMessage: string; // Ready-to-send WhatsApp/Telegram message
}

export interface RecoveryResolution {
  questionId: string;
  selectedKey: "A" | "B" | "C" | "D";
  resolvedType: string;
  originalText: string;
  timestamp: string;
}

// ─── Option maps ──────────────────────────────────────────────────────────────

/**
 * Returns 3–4 options for a given parserGuess type.
 * Option A is always the parser's own guess; remaining options are semantically
 * adjacent alternatives that are commonly confused with it.
 */
function buildOptionsForGuess(
  parserGuess: string,
  amount: number,
): RecoveryOption[] {
  const amountStr = `GH₵${amount.toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

  const lowerGuess = parserGuess.toLowerCase();

  // ── Expense / cost / salary ───────────────────────────────────────────────
  if (
    lowerGuess === "expense" ||
    lowerGuess === "cost" ||
    lowerGuess === "salary"
  ) {
    return [
      {
        key: "A",
        label: "Business expense",
        description: `Record ${amountStr} as a regular business expense (fuel, rent, utilities, etc.)`,
        transactionType: "expense",
      },
      {
        key: "B",
        label: "Stock / inventory purchase",
        description: `Record ${amountStr} as goods purchased for resale`,
        transactionType: "stock_purchase",
      },
      {
        key: "C",
        label: "Salary / wages paid",
        description: `Record ${amountStr} as payment to a worker or employee`,
        transactionType: "salary",
      },
      {
        key: "D",
        label: "Supplier payment",
        description: `Record ${amountStr} as payment toward a supplier debt`,
        transactionType: "supplier_payment",
      },
    ];
  }

  // ── Sale / income ─────────────────────────────────────────────────────────
  if (lowerGuess === "sale" || lowerGuess === "income" || lowerGuess === "revenue") {
    return [
      {
        key: "A",
        label: "Cash sale",
        description: `Record ${amountStr} as cash received for goods or services sold`,
        transactionType: "sale",
      },
      {
        key: "B",
        label: "Credit sale (customer owes me)",
        description: `Record ${amountStr} as a sale where the customer will pay later`,
        transactionType: "debt_record",
      },
      {
        key: "C",
        label: "Debt repayment received",
        description: `Record ${amountStr} as a customer paying back money they owed me`,
        transactionType: "debt_payment",
      },
    ];
  }

  // ── Debt record / borrow in ───────────────────────────────────────────────
  if (
    lowerGuess === "debt_record" ||
    lowerGuess === "borrow_in" ||
    lowerGuess === "loan"
  ) {
    return [
      {
        key: "A",
        label: "Customer owes me",
        description: `Record that a customer owes me ${amountStr} (I sold on credit)`,
        transactionType: "debt_record",
      },
      {
        key: "B",
        label: "I borrowed money",
        description: `Record that I borrowed ${amountStr} from someone (I owe them)`,
        transactionType: "loan_received",
      },
      {
        key: "C",
        label: "Supplier credit",
        description: `Record that a supplier gave me goods on credit worth ${amountStr}`,
        transactionType: "supplier_credit",
      },
    ];
  }

  // ── Stock / inventory ─────────────────────────────────────────────────────
  if (
    lowerGuess === "stock_purchase" ||
    lowerGuess === "inventory" ||
    lowerGuess === "restock"
  ) {
    return [
      {
        key: "A",
        label: "Stock purchase (paid)",
        description: `Record ${amountStr} as stock bought and fully paid for`,
        transactionType: "stock_purchase",
      },
      {
        key: "B",
        label: "Stock on supplier credit",
        description: `Record ${amountStr} worth of stock received — payment due later`,
        transactionType: "supplier_credit",
      },
      {
        key: "C",
        label: "Business expense",
        description: `Record ${amountStr} as a general business expense, not inventory`,
        transactionType: "expense",
      },
    ];
  }

  // ── Loan / repayment ──────────────────────────────────────────────────────
  if (
    lowerGuess === "loan_given" ||
    lowerGuess === "loan_repaid" ||
    lowerGuess === "repayment"
  ) {
    return [
      {
        key: "A",
        label: "Loan I gave out",
        description: `Record ${amountStr} as money lent to someone (they owe me)`,
        transactionType: "loan_given",
      },
      {
        key: "B",
        label: "Loan repayment I received",
        description: `Record ${amountStr} as someone repaying a loan they owed me`,
        transactionType: "loan_repaid",
      },
      {
        key: "C",
        label: "I repaid a loan",
        description: `Record ${amountStr} as my repayment of money I borrowed`,
        transactionType: "loan_repayment_made",
      },
    ];
  }

  // ── Transfer / withdrawal ─────────────────────────────────────────────────
  if (
    lowerGuess === "transfer" ||
    lowerGuess === "withdrawal" ||
    lowerGuess === "deposit"
  ) {
    return [
      {
        key: "A",
        label: "Bank / MoMo transfer",
        description: `Record ${amountStr} as a transfer between accounts (not income or expense)`,
        transactionType: "transfer",
      },
      {
        key: "B",
        label: "Cash withdrawal",
        description: `Record ${amountStr} withdrawn from bank or MoMo for business use`,
        transactionType: "withdrawal",
      },
      {
        key: "C",
        label: "Business expense",
        description: `Record ${amountStr} as money spent on a business cost`,
        transactionType: "expense",
      },
    ];
  }

  // ── Fallback: generic disambiguation ─────────────────────────────────────
  return [
    {
      key: "A",
      label: parserGuess.replace(/_/g, " "),
      description: `Record ${amountStr} as ${parserGuess.replace(/_/g, " ")} (parser's best guess)`,
      transactionType: parserGuess,
    },
    {
      key: "B",
      label: "Business expense",
      description: `Record ${amountStr} as a business expense`,
      transactionType: "expense",
    },
    {
      key: "C",
      label: "Cash sale / income",
      description: `Record ${amountStr} as revenue received`,
      transactionType: "sale",
    },
  ];
}

// ─── Core logic ───────────────────────────────────────────────────────────────

/**
 * Returns true when a recovery disambiguation question should be sent to the user.
 *
 * Triggers when:
 *   - confidence < 0.60 (general uncertainty threshold), OR
 *   - isCriticalTransaction AND confidence < 0.75 (stricter for high-stakes records)
 */
export function needsRecovery(
  confidence: number,
  isCriticalTransaction: boolean,
): boolean {
  if (confidence < 0.60) return true;
  if (isCriticalTransaction && confidence < 0.75) return true;
  return false;
}

/**
 * Builds an intelligent disambiguation question for an ambiguous parser result.
 *
 * - Option A is always the parser's own guess.
 * - Remaining options are semantically adjacent alternatives.
 * - formattedMessage is a clean WhatsApp-ready string.
 */
export function buildRecoveryQuestion(
  originalText: string,
  parserGuess: string,
  confidence: number,
  amount: number,
): RecoveryQuestion {
  const options = buildOptionsForGuess(parserGuess, amount);

  const optionLines = options
    .map((o) => `${o.key}) ${o.label}`)
    .join("\n");

  const question = `I want to make sure I record this correctly. What best describes this transaction?`;

  const formattedMessage =
    `I want to make sure I record this correctly:\n\n` +
    `*Did you mean:*\n` +
    `${optionLines}\n\n` +
    `Reply ${options.map((o) => o.key).join(", ")}`;

  return {
    id: crypto.randomUUID(),
    originalText,
    question,
    options,
    confidence,
    parserGuess,
    formattedMessage,
  };
}

/**
 * Parses the user's reply to a RecoveryQuestion and returns a RecoveryResolution.
 * Returns null if the reply cannot be matched to one of the offered options.
 *
 * Accepts: "A", "a", "B", "b", "C", "c", "D", "d"
 */
export function resolveRecovery(
  question: RecoveryQuestion,
  userReply: string,
): RecoveryResolution | null {
  const normalised = userReply.trim().toUpperCase() as "A" | "B" | "C" | "D";
  const validKeys: Array<"A" | "B" | "C" | "D"> = ["A", "B", "C", "D"];

  if (!validKeys.includes(normalised)) return null;

  const selectedOption = question.options.find((o) => o.key === normalised);
  if (!selectedOption) return null;

  return {
    questionId: question.id,
    selectedKey: normalised,
    resolvedType: selectedOption.transactionType,
    originalText: question.originalText,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Returns the ready-to-send WhatsApp/Telegram message from a RecoveryQuestion.
 */
export function formatAmbiguityMessage(recoveryQuestion: RecoveryQuestion): string {
  return recoveryQuestion.formattedMessage;
}
