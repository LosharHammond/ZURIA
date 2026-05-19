/**
 * lib/trust/index.ts
 *
 * ZURIA Trust Engine.
 *
 * African SMEs require transparent, explainable intelligence.
 * This module ensures every AI output includes evidence-based reasoning,
 * confidence labels, and source attribution.
 *
 * "ZURIA shows its work."
 *
 * Server-only.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type ConfidenceLevel = "high" | "moderate" | "low";

export type EvidenceSource =
  | "transaction_history"
  | "debt_records"
  | "parser"
  | "ai_model"
  | "seasonal_pattern"
  | "user_correction"
  | "archetype";

export interface ExplainedOutput<T> {
  value: T;
  confidence: ConfidenceLevel;
  confidenceScore: number;       // 0–1
  reasoning: string;             // Human-readable explanation of WHY
  evidence: EvidenceSource[];
  historicalContext?: string;    // "vs your normal weekly average" etc.
  caveat?: string;               // "Based on limited data (3 days)"
}

export interface RecommendationCard {
  id: string;
  title: string;
  reasoning: string;             // WHY this recommendation
  evidence: string;              // Supporting data point
  confidence: ConfidenceLevel;
  category: "cash_flow" | "debt" | "inventory" | "expense" | "growth" | "risk";
  urgency: "immediate" | "this_week" | "this_month" | "optional";
  actionText: string;            // Short action instruction
}

// ─── Core helpers ─────────────────────────────────────────────────────────────

/**
 * Maps a numeric confidence score (0–1) to a human-readable ConfidenceLevel.
 */
export function scoreToConfidenceLevel(score: number): ConfidenceLevel {
  if (score >= 0.80) return "high";
  if (score >= 0.55) return "moderate";
  return "low";
}

/**
 * Pure factory that wraps any value with explainability metadata.
 */
export function explain<T>(
  value: T,
  score: number,
  reasoning: string,
  evidence: EvidenceSource[],
  historicalContext?: string,
  caveat?: string,
): ExplainedOutput<T> {
  const output: ExplainedOutput<T> = {
    value,
    confidence: scoreToConfidenceLevel(score),
    confidenceScore: Math.min(1, Math.max(0, score)),
    reasoning,
    evidence,
  };
  if (historicalContext !== undefined) output.historicalContext = historicalContext;
  if (caveat !== undefined) output.caveat = caveat;
  return output;
}

// ─── Parser explainability ────────────────────────────────────────────────────

/**
 * Builds an ExplainedOutput for a transaction extracted by the parser.
 * Describes which signals the parser detected and flags any ambiguity.
 */
export function explainParserResult(
  type: string,
  amount: number,
  confidence: number,
  rawText: string,
): ExplainedOutput<{ type: string; amount: number }> {
  const level = scoreToConfidenceLevel(confidence);

  // Build keyword-presence notes from raw text for the reasoning string
  const lowerText = rawText.toLowerCase();
  const signalHints: string[] = [];

  if (/\b(sold|sale|revenue|income|received|collected)\b/.test(lowerText)) {
    signalHints.push("sale/income keywords");
  }
  if (/\b(bought|purchase|paid|expense|cost|spend)\b/.test(lowerText)) {
    signalHints.push("expense/purchase keywords");
  }
  if (/\b(owes|owe|debt|credit|borrow|lend|loan)\b/.test(lowerText)) {
    signalHints.push("debt/loan keywords");
  }
  if (/gh[c₵]?\s*\d|ghs?\s*\d|\d\s*cedis?/i.test(rawText)) {
    signalHints.push("Ghanaian currency pattern");
  }
  if (/\d+(\.\d{1,2})?/.test(rawText)) {
    signalHints.push("numeric amount pattern");
  }

  const detectedSignals =
    signalHints.length > 0
      ? signalHints.join(", ")
      : "general text patterns";

  let reasoning = `Detected transaction type '${type}' from ${detectedSignals}.`;

  if (level === "low") {
    reasoning +=
      " Confidence is low due to ambiguous phrasing — recovery question recommended.";
  } else if (level === "moderate") {
    reasoning += " Confidence reduced due to ambiguous phrasing.";
  } else {
    reasoning += " Strong signal match with high certainty.";
  }

  const caveat =
    confidence < 0.60
      ? "Low confidence — user confirmation required before recording."
      : undefined;

  return explain(
    { type, amount },
    confidence,
    reasoning,
    ["parser"],
    undefined,
    caveat,
  );
}

// ─── Recommendation cards ─────────────────────────────────────────────────────

