/**
 * ╔══════════════════════════════════════════════════════════════════════════════╗
 * ║   ZURIA — REGRESSION GUARD                                                  ║
 * ║   Compares live pipeline output against the locked regression-baseline.json ║
 * ║   Any deviation from the baseline = REGRESSION.                             ║
 * ╚══════════════════════════════════════════════════════════════════════════════╝
 *
 * TWO MODES:
 *
 *   Normal mode (default):
 *     Loads regression-baseline.json and verifies every locked result still
 *     matches the live pipeline.  Fails loudly on first regression with the
 *     full list of broken IDs, the old value, and the new value.
 *
 *   Generate mode (run once when intentional changes are made):
 *     ZURIA_UPDATE_BASELINE=1 npx jest regression-guard --no-coverage
 *     Runs the full suite, writes a fresh baseline, and exits green.
 *
 * What is compared per test case:
 *   • intent       — which engine handles the message (hardest contract)
 *   • subIntent    — fine-grained classification within the engine
 *   • isDuplicate  — RULE 5 dedup flag
 *
 * Entity-level accuracy (amount, customerName …) is verified by the main
 * behavioral regression test (16-behavioral-regression.test.ts).  The guard's
 * job is routing stability — not re-implementing every assertion.
 *
 * UPDATING THE BASELINE (intentional changes only):
 *   1. Make your code change.
 *   2. Run the main regression test and confirm 0 failures.
 *   3. Run:  npx cross-env ZURIA_UPDATE_BASELINE=1 jest regression-guard --no-coverage
 *   4. Commit both the code change and the new regression-baseline.json together.
 */

import fs   from "fs";
import path from "path";

import { getRegressionSuite, type RegressionTest } from "./regression-suite";
import { normalizeGhanaianEnglish }                from "@/lib/intelligence/ghanaian-normalizer";
import { classifyMessage }                         from "@/lib/intelligence/intent-classifier";
import {
  enforceEngineIsolation,
  isDuplicateLedgerEntry,
} from "@/lib/intelligence/engine-guard";
import { parseTransaction }   from "@/lib/parsers/transaction-parser";
import type { ConversationContext } from "@/lib/intelligence/types";

// ─── Types ────────────────────────────────────────────────────────────────────

interface LockedResult {
  id:          string;
  intent:      string;
  subIntent:   string | null;
  isDuplicate: boolean;
}

interface Baseline {
  generatedAt:  string;
  totalLocked:  number;
  results:      LockedResult[];
}

// ─── Pipeline (mirrors 16-behavioral-regression.test.ts runPipeline) ─────────

function runPipeline(
  userInput: string,
  context:   RegressionTest["context"] | null,
) {
  const normalized = normalizeGhanaianEnglish(userInput);

  const ctx: ConversationContext | null = context ? {
    lastIntent:               (context.lastIntent ?? null) as any,
    activeFlow:               (context.activeFlow ?? "none") as any,
    lastPerson:               context.lastPerson  ?? null,
    lastAmount:               context.lastAmount  ?? null,
    lastAsset:                context.lastAsset   ?? null,
    lastTransactionSubIntent: (context.lastTransactionSubIntent ?? null) as any,
    lastTransactionId:        null,
    lastTransactionDesc:      null,
    conversationHistory:      [],
    pendingLimitNotification: null,
    subscriptionUiShownAt:    context.subscriptionUiShownAt ?? null,
    pendingTransaction:       null,
    lastNormalizedText:       context.lastNormalizedText ?? null,
    updatedAt:                context.updatedAt ?? new Date().toISOString(),
  } : null;

  const raw     = classifyMessage(normalized, ctx);
  const lastRaw = context?.lastNormalizedText ?? null;
  const guard   = enforceEngineIsolation(raw, ctx, lastRaw, normalized);
  const isRule5 = guard.violationRule === "RULE_5_DUPLICATE_SUPPRESSED";
  const final   = guard.blocked
    ? guard.override!
    : (isRule5 && guard.override ? guard.override : raw);

  const parsed       = parseTransaction(normalized);
  const isStockUpdate = final.sub_intent === "stock_update";

  return {
    intent:      final.intent,
    subIntent:   final.sub_intent,
    confidence:  final.confidence,
    isDuplicate: isDuplicateLedgerEntry(guard),
    amount:      isStockUpdate
      ? (final.entities.amount ?? null)
      : (final.entities.amount ?? (parsed.amount > 0 ? parsed.amount : null)),
  };
}

// ─── Paths ────────────────────────────────────────────────────────────────────

const BASELINE_PATH = path.join(__dirname, "regression-baseline.json");
const GENERATE_MODE = process.env["ZURIA_UPDATE_BASELINE"] === "1";

// ─── Generate mode ────────────────────────────────────────────────────────────

