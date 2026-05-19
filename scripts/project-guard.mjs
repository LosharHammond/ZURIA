#!/usr/bin/env node
/**
 * project-guard.mjs
 *
 * ZURIA Project-Wide Regression Guard
 * ─────────────────────────────────────
 * Runs every quality check and compares results against the locked baseline.
 * Fails (exit 1) if ANYTHING regresses from the baseline state.
 *
 * Checks:
 *   1. TypeScript compilation  — error count must not exceed baseline
 *   2. ESLint                  — error count must not exceed baseline
 *   3. All Jest test suites    — passing count per suite must not decrease
 *
 * Modes (controlled by env var):
 *   normal                         → compare against baseline, exit 1 on regression
 *   ZURIA_UPDATE_PROJECT_BASELINE=1 → regenerate baseline file and exit 0
 *
 * npm scripts:
 *   npm run project:guard            → guard mode
 *   npm run project:update-baseline  → regenerate baseline
 */

import { spawnSync }                        from "child_process";
import { existsSync, readFileSync,
         writeFileSync, unlinkSync }        from "fs";
import path                                 from "path";
import { fileURLToPath }                    from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT          = path.join(__dirname, "..");
const BASELINE_PATH = path.join(ROOT, "__tests__", "project-health-baseline.json");
const TMP_JEST      = path.join(ROOT, ".project-guard-jest.json");

// ── Colours ───────────────────────────────────────────────────────────────────
const GREEN  = (s) => `\x1b[32m${s}\x1b[0m`;
const RED    = (s) => `\x1b[31m${s}\x1b[0m`;
const YELLOW = (s) => `\x1b[33m${s}\x1b[0m`;
const BOLD   = (s) => `\x1b[1m${s}\x1b[0m`;
const DIM    = (s) => `\x1b[2m${s}\x1b[0m`;

function header(title) {
  console.log();
  const bar = "─".repeat(title.length + 4);
  console.log(BOLD(`┌${bar}┐`));
  console.log(BOLD(`│  ${title}  │`));
  console.log(BOLD(`└${bar}┘`));
}

// ── 1. TypeScript ─────────────────────────────────────────────────────────────
function checkTypeScript() {
  header("TypeScript");
  const r = spawnSync("npx", ["tsc", "--noEmit"], {
    cwd: ROOT, shell: true, encoding: "utf8",
  });
  const output = (r.stdout || "") + (r.stderr || "");
  const errors = (output.match(/error TS\d+/g) || []).length;
  if (errors === 0) {
    console.log(GREEN("  ✅  0 TypeScript errors"));
  } else {
    console.log(RED(`  ❌  ${errors} TypeScript error(s)`));
    const lines = output.trim().split("\n").slice(0, 20).map(l => "     " + l).join("\n");
    console.log(DIM(lines));
  }
  return errors;
}

// ── 2. ESLint ─────────────────────────────────────────────────────────────────
function checkESLint() {
  header("ESLint");
  const r = spawnSync("npx", ["next", "lint"], {
    cwd: ROOT, shell: true, encoding: "utf8",
  });
  const output = (r.stdout || "") + (r.stderr || "");

  // Count explicit "error" entries (not warnings)
  const errors = (output.match(/^\s*\d+:\d+\s+error\s/gm) || []).length;
  const hasError = r.status !== 0 && errors > 0;

  if (!hasError && errors === 0) {
    console.log(GREEN("  ✅  0 ESLint errors"));
  } else {
    console.log(RED(`  ❌  ${errors} ESLint error(s)`));
  }
  return errors;
}

// ── 3. Jest ───────────────────────────────────────────────────────────────────
function checkJest() {
  header("Jest — all test suites");

  // Suppress verbose Jest output — we read results from the JSON file.
  spawnSync("npx", ["jest", "--no-coverage", "--json", `--outputFile=${TMP_JEST}`], {
    cwd: ROOT, shell: true, stdio: "ignore",
  });

  if (!existsSync(TMP_JEST)) {
    console.log(RED("  ❌  Jest did not produce a JSON output file"));
    return { suites: {}, totalPassing: 0, totalFailing: 0, totalTests: 0 };
  }

  let data;
  try {
    data = JSON.parse(readFileSync(TMP_JEST, "utf8"));
  } catch {
    console.log(RED("  ❌  Failed to parse Jest JSON output"));
    return { suites: {}, totalPassing: 0, totalFailing: 0, totalTests: 0 };
  } finally {
    try { unlinkSync(TMP_JEST); } catch { /* ignore */ }
  }

  const suites = {};
  let totalPassing = 0, totalFailing = 0, totalTests = 0;

  for (const s of (data.testResults || [])) {
    const raw  = (s.name || s.testFilePath || "").replace(/\\/g, "/");
    const name = raw.replace(/.*__tests__\//, "");
    const passing = (s.assertionResults || []).filter(a => a.status === "passed").length;
    const failing  = (s.assertionResults || []).filter(a => a.status === "failed").length;
    const total    = (s.assertionResults || []).length;
    suites[name] = { passing, failing, total, status: s.status };
    totalPassing += passing;
    totalFailing  += failing;
    totalTests    += total;
  }

  return { suites, totalPassing, totalFailing, totalTests };
}

// ── Mode: update baseline ─────────────────────────────────────────────────────
function updateBaseline() {
  console.log();
  console.log(BOLD("═".repeat(62)));
  console.log(BOLD("  ZURIA — Update Project Health Baseline"));
  console.log(BOLD("═".repeat(62)));

  const tsErrors   = checkTypeScript();
  const eslintErrs = checkESLint();
  const jest       = checkJest();

  const baseline = {
    _comment: "ZURIA project-wide health baseline. Regenerate: npm run project:update-baseline",
    _note: "Guard rule: TS errors ≤ baseline, ESLint errors ≤ baseline, per-suite passing ≥ baseline.",
    generatedAt: new Date().toISOString().slice(0, 10),
    typeScriptErrors: tsErrors,
    eslintErrors: eslintErrs,
    suites: Object.fromEntries(
      Object.entries(jest.suites).sort(([a], [b]) => a.localeCompare(b))
    ),
    totalPassing: jest.totalPassing,
    totalFailing: jest.totalFailing,
    totalTests: jest.totalTests,
  };

  writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + "\n");

  console.log();
  console.log(BOLD("═".repeat(62)));
  console.log(GREEN("✅  Baseline updated"));
  console.log(`    ${jest.totalPassing} passing / ${jest.totalFailing} failing / ${jest.totalTests} total`);
  console.log(`    TypeScript errors: ${tsErrors}  |  ESLint errors: ${eslintErrs}`);
  console.log();
  console.log("  Next:");
  console.log("    git add __tests__/project-health-baseline.json");
  console.log(`    git commit -m "chore: update project health baseline"`);
  console.log(BOLD("═".repeat(62)));
  console.log();
}

