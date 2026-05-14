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
} as const;
