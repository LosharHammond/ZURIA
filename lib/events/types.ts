/**
 * ZURIA Event System — Type Definitions
 *
 * Strongly typed event bus contract.  Every event flowing through the
 * ZuriaEventEmitter must conform to one of these shapes.
 *
 * Runtime-agnostic (no side-effects) — safe to import anywhere.
 */

// ─── Event union type ─────────────────────────────────────────────────────────

export type ZuriaEventType =
  | "transaction.created"
  | "transaction.corrected"
  | "transaction.voided"
  | "debt.created"
  | "debt.updated"
  | "debt.cleared"
  | "inventory.changed"
  | "inventory.depleted"
  | "report.generated"
  | "parser.failed"
  | "parser.low_confidence"
  | "ai.requested"
  | "ai.responded"
  | "ai.failed"
  | "ai.cost_limit_reached"
  | "payment.completed"
  | "payment.failed"
  | "subscription.activated"
  | "subscription.expired"
  | "referral.completed"
  | "user.correction"
  | "shadow_learn.divergence"
  | "security.suspicious_input"
  | "security.moderation_blocked";

// ─── Base event envelope ──────────────────────────────────────────────────────

export interface ZuriaEvent<T = Record<string, unknown>> {
  id: string;
  type: ZuriaEventType;
  userId: string;
  businessId?: string;
  payload: T;
  timestamp: string;
  platform?: "whatsapp" | "telegram" | "web";
}

// ─── Type-safe payload shapes for key events ──────────────────────────────────

export interface TransactionCreatedPayload {
  transactionId: string;
  type: string;
  amount: number;
  confidence: number;
  usedAI: boolean;
}

export interface ParserFailedPayload {
  rawInput: string;
  confidence: number;
  reason: string;
}

export interface AIRequestedPayload {
  model: string;
  routingPath: string;
  inputLength: number;
}

export interface ShadowLearnPayload {
  rawInput: string;
  parserType: string;
  aiType: string | null;
  parserAmount: number;
  aiAmount: number | null;
  diverged: boolean;
}

export interface SecurityEventPayload {
  reason: string;
}
