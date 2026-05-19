/**
 * ZURIA Executive Reports Engine
 *
 * Generates AI-enhanced executive reports for African SME business owners.
 * Falls back gracefully to deterministic template-based narratives when Groq
 * is unavailable.
 */

import type { Transaction, Debt } from "@/types/domain";
import { MONEY_IN_TYPES, MONEY_OUT_TYPES } from "@/types/domain";
import { groqGenerate, isGroqAvailable } from "@/lib/ai/groq";
import { createLogger } from "@/lib/observability/logger";

const logger = createLogger("reports");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ExecutiveReport {
  id: string;
  userId: string;
  businessId: string;
  period: "daily" | "weekly" | "monthly";
  generatedAt: string;

  metrics: {
    totalRevenue: number;
    totalExpenses: number;
    netProfit: number;
    profitMargin: number;
    totalTransactions: number;
    averageTransactionSize: number;
    topProducts: Array<{ name: string; revenue: number }>;
    debtExposure: number;
    cashFlowTrend: "positive" | "negative" | "neutral";
  };

  narrative: {
    executiveSummary: string;
    keyInsights: string[];
    recommendations: string[];
    riskAlerts: string[];
    aiModel: string;
  } | null;

  generationSource: "deterministic" | "ai_enhanced";
}

// ─── Metrics computation ──────────────────────────────────────────────────────

function computeMetrics(
  transactions: Transaction[],
  debts: Debt[],
): ExecutiveReport["metrics"] {
  let totalRevenue = 0;
  let totalExpenses = 0;
  const productRevenue: Record<string, number> = {};

  for (const tx of transactions) {
    if (MONEY_IN_TYPES.includes(tx.type)) {
      totalRevenue += tx.amount;
      if (tx.productName) {
        productRevenue[tx.productName] =
          (productRevenue[tx.productName] ?? 0) + tx.amount;
      }
    } else if (MONEY_OUT_TYPES.includes(tx.type)) {
      totalExpenses += tx.amount;
    }
  }

  const netProfit = totalRevenue - totalExpenses;
  const profitMargin =
    totalRevenue > 0 ? Math.round((netProfit / totalRevenue) * 100 * 100) / 100 : 0;

  const totalTransactions = transactions.length;
  const totalValue = transactions.reduce((s, tx) => s + tx.amount, 0);
  const averageTransactionSize =
    totalTransactions > 0
      ? Math.round((totalValue / totalTransactions) * 100) / 100
      : 0;

  const topProducts = Object.entries(productRevenue)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([name, revenue]) => ({ name, revenue }));

  const debtExposure = debts
    .filter((d) => d.status === "open")
    .reduce((s, d) => s + d.outstandingAmount, 0);

  const cashFlowTrend: "positive" | "negative" | "neutral" =
    netProfit > 0 ? "positive" : netProfit < 0 ? "negative" : "neutral";

  return {
    totalRevenue,
    totalExpenses,
    netProfit,
    profitMargin,
    totalTransactions,
    averageTransactionSize,
    topProducts,
    debtExposure,
    cashFlowTrend,
  };
}

// ─── Deterministic narrative ──────────────────────────────────────────────────

export function buildDeterministicNarrative(
  metrics: ExecutiveReport["metrics"],
  period: string,
): NonNullable<ExecutiveReport["narrative"]> {
  const { totalRevenue, totalExpenses, netProfit, profitMargin, debtExposure, topProducts, cashFlowTrend } = metrics;

  const fmt = (n: number) => `GH₵${n.toFixed(2)}`;

  const trendWord =
    cashFlowTrend === "positive"
      ? "positive"
      : cashFlowTrend === "negative"
      ? "negative"
      : "neutral";

  const executiveSummary = [
    `Your business recorded ${fmt(totalRevenue)} in revenue and ${fmt(totalExpenses)} in expenses during this ${period} period.`,
    `Net profit stands at ${fmt(netProfit)} (${profitMargin}% margin), reflecting a ${trendWord} cash flow trend.`,
    debtExposure > 0
      ? `Outstanding customer debt of ${fmt(debtExposure)} requires attention to maintain healthy liquidity.`
      : `There are no outstanding customer debts — excellent financial discipline.`,
  ].join(" ");

  const keyInsights: string[] = [
    `Revenue: ${fmt(totalRevenue)} | Expenses: ${fmt(totalExpenses)} | Net: ${fmt(netProfit)}`,
    topProducts.length > 0
      ? `Top product: ${topProducts[0]!.name} (${fmt(topProducts[0]!.revenue)})`
      : "No product breakdown available for this period.",
    cashFlowTrend === "positive"
      ? "Cash flow is healthy — business is operating in surplus."
      : cashFlowTrend === "negative"
      ? "Cash flow is negative — expenses exceed revenue this period."
      : "Cash flow is neutral — revenue equals expenses.",
  ];

  const recommendations: string[] = [];
  if (debtExposure > totalRevenue * 0.2) {
    recommendations.push(
      "Customer debts represent over 20% of revenue. Follow up with debtors to improve cash collection.",
    );
  }
  if (profitMargin < 10 && totalRevenue > 0) {
    recommendations.push(
      "Profit margin is below 10%. Review your top expense categories and look for cost reduction opportunities.",
    );
  }
  if (recommendations.length === 0) {
    recommendations.push(
      "Keep maintaining your current recording habits to get more accurate insights over time.",
    );
  }

  const riskAlerts: string[] = [];
  if (netProfit < 0) {
    riskAlerts.push(`Net loss of ${fmt(Math.abs(netProfit))} detected. Immediate review of expenses recommended.`);
  }
  if (debtExposure > 500) {
    riskAlerts.push(`High debt exposure: ${fmt(debtExposure)}. Risk of bad debt if not collected soon.`);
  }

  return {
    executiveSummary,
    keyInsights,
    recommendations,
    riskAlerts,
    aiModel: "deterministic_template",
  };
}

