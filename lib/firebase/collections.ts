export const collections = {
  users: "users",
  businesses: "businesses",
  transactions: "transactions",
  debts: "debts",
  loans: "loans",
  inventory: "inventory",
  summaries: "summaries",
  notifications: "notifications",
  whatsappSessions: "whatsapp_sessions",
  referrals: "referrals",
  withdrawals: "withdrawals",
  paymentClaims: "payment_claims",
  payments: "payments",
  telegramLinks: "telegram_links",
  errors: "errors",
  // Idempotency keys — used to deduplicate webhook retries across serverless instances
  idempotencyKeys: "idempotency_keys",
  // Immutable referral event ledger — one doc per reward, never deleted or modified.
  // This is the single source of truth for referral earnings audit.
  referralEvents: "referral_events",
  // Immutable payment event ledger — one doc per financial event (initiated, success,
  // failed, activated). Written atomically with every subscription state change.
  // Doc ID: `${paystackReference}_${eventType}` — deterministic and idempotent.
  // Never update or delete. The financial source of truth for subscription payments.
  paymentEvents: "payment_events",
  // Webhook ingestion queue — raw Paystack events stored before async processing.
  // Workers poll this collection, process events idempotently, then mark "done".
  // Failed events (attempts >= maxAttempts) are marked "dead" for manual review.
  webhookQueue: "webhook_queue",
  // Immutable withdrawal event ledger — one doc per withdrawal lifecycle event
  // (requested, approved, rejected, failed). Written atomically with every status change.
  // Doc ID: `${withdrawalId}_${eventType}` — deterministic and idempotent.
  // Never update or delete. The source of truth for referral earnings outflows.
  withdrawalEvents: "withdrawal_events",
  // Fraud signal events — best-effort append-only log of detected suspicious activity
  // (self-referral attempts, anomalous patterns, etc.). Never used for blocking decisions.
  fraudSignals: "fraud_signals",
} as const;
