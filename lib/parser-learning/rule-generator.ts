/**
 * Parser Learning — Rule Generator
 *
 * Analyses stored training examples to identify patterns and suggest
 * new parser rules. All Firestore writes are fire-and-forget.
 *
 * Server-only.
 */

import { getAdminDb } from "@/lib/firebase/admin";
import type { TrainingExample } from "./collector";

// ─── New collections (not in collections.ts) ──────────────────────────────────
// "parser_training_examples" — source data for analysis
// "parser_patterns"          — generated analysis snapshots, doc id = YYYY-MM-DD

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ParserRule {
  id: string;
  pattern: string;       // the phrase / keyword pattern
  suggestedType: string; // transaction type to map to
  confidence: number;    // how confident this rule is (0–1)
  occurrences: number;   // how many times seen
  language: string;
  examples: string[];    // sample inputs that match
  generatedAt: string;
}

export interface ParserPatternAnalysis {
  totalExamples: number;
  divergenceRate: number; // % where parser and AI disagreed (0–100)
  topFailurePatterns: Array<{ pattern: string; count: number }>;
  suggestedRules: ParserRule[];
  analysisDate: string;
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Extracts 2–3 word phrases from the raw inputs of training examples and
 * groups them by the accepted transaction type.
 *
 * Returns a map of lowercase phrase → { type, count }.
 */
export function extractKeyPhrases(
  examples: TrainingExample[],
): Map<string, { type: string; count: number }> {
  const phraseMap = new Map<string, { type: string; count: number }>();

  for (const ex of examples) {
    const words = ex.rawInput
      .toLowerCase()
      // Keep letters (including extended Latin / Ghanaian chars) and whitespace
      .replace(/[^a-zÀ-ɏ\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1);

    // Generate 2-word and 3-word n-grams
    for (let n = 2; n <= 3; n++) {
      for (let i = 0; i <= words.length - n; i++) {
        const phrase = words.slice(i, i + n).join(" ");
        const existing = phraseMap.get(phrase);
        if (existing) {
          if (existing.type === ex.acceptedResult.type) {
            existing.count += 1;
          }
          // If types disagree, keep the first-seen type (most common wins later)
        } else {
          phraseMap.set(phrase, { type: ex.acceptedResult.type, count: 1 });
        }
      }
    }
  }

  return phraseMap;
}

// ─── Firestore operations ─────────────────────────────────────────────────────

/**
 * Reads up to `limit` recent training examples, analyses patterns, and returns
 * a ParserPatternAnalysis.  Returns an empty analysis on any error.
 */
export async function analyzePatterns(
  limit = 500,
): Promise<ParserPatternAnalysis> {
  const analysisDate = new Date().toISOString().slice(0, 10);
  const emptyAnalysis: ParserPatternAnalysis = {
    totalExamples: 0,
    divergenceRate: 0,
    topFailurePatterns: [],
    suggestedRules: [],
    analysisDate,
  };

  try {
    const db = getAdminDb();

    const snapshot = await db
      .collection("parser_training_examples") // new collection — not in collections.ts
      .orderBy("timestamp", "desc")
      .limit(limit)
      .get();

    if (snapshot.empty) return emptyAnalysis;

    const examples = snapshot.docs.map((d) => d.data() as TrainingExample);
    const totalExamples = examples.length;
    const divergedCount = examples.filter((e) => e.diverged).length;
    const divergenceRate =
      totalExamples > 0 ? (divergedCount / totalExamples) * 100 : 0;

    // ── Failure pattern grouping ──────────────────────────────────────────────
    // Identify phrases from diverged/low-confidence examples
    const divergedExamples = examples.filter((e) => e.diverged);
    const failurePhraseCounts = new Map<string, number>();

    for (const ex of divergedExamples) {
      const words = ex.rawInput.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
      for (let i = 0; i <= words.length - 2; i++) {
        const phrase = words.slice(i, i + 2).join(" ");
        failurePhraseCounts.set(phrase, (failurePhraseCounts.get(phrase) ?? 0) + 1);
      }
    }

    const topFailurePatterns = [...failurePhraseCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([pattern, count]) => ({ pattern, count }));

    // ── Rule generation ───────────────────────────────────────────────────────
    const phraseMap = extractKeyPhrases(examples);
    const generatedAt = new Date().toISOString();
    const suggestedRules: ParserRule[] = [];

    for (const [phrase, { type, count }] of phraseMap.entries()) {
      if (count < 3) continue; // Only promote phrases seen 3+ times

      // Gather sample inputs that contain this phrase
      const matchingExamples = examples
        .filter((e) => e.rawInput.toLowerCase().includes(phrase))
        .slice(0, 5)
        .map((e) => e.rawInput);

      // Detect predominant language for this phrase's examples
      const langCounts: Record<string, number> = {};
      for (const ex of examples.filter((e) =>
        e.rawInput.toLowerCase().includes(phrase),
      )) {
        langCounts[ex.language] = (langCounts[ex.language] ?? 0) + 1;
      }
      const language = Object.entries(langCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "english";

      // Confidence: ratio of consistent-type occurrences to total phrase occurrences
      const totalPhraseOccurrences = examples.filter((e) =>
        e.rawInput.toLowerCase().includes(phrase),
      ).length;
      const ruleConfidence = totalPhraseOccurrences > 0 ? count / totalPhraseOccurrences : 0;

      suggestedRules.push({
        id: crypto.randomUUID(),
        pattern: phrase,
        suggestedType: type,
        confidence: Math.min(1, ruleConfidence),
        occurrences: count,
        language,
        examples: matchingExamples,
        generatedAt,
      });
    }

    // Sort by occurrences desc, take top 50
    suggestedRules.sort((a, b) => b.occurrences - a.occurrences);
    suggestedRules.splice(50);

    return {
      totalExamples,
      divergenceRate,
      topFailurePatterns,
      suggestedRules,
      analysisDate,
    };
  } catch {
    return emptyAnalysis;
  }
}

/**
 * Saves a ParserPatternAnalysis snapshot to Firestore.
 * Doc id is the analysis date string (YYYY-MM-DD) — one doc per day.
 * Fire-and-forget.
 */
export async function savePatternAnalysis(
  analysis: ParserPatternAnalysis,
): Promise<void> {
  try {
    const db = getAdminDb();
    await db
      .collection("parser_patterns") // new collection — not in collections.ts
      .doc(analysis.analysisDate)
      .set(analysis);
  } catch {
    // Intentionally swallowed
  }
}