// ─── AI narrative builder ─────────────────────────────────────────────────────

function parseAiNarrative(
  rawText: string,
  modelName: string,
): NonNullable<ExecutiveReport["narrative"]> {
  const lines = rawText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  // Heuristic split: first non-bullet paragraph → summary, bullets → insights/recommendations
  const bullets: string[] = [];
  const paragraphs: string[] = [];

  for (const line of lines) {
    if (line.startsWith("-") || line.startsWith("•") || /^\d+\./.test(line)) {
      bullets.push(line.replace(/^[-•\d.]\s*/, ""));
    } else {
      paragraphs.push(line);
    }
  }

  const executiveSummary = paragraphs.slice(0, 2).join(" ") || rawText.slice(0, 300);

  const mid = Math.ceil(bullets.length / 2);
  const keyInsights = bullets.slice(0, mid).slice(0, 4);
  const recommendations = bullets.slice(mid).slice(0, 3);

  // Risk alerts — look for keywords in the raw text
  const riskAlerts: string[] = [];
  const riskKeywords = ["risk", "warning", "alert", "danger", "loss", "debt"];
  for (const para of paragraphs.slice(2)) {
    if (riskKeywords.some((kw) => para.toLowerCase().includes(kw))) {
      riskAlerts.push(para);
    }
  }

  return {
    executiveSummary,
    keyInsights: keyInsights.length > 0 ? keyInsights : [executiveSummary],
    recommendations: recommendations.length > 0 ? recommendations : ["Continue recording daily transactions for better insights."],
    riskAlerts,
    aiModel: modelName,
  };
}

// ─── generateReport ───────────────────────────────────────────────────────────

export async function generateReport(
  userId: string,
  businessId: string,
  transactions: Transaction[],
  debts: Debt[],
  period: "daily" | "weekly" | "monthly",
): Promise<ExecutiveReport> {
  const id = crypto.randomUUID();
  const generatedAt = new Date().toISOString();

  // Step 1: Deterministic metrics — always computed
  const metrics = computeMetrics(transactions, debts);

  logger.info("Generating executive report", {
    userId,
    businessId,
    period,
    txCount: transactions.length,
    debtCount: debts.length,
  });

  // Step 2: Attempt AI-enhanced narrative
  if (isGroqAvailable()) {
    try {
      const topProductStr =
        metrics.topProducts.length > 0
          ? metrics.topProducts
              .slice(0, 3)
              .map((p) => `${p.name} (GH₵${p.revenue.toFixed(2)})`)
              .join(", ")
          : "N/A";

      const prompt = [
        `Business metrics for ${period} period:`,
        `Revenue=GH₵${metrics.totalRevenue.toFixed(2)}, Expenses=GH₵${metrics.totalExpenses.toFixed(2)}, Net=GH₵${metrics.netProfit.toFixed(2)}`,
        `Profit margin: ${metrics.profitMargin}%`,
        `Top products: ${topProductStr}`,
        `Debts outstanding: GH₵${metrics.debtExposure.toFixed(2)}`,
        `Total transactions: ${metrics.totalTransactions}`,
        `Cash flow trend: ${metrics.cashFlowTrend}`,
        ``,
        `Generate a 3-paragraph executive summary with key insights, 2-3 actionable recommendations, and risk alerts for an African SME business owner. Be concise, practical, and warm.`,
      ].join("\n");

      const result = await groqGenerate(prompt, {
        model: "advanced",
        maxTokens: 400,
        temperature: 0.55,
      });

      if (result && result.text.trim().length > 50) {
        const narrative = parseAiNarrative(result.text, result.model);

        logger.info("Executive report generated with AI", {
          userId,
          businessId,
          period,
          model: result.model,
          latencyMs: result.latencyMs,
        });

        return {
          id,
          userId,
          businessId,
          period,
          generatedAt,
          metrics,
          narrative,
          generationSource: "ai_enhanced",
        };
      }
    } catch (err) {
      logger.error("AI narrative generation failed, using deterministic fallback", {
        userId,
        error: String(err),
      });
    }
  }

  // Step 3: Deterministic fallback
  const narrative = buildDeterministicNarrative(metrics, period);

  logger.info("Executive report generated (deterministic)", {
    userId,
    businessId,
    period,
  });

  return {
    id,
    userId,
    businessId,
    period,
    generatedAt,
    metrics,
    narrative,
    generationSource: "deterministic",
  };
}