if (GENERATE_MODE) {
  describe("Regression Guard — generating baseline", () => {
    it("generates regression-baseline.json from current pipeline output", () => {
      const suite = getRegressionSuite();
      const results: LockedResult[] = suite.map((test) => {
        const r = runPipeline(test.userInput, test.context);
        return {
          id:          test.id,
          intent:      r.intent,
          subIntent:   r.subIntent,
          isDuplicate: r.isDuplicate,
        };
      });

      const baseline: Baseline = {
        generatedAt: new Date().toISOString(),
        totalLocked: results.length,
        results,
      };

      fs.writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + "\n");
      console.log(`\n✅  Baseline written → ${BASELINE_PATH}`);
      console.log(`   Locked ${results.length} test cases.`);
      console.log(`   Commit regression-baseline.json alongside your code change.\n`);

      expect(results.length).toBeGreaterThan(0);
    });
  });

} else {
  // ─── Guard mode (normal / CI) ───────────────────────────────────────────────

  describe("Regression Guard — no previously-passing test may regress", () => {

    // ── Load baseline ──────────────────────────────────────────────────────────
    let baseline: Baseline;
    try {
      baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8")) as Baseline;
    } catch {
      throw new Error(
        "regression-baseline.json not found.\n" +
        "Run the following command once to generate it:\n\n" +
        "  npx cross-env ZURIA_UPDATE_BASELINE=1 jest regression-guard --no-coverage\n"
      );
    }

    const suite = getRegressionSuite();

    // Build a lookup: id → test case (for context reconstruction)
    const suiteMap = new Map(suite.map((t) => [t.id, t]));

    // ── Per-test checks ────────────────────────────────────────────────────────
    it(`all ${baseline.totalLocked} locked tests still produce the same routing`, () => {
      const regressions: Array<{
        id:        string;
        field:     string;
        expected:  unknown;
        received:  unknown;
        input:     string;
      }> = [];

      for (const locked of baseline.results) {
        const test = suiteMap.get(locked.id);
        if (!test) continue; // test removed from suite — not a regression

        const live = runPipeline(test.userInput, test.context);

        if (live.intent !== locked.intent) {
          regressions.push({
            id:       locked.id,
            field:    "intent",
            expected: locked.intent,
            received: live.intent,
            input:    test.userInput,
          });
        }

        if (live.subIntent !== locked.subIntent) {
          regressions.push({
            id:       locked.id,
            field:    "subIntent",
            expected: locked.subIntent,
            received: live.subIntent,
            input:    test.userInput,
          });
        }

        if (live.isDuplicate !== locked.isDuplicate) {
          regressions.push({
            id:       locked.id,
            field:    "isDuplicate",
            expected: locked.isDuplicate,
            received: live.isDuplicate,
            input:    test.userInput,
          });
        }
      }

      if (regressions.length > 0) {
        const lines = [
          `\n${"═".repeat(72)}`,
          `  ❌  REGRESSION DETECTED — ${regressions.length} test(s) changed from baseline`,
          `${"═".repeat(72)}`,
          "",
          ...regressions.map((r, i) =>
            [
              `  [${i + 1}] ${r.id}`,
              `       Input   : "${r.input}"`,
              `       Field   : ${r.field}`,
              `       Baseline: ${JSON.stringify(r.expected)}`,
              `       Live    : ${JSON.stringify(r.received)}`,
            ].join("\n")
          ),
          "",
          `${"─".repeat(72)}`,
          `  If this change is intentional, update the baseline:`,
          `    npx cross-env ZURIA_UPDATE_BASELINE=1 jest regression-guard --no-coverage`,
          `  Then commit regression-baseline.json with your code change.`,
          `${"═".repeat(72)}\n`,
        ].join("\n");

        throw new Error(lines);
      }
    });

    // ── Baseline integrity ─────────────────────────────────────────────────────
    it("baseline covers at least 95% of the current suite", () => {
      const coverage = baseline.totalLocked / suite.length;
      expect(coverage).toBeGreaterThanOrEqual(0.95);
    });

    // ── No new ERROR regressions ───────────────────────────────────────────────
    it("no test that previously resolved to a financial engine now errors", () => {
      const financialEngines = new Set(["LEDGER_ENGINE", "LEDGER_QUERY_ENGINE"]);
      const newErrors: string[] = [];

      for (const locked of baseline.results) {
        if (!financialEngines.has(locked.intent)) continue;
        const test = suiteMap.get(locked.id);
        if (!test) continue;

        const live = runPipeline(test.userInput, test.context);
        if (live.intent === "ERROR") {
          newErrors.push(
            `${locked.id}: "${test.userInput}" was ${locked.intent}, now ERROR`
          );
        }
      }

      if (newErrors.length > 0) {
        throw new Error(
          `\n${newErrors.length} financial message(s) now route to ERROR:\n` +
          newErrors.map((e) => `  • ${e}`).join("\n") + "\n"
        );
      }
    });

  });
}
