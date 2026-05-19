#!/usr/bin/env node
/**
 * update-baseline.mjs
 *
 * Convenience wrapper around the ZURIA_UPDATE_BASELINE guard mode.
 * Runs via:   npm run regression:update-baseline
 *
 * This script:
 *   1. Confirms the full behavioral suite (16-behavioral-regression) is green.
 *   2. If green, regenerates regression-baseline.json.
 *   3. Exits non-zero if the behavioral suite has failures (don't lock a broken state).
 */

import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

// ── Colours ───────────────────────────────────────────────────────────────────
const GREEN  = (s) => `\x1b[32m${s}\x1b[0m`;
const RED    = (s) => `\x1b[31m${s}\x1b[0m`;
const YELLOW = (s) => `\x1b[33m${s}\x1b[0m`;
const BOLD   = (s) => `\x1b[1m${s}\x1b[0m`;

function run(cmd, opts = {}) {
  return execSync(cmd, { cwd: ROOT, stdio: "inherit", ...opts });
}

function runCapture(cmd) {
  return execSync(cmd, { cwd: ROOT, encoding: "utf8" });
}

console.log();
console.log(BOLD("═".repeat(60)));
console.log(BOLD("  ZURIA — Update Regression Baseline"));
console.log(BOLD("═".repeat(60)));
console.log();

// ── Step 1: Verify behavioral suite is green ──────────────────────────────────
console.log("Step 1/2  Running full behavioral regression suite …");
console.log("          (This must be 100 % green before locking a new baseline)");
console.log();

try {
  run("npx jest 16-behavioral-regression --no-coverage");
} catch {
  console.log();
  console.log(RED("❌  Behavioral regression suite has failures."));
  console.log(RED("    Fix all failures before updating the baseline."));
  console.log();
  process.exit(1);
}

console.log();
console.log(GREEN("✅  Behavioral suite is green."));
console.log();

// ── Step 2: Regenerate baseline ────────────────────────────────────────────────
console.log("Step 2/2  Generating new regression-baseline.json …");
console.log();

const env = { ...process.env, ZURIA_UPDATE_BASELINE: "1" };
try {
  execSync("npx jest regression-guard --no-coverage", {
    cwd: ROOT,
    stdio: "inherit",
    env,
  });
} catch {
  console.log();
  console.log(RED("❌  Baseline generation failed."));
  process.exit(1);
}

// ── Done ───────────────────────────────────────────────────────────────────────
const baselinePath = path.join(ROOT, "__tests__", "regression", "regression-baseline.json");
let count = "?";
try {
  const b = JSON.parse(readFileSync(baselinePath, "utf8"));
  count = b.totalLocked;
} catch { /* ignore */ }

console.log();
console.log(BOLD("═".repeat(60)));
console.log(GREEN(`✅  Baseline updated — ${count} test cases locked.`));
console.log();
console.log("  Next steps:");
console.log(`    git add __tests__/regression/regression-baseline.json`);
console.log(`    git commit -m "chore: update regression baseline"`);
console.log();
console.log(YELLOW("  Remember: commit the baseline alongside the code change"));
console.log(YELLOW("  that caused it, so reviewers see both together."));
console.log(BOLD("═".repeat(60)));
console.log();