/**
 * Creates a RecommendationCard with a generated UUID.
 */
export function explainRecommendation(
  title: string,
  dataPoint: string,
  category: RecommendationCard["category"],
  urgency: RecommendationCard["urgency"],
  actionText: string,
  confidence: ConfidenceLevel,
): RecommendationCard {
  return {
    id: crypto.randomUUID(),
    title,
    reasoning: `Based on your recorded ${category.replace("_", " ")} data: ${dataPoint}`,
    evidence: dataPoint,
    confidence,
    category,
    urgency,
    actionText,
  };
}

/**
 * Generates 2–4 actionable RecommendationCards from financial metrics.
 *
 * Rules:
 *   - expenseRatio > 0.8  → expense reduction card (immediate)
 *   - totalDebt > avgDailyRevenue * 5 → debt collection card (this_week)
 *   - cashFlowPattern === "declining" → revenue growth card (this_week)
 *   - Always includes a cash flow health card (this_month)
 */
export function buildCashFlowRecommendations(
  avgDailyRevenue: number,
  avgDailyExpenses: number,
  totalDebt: number,
  cashFlowPattern: string,
): RecommendationCard[] {
  const cards: RecommendationCard[] = [];

  const expenseRatio =
    avgDailyRevenue > 0 ? avgDailyExpenses / avgDailyRevenue : 1;
  const debtDaysOfRevenue =
    avgDailyRevenue > 0 ? totalDebt / avgDailyRevenue : 0;

  // 1. High expense ratio
  if (expenseRatio > 0.8) {
    const pct = Math.round(expenseRatio * 100);
    cards.push(
      explainRecommendation(
        "Reduce Daily Expenses",
        `Your expenses are ${pct}% of daily revenue — leaving little margin for profit.`,
        "expense",
        "immediate",
        "Review your top 3 daily costs and identify one to cut or defer this week.",
        expenseRatio > 0.95 ? "low" : "moderate",
      ),
    );
  }

  // 2. Large outstanding debt owed to the business
  if (debtDaysOfRevenue > 5) {
    const formattedDebt = `GH₵${totalDebt.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    cards.push(
      explainRecommendation(
        "Collect Outstanding Debt",
        `Customers owe you ${formattedDebt} — equivalent to ${Math.round(debtDaysOfRevenue)} days of revenue.`,
        "debt",
        "this_week",
        `Send payment reminders to your top debtors. Recovering even 50% improves your cash position significantly.`,
        "high",
      ),
    );
  }

  // 3. Declining cash flow
  if (cashFlowPattern === "declining") {
    cards.push(
      explainRecommendation(
        "Address Declining Revenue",
        "Your cash flow trend is declining — revenue has been falling over recent days.",
        "growth",
        "this_week",
        "Contact your top 3 customers from last month to encourage repeat purchases.",
        "moderate",
      ),
    );
  }

  // 4. Always add a general cash flow health card
  const dailyNet = avgDailyRevenue - avgDailyExpenses;
  const netFormatted = `GH₵${Math.abs(dailyNet).toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const netLabel = dailyNet >= 0 ? `net profit of ${netFormatted}` : `net loss of ${netFormatted}`;
  cards.push(
    explainRecommendation(
      "Monitor Cash Flow Weekly",
      `Your daily average shows a ${netLabel}. Regular tracking prevents surprises.`,
      "cash_flow",
      "this_month",
      "Review your weekly summary every Monday to stay ahead of cash shortfalls.",
      dailyNet >= 0 ? "high" : "moderate",
    ),
  );

  return cards;
}

// ─── Historical context strings ───────────────────────────────────────────────

/**
 * Produces a human-readable comparison string between two numeric values.
 *
 * Examples:
 *   addHistoricalContext(122, 100, "Transport spending")
 *   → "Transport spending increased 22% compared to your normal weekly average"
 *
 *   addHistoricalContext(100, 100, "Revenue")
 *   → "Revenue is consistent with your 7-day average"
 */
export function addHistoricalContext(
  current: number,
  previous: number,
  metricName: string,
): string {
  if (previous === 0) {
    return `${metricName} recorded for the first time — no prior average to compare.`;
  }

  const changePct = ((current - previous) / previous) * 100;
  const absPct = Math.round(Math.abs(changePct));

  if (absPct < 3) {
    return `${metricName} is consistent with your 7-day average.`;
  }

  const direction = changePct > 0 ? "increased" : "decreased";
  return `${metricName} ${direction} ${absPct}% compared to your normal weekly average.`;
}
