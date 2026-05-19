// Semantic retrieval layer — context lookup for AI reasoning

import { loadMemory } from "@/lib/memory";
import type { MemoryBundle } from "@/lib/memory";

// ─── Re-exports from memory/retrieval ────────────────────────────────────────

export { resolveReference, buildContextSummary } from "@/lib/memory/retrieval";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * A single ranked context result from the retrieval layer.
 */
export interface RetrievalResult {
  source: "memory" | "transactions" | "debts" | "context";
  relevance: number;
  data: Record<string, unknown>;
  summary: string;
}

// ─── scoreRelevance ───────────────────────────────────────────────────────────

/**
 * Compute Jaccard similarity between a query string and a candidate text.
 *
 * Tokenizes both strings to lowercase words, then computes:
 *   |intersection| / |union|
 *
 * Returns 0 when either string is empty or contains no tokens.
 *
 * @param query  The search query.
 * @param text   The candidate text to score against the query.
 * @returns A relevance score in [0, 1].
 */
export function scoreRelevance(query: string, text: string): number {
  if (!query.trim() || !text.trim()) return 0;

  const tokenize = (s: string): Set<string> => {
    const words = s.toLowerCase().match(/\b\w+\b/g);
    if (!words || words.length === 0) return new Set();
    return new Set(words);
  };

  const queryTokens = tokenize(query);
  const textTokens = tokenize(text);

  if (queryTokens.size === 0 || textTokens.size === 0) return 0;

  // Intersection
  let intersectionSize = 0;
  for (const token of queryTokens) {
    if (textTokens.has(token)) intersectionSize++;
  }

  // Union
  const unionSize = queryTokens.size + textTokens.size - intersectionSize;
  if (unionSize === 0) return 0;

  return intersectionSize / unionSize;
}

// ─── retrieveContext ──────────────────────────────────────────────────────────

/**
 * Orchestrate context retrieval for a given user, business, and query.
 *
 * Retrieval steps:
 * 1. Load the full memory bundle (business profile + recent transactions/debts).
 * 2. Score each memory fragment against the query using Jaccard similarity.
 * 3. Return up to 5 results ranked by relevance (highest first).
 *
 * Returns an empty array on any error.
 *
 * @param userId      The user/business owner identifier.
 * @param businessId  The business identifier.
 * @param query       The natural-language query driving retrieval.
 */
export async function retrieveContext(
  userId: string,
  businessId: string,
  query: string,
): Promise<RetrievalResult[]> {
  try {
    const bundle: MemoryBundle = await loadMemory(userId, businessId);
    const { profile, context, contextSummary } = bundle;

    const candidates: RetrievalResult[] = [];

    // ── Context summary as a single "context" source ───────────────────────
    if (contextSummary) {
      candidates.push({
        source: "context",
        relevance: scoreRelevance(query, contextSummary),
        data: { summary: contextSummary },
        summary: contextSummary,
      });
    }

    // ── Recent transactions ────────────────────────────────────────────────
    for (const txn of context.recentTransactions) {
      const txnText = [
        txn.type,
        txn.product ?? "",
        `amount ${txn.amount}`,
      ]
        .filter(Boolean)
        .join(" ");

      const relevance = scoreRelevance(query, txnText);
      if (relevance > 0) {
        candidates.push({
          source: "transactions",
          relevance,
          data: {
            type: txn.type,
            amount: txn.amount,
            product: txn.product,
            createdAt: txn.createdAt,
          },
          summary: `${txn.type}${txn.product ? " " + txn.product : ""} GH₵${txn.amount}`,
        });
      }
    }

    // ── Outstanding debts ──────────────────────────────────────────────────
    for (const debt of context.recentDebts) {
      const debtText = `debt ${debt.customerName} owes ${debt.amount}`;
      const relevance = scoreRelevance(query, debtText);
      if (relevance > 0) {
        candidates.push({
          source: "debts",
          relevance,
          data: {
            customerName: debt.customerName,
            amount: debt.amount,
          },
          summary: `${debt.customerName} owes GH₵${debt.amount}`,
        });
      }
    }

    // ── Business profile fragment ──────────────────────────────────────────
    const profileText = [
      profile.inferredCategory !== "unknown" ? `business ${profile.inferredCategory}` : "",
      ...profile.primaryProducts.map((p) => `sells ${p}`),
      ...profile.primarySuppliers.map((s) => `supplier ${s}`),
      `revenue ${profile.averageDailyRevenue}`,
    ]
      .filter(Boolean)
      .join(" ");

    if (profileText) {
      const relevance = scoreRelevance(query, profileText);
      candidates.push({
        source: "memory",
        relevance,
        data: {
          category: profile.inferredCategory,
          primaryProducts: profile.primaryProducts,
          primarySuppliers: profile.primarySuppliers,
          averageDailyRevenue: profile.averageDailyRevenue,
          riskLevel: profile.riskLevel,
        },
        summary: profileText.slice(0, 200),
      });
    }

    // ── Sort by relevance desc and return top 5 ────────────────────────────
    return candidates
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, 5);
  } catch {
    return [];
  }
}
