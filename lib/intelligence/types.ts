/**
 * Universal Intent Classification System — canonical types.
 *
 * Every message processed by ZURIA's chat interface is reduced to one of
 * these types before any engine is invoked. The classifier is the sole
 * authority on which engine handles a message.
 *
 * Runtime-agnostic: safe to import anywhere.
 */

// ─── Engine identity ──────────────────────────────────────────────────────────

/**
 * The seven mutually exclusive intent buckets.
 * Every message maps to exactly one.
 */
export type IntentType =
  | "LEDGER_ENGINE"        // Record a financial event
  | "LEDGER_QUERY_ENGINE"  // Read/report from financial data
  | "AUTH_ENGINE"          // Security — PIN, lock, unlock
  | "SUBSCRIPTION_ENGINE"  // Pricing, upgrade, payment claim
  | "HELP_ENGINE"          // How-to, command list
  | "SMALLTALK"            // Greetings, noise, irrelevant
  | "UNDO"                 // Correct / reverse the last recorded transaction
  | "ERROR";               // Ambiguous — needs clarification

// ─── Sub-intents ──────────────────────────────────────────────────────────────

export type LedgerSubIntent =
  | "sale"             // "sold rice 120"
  | "expense"          // "bought fuel 30" / "paid rent 500"
  | "debt_record"      // "kofi owes me 50"
  | "debt_payment"     // "ama paid her debt 20"
  | "loan_given"       // "gave kofi loan 100"
  | "loan_repaid"      // "kofi repaid 100"
  | "stock_update"     // "stock rice 10 bags"
  | "refund"           // "refund ama 20"
  | "salary"           // "paid worker 300"
  | "investment"       // "invested 500 in stock"
  | "withdrawal";      // "withdrew 200 from bank"

export type QuerySubIntent =
  | "summary"          // Today's balance/profit
  | "debt_list"        // Who owes me
  | "loan_list"        // What I owe
  | "stock_level"      // Inventory check
  | "weekly_report"    // This week
  | "monthly_report"   // This month
  | "full_dashboard"   // All-time analytics
  | "referral_status"  // Referral earnings/link
  | "undo";            // Delete last entry

export type AuthSubIntent =
  | "pin_entry"   // Raw 4-digit number
  | "lock"        // Explicit lock command
  | "logout";     // Explicit logout command

export type SubscriptionSubIntent =
  | "upgrade_request"   // "subscribe" / "upgrade" / "plans"
  | "pricing_query"     // "how much is pro"
  | "payment_claim";    // "paid growth" / "paid pro annual"

export type HelpSubIntent =
  | "commands_list"   // "help" / "commands"
  | "how_to_use";     // "how do I use this"

export type SmalltalkSubIntent =
  | "greeting"     // "hi" / "hello" / "good morning"
  | "affirmation"  // "ok" / "thanks" / "noted"
  | "emoji_only"   // "😊" / "👍"
  | "noise";       // Random irrelevant text

export type ErrorSubIntent =
  | "ambiguous"    // Intent unclear even with context
  | "incomplete";  // Message appears to be cut off

export type SubIntent =
  | LedgerSubIntent
  | QuerySubIntent
  | AuthSubIntent
  | SubscriptionSubIntent
  | HelpSubIntent
  | SmalltalkSubIntent
  | ErrorSubIntent;

// ─── Extracted entities ───────────────────────────────────────────────────────

export interface ClassifiedEntities {
  /** Person name from the message (customer, debtor, employee) */
  person:    string | null;
  /** Numeric amount extracted (always in GHS, never pesewas) */
  amount:    number | null;
  /** Product, item, or asset name */
  asset:     string | null;
  /** Verb / action word (sold, paid, owes, bought, gave, etc.) */
  action:    string | null;
  /** Money direction from the business's perspective */
  direction: "in" | "out" | "debt_in" | "debt_out" | null;
  /** Subscription plan (SUBSCRIPTION_ENGINE only) */
  plan:      string | null;
  /** Annual billing flag (SUBSCRIPTION_ENGINE / payment_claim only) */
  annual:    boolean;
}

// ─── Conversation state ───────────────────────────────────────────────────────

