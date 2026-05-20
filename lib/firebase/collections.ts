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
  // Reconciliation run audit trail — one doc per scheduled payment reconciliation run.
  // Stores the full report (repaired, failed, drift) for anomaly detection and audit.
  reconciliationRuns: "reconciliation_runs",

  // ── AI Infrastructure ─────────────────────────────────────────────────────

  // AI usage metering — one doc per Groq/OpenAI call. Used for cost governance.
  aiUsageLogs: "ai_usage_logs",

  // Parser learning — training examples collected when AI improves on parser output.
  parserTrainingExamples: "parser_training_examples",

  // Parser failure log — low-confidence or failed extraction attempts.
  parserFailures: "parser_failures",

  // User corrections — highest-quality training signal. Append-only.
  parserCorrections: "parser_corrections",

  // Auto-generated parser patterns from clustering training examples.
  parserPatterns: "parser_patterns",

  // Operational business profiles — inferred from transaction history.
  businessProfiles: "business_profiles",

  // Event log — structured operational events from the ZURIA event bus.
  eventLog: "event_log",

  // Job queue — Firestore-backed queue for async AI/reporting jobs.
  jobQueue: "job_queue",

  // Feature flags — remotely configurable AI feature toggles.
  featureFlags: "feature_flags",

  // Shadow learning results — parser vs AI comparison logs.
  shadowLearningLogs: "shadow_learning_logs",

  // Executive reports — AI-generated business intelligence reports.
  executiveReports: "executive_reports",

  // ── Business Intelligence Engine ──────────────────────────────────────────

  // Full BI reports — fingerprint, archetype, trends, seasonal, rhythm.
  businessIntelligence: "business_intelligence",

  // Financial risk scores — per-business risk + lending eligibility.
  riskScores: "risk_scores",

  // Business timeline — chronological operational events.
  businessTimeline: "business_timeline",

  // AI evaluation records — hallucination tracking, parser vs AI quality.
  aiEvals: "ai_evals",

  // AI request logs — per-inference request/response structured logging.
  aiRequestLogs: "ai_request_logs",

  // Parser benchmark logs — precision/recall tracking per extraction.
  parserBenchmarkLogs: "parser_benchmark_logs",

  // Double-entry ledger journal entries.
  journalEntries: "journal_entries",

  // Memory store — tiered memory entries with decay.
  memoryStore: "memory_store",

  // Notification deduplication keys — prevents duplicate notification sends.
  notificationDedup: "notification_dedup",

  // ── Infrastructure Monitoring ─────────────────────────────────────────────

  // System status records — health check results per service.
  systemStatus: "system_status",

  // Subscription audit log — integrity check results and auto-repair records.
  subscriptionAuditLog: "subscription_audit_log",

  // ── Billing Infrastructure ────────────────────────────────────────────────

  // Dead-letter queue — webhook events that failed all retry attempts.
  billingDeadLetters: "billing_dead_letters",

  // Billing events — comprehensive log of every billing state change.
  billingEvents: "billing_events",

  // Entitlement cache — denormalized feature set per user, refreshed on plan change.
  entitlementCache: "entitlement_cache",

  // ── Observability ─────────────────────────────────────────────────────────

  // Structured observability log — errors, warnings, and audit traces.
  observabilityLogs: "observability_logs",

  // AI cost governor — per-plan spend tracking and abuse signals.
  aiCostGovernor: "ai_cost_governor",

  // ── Retention & Irreplaceability Engine ───────────────────────────────────

  // Business DNA — synthesized behavioral facts about each business.
  // One doc per businessId; refreshed daily by cron.
  // Powers "ZURIA remembers your business" conversational recall.
  businessDna: "business_dna",

  // Relationship memory — per-supplier and per-customer behavioral profiles.
  // Doc ID: `${businessId}_${normalizedEntityName}`.
  // Powers "Kojo usually pays within 8 days" and "last price from this supplier" recall.
  relationshipMemory: "relationship_memory",

  // Proactive insights — AI-generated insights delivered without user prompting.
  // One doc per (businessId + date + insightType). Deduplication key prevents spam.
  // Workers read and deliver via WhatsApp/Telegram/app.
  proactiveInsights: "proactive_insights",

  // Business timeline — chronological operational intelligence events.
  // Already declared above as businessTimeline but referenced as a literal string
  // in timeline/index.ts — keeping the canonical key here for cross-module use.
  // (Both keys point to the same "business_timeline" collection.)

  // Retention events — engagement and habit-formation telemetry.
  // Append-only. Tracks: first_record, streak_7d, streak_30d, first_report, etc.
  retentionEvents: "retention_events",
} as const;
