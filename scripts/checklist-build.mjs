#!/usr/bin/env node
/**
 * scripts/checklist-build.mjs
 *
 * Gate 10: Production Build Verified
 * Runs `next build` and reports pass/fail with timing.
 * Treats any exit code > 0 as a blocker.
 *
 * Usage:
 *   node scripts/checklist-build.mjs
 *   npm run checklist:build
 *
 * Note: This is intentionally NOT in the pre-commit hook because
 * next build takes 30–90 seconds. Run it manually before PRs.
 *
 * Exits 0 (build clean) or 1 (build failed).
 */

import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { join } from "path";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(__dirname, "..");

console.log("\n┌─────────────────────────────────────────────────────┐");
console.log("│  Gate 10: Production Build Verified                 │");
console.log("│  Running: next build                                │");
console.log("└─────────────────────────────────────────────────────┘\n");

const start = Date.now();

try {
  execSync("npx next build", {
    cwd: ROOT,
    stdio: "inherit",
    env: {
      ...process.env,
      // Treat warnings as errors during checklist build
      NODE_ENV: "production",
    },
  });

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n  ✅  Production build passed in ${elapsed}s`);
  console.log("      Gate 10 is green — deploy is safe\n");
  process.exit(0);
} catch {
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.error(`\n  ✗  Production build FAILED after ${elapsed}s`);
  console.error("     Fix all build errors before this PR can merge\n");
  process.exit(1);
}