export interface ConversationState {
  /** Which engine is currently the primary handler for this session */
  active_flow:
    | "ledger"
    | "auth"
    | "query"
    | "subscription"
    | "none"
    | "undo_confirm"         // Two-step undo: waiting for "yes" confirmation
    | "pending_confirmation"; // Pre-save confirmation for low-confidence transactions
  /** Whether the current intent should render a UI widget/keyboard */
  should_trigger_ui: boolean;
  /**
   * True when subscription UI was shown < 24h ago AND the user did NOT
   * explicitly request subscription info.
   * When true, suppress near-limit warnings and unsolicited upgrade prompts.
   */
  subscription_ui_suppressed: boolean;
}

// ─── Pending transaction (pre-save confirmation) ──────────────────────────────

/**
 * A parsed transaction staged for user confirmation before being written to Firestore.
 * Used when confidence < CONFIRMATION_THRESHOLD to prevent silent wrong entries.
 */
export interface PendingTransactionContext {
  type:             string;
  amount:           number;
  confidence:       number;
  customerName:     string | null;
  customerNameNormalized: string | null;
  productName:      string | null;
  notes:            string | null;
  quantity:         number | null;
  paymentMethod:    string | null;
  /** The Ghanaian-normalized version of the original text */
  normalizedText:   string;
  /** The user's original un-normalized text — stored for audit trail */
  originalText:     string;
}

// ─── Full classification output ───────────────────────────────────────────────

export interface ClassifiedIntent {
  /** Primary engine to invoke — exactly one, always set */
  intent:          IntentType;
  /** Classifier confidence 0.0–1.0 */
  confidence:      number;
  /** Narrower classification within the engine */
  sub_intent:      SubIntent | null;
  /** Extracted structured data from the message */
  entities:        ClassifiedEntities;
  /** Session-level routing state */
  state:           ConversationState;
  /** Whether a downstream engine action is expected */
  requires_action: boolean;
}

// ─── Context carried across turns ────────────────────────────────────────────

/** One turn of conversation history */
export interface HistoryEntry {
  role: "user" | "zuria";
  text: string;
  ts:   string; // ISO timestamp
}

/**
 * Persisted per-session context for the classifier.
 * Stored on the whatsapp/telegram session document in Firestore.
 */
export interface ConversationContext {
  /** Last classified intent (enables intent continuity) */
  lastIntent:            IntentType | null;
  /** Last active engine flow */
  activeFlow:            ConversationState["active_flow"];
  /** Last referenced person name (for pronoun resolution) */
  lastPerson:            string | null;
  /** Last extracted amount (for follow-up messages like "yes confirm") */
  lastAmount:            number | null;
  /** Last referenced asset/product */
  lastAsset:             string | null;
  /** Last transaction sub-intent (enables "undo" to target correct record) */
  lastTransactionSubIntent: LedgerSubIntent | null;
  /**
   * ID of the most recently recorded transaction.
   * Used by UNDO intent to target the correct record.
   */
  lastTransactionId:     string | null;
  /**
   * Brief description of the last transaction for the undo confirmation prompt.
   * e.g. "sale of GH₵120 (Rice)"
   */
  lastTransactionDesc:   string | null;
  /**
   * Ring buffer of the last 5 conversation turns.
   * Used for pronoun resolution, context-aware AI calls, longitudinal insight.
   */
  conversationHistory:   HistoryEntry[];
  /**
   * A limit-warning message staged to be prepended to the NEXT response.
   * Decouples the warning from the financial confirmation that triggered it.
   */
  pendingLimitNotification: string | null;
  /**
   * ISO timestamp when subscription UI was last shown to this user.
   * Used to enforce the 24h unsolicited-upgrade suppression rule.
   */
  subscriptionUiShownAt: string | null;
  /**
   * A parsed transaction staged for confirmation before being written to Firestore.
   * Set when confidence < CONFIRMATION_THRESHOLD. Cleared on user "yes" (save)
   * or "no" / any new financial message (abandon).
   */
  pendingTransaction:    PendingTransactionContext | null;
  /**
   * The Ghanaian-normalized text of the last processed message.
   * Used by engine-guard RULE 5 to detect duplicate webhook deliveries.
   */
  lastNormalizedText:    string | null;
  /** ISO timestamp of last context update */
  updatedAt:             string;
}

// ─── Engine isolation result ──────────────────────────────────────────────────

/**
 * Result of the anti-bug engine isolation check.
 * If `blocked` is true, the original intent was suppressed and `override`
 * contains the safe replacement.
 */
export interface IsolationCheckResult {
  blocked:       boolean;
  override:      ClassifiedIntent | null;
  violationRule: string | null;
}