// ── Mode: guard ───────────────────────────────────────────────────────────────
function runGuard() {
  if (!existsSync(BASELINE_PATH)) {
    console.error(RED("❌  No project baseline found. Run: npm run project:update-baseline"));
    process.exit(1);
  }

  const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  const failures = [];

  console.log();
  console.log(BOLD("═".repeat(62)));
  console.log(BOLD("  ZURIA — Project-Wide Regression Guard"));
  console.log(BOLD("═".repeat(62)));

  // 1. TypeScript
  const tsErrors = checkTypeScript();
  if (tsErrors > (baseline.typeScriptErrors ?? 0)) {
    failures.push(`TypeScript: ${tsErrors} error(s) (baseline: ${baseline.typeScriptErrors})`);
  }

  // 2. ESLint
  const eslintErrs = checkESLint();
  if (eslintErrs > (baseline.eslintErrors ?? 0)) {
    failures.push(`ESLint: ${eslintErrs} error(s) (baseline: ${baseline.eslintErrors})`);
  }

  // 3. Jest per-suite
  const jest = checkJest();
  const baselineSuites = baseline.suites || {};

  console.log();
  console.log(BOLD("  Per-suite results:"));

  for (const [name, current] of Object.entries(jest.suites)) {
    const b = baselineSuites[name];
    if (!b) {
      // New suite added — always fine
      console.log(GREEN(`    ✅  [NEW] ${name}  (${current.passing}/${current.total} passing)`));
      continue;
    }
    if (current.passing < b.passing) {
      const lost = b.passing - current.passing;
      console.log(RED(`    ❌  ${name}`));
      console.log(RED(`         ${current.passing}/${current.total} passing — lost ${lost} (baseline: ${b.passing})`));
      failures.push(`${name}: ${current.passing} passing (baseline: ${b.passing}, −${lost})`);
    } else {
      const gained = current.passing - b.passing;
      const tag = gained > 0 ? ` ${GREEN(`+${gained} 🎉`)}` : "";
      console.log(GREEN(`    ✅  ${name}  ${current.passing}/${current.total} passing${tag}`));
    }
  }

  // Detect deleted suites
  for (const name of Object.keys(baselineSuites)) {
    if (!jest.suites[name]) {
      failures.push(`${name}: suite removed (was ${baselineSuites[name].passing} passing)`);
      console.log(RED(`    ❌  MISSING suite: ${name}`));
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log();
  console.log(BOLD("═".repeat(62)));

  if (failures.length === 0) {
    console.log(GREEN("✅  No regressions — project health is stable"));
    console.log(`    ${jest.totalPassing} passing / ${jest.totalFailing} failing / ${jest.totalTests} total`);
    if (jest.totalPassing > baseline.totalPassing) {
      console.log(GREEN(`    🎉  +${jest.totalPassing - baseline.totalPassing} tests now passing vs baseline!`));
    }
    console.log(BOLD("═".repeat(62)));
    console.log();
    process.exit(0);
  } else {
    console.log(RED(`❌  ${failures.length} regression(s) detected:`));
    for (const f of failures) {
      console.log(RED(`   • ${f}`));
    }
    console.log();
    console.log(YELLOW("  To intentionally accept this state as the new baseline:"));
    console.log(YELLOW("    npm run project:update-baseline"));
    console.log(YELLOW("    git add __tests__/project-health-baseline.json"));
    console.log(BOLD("═".repeat(62)));
    console.log();
    process.exit(1);
  }
}

// ── Entrypoint ─────────────────────────────────────────────────────────────────
if (process.env.ZURIA_UPDATE_PROJECT_BASELINE === "1") {
  updateBaseline();
} else {
  runGuard();
}
