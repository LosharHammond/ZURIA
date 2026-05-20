#!/usr/bin/env node
/**
 * scripts/checklist.mjs
 *
 * ZURIA Production Checklist — master runner.
 * Runs all automated gates and reports a final go/no-go.
 *
 * Usage:
 *   npm run checklist          — all automated gates (skips slow build)
 *   npm run checklist:full     — all gates INCLUDING next build (slow)
 *
 * Gates:
 *   [AUTO] 1. Tested          — npm run project:guard
 *   [AUTO] 3. Logged          — scripts/checklist-logs.mjs
 *   [AUTO] 4. Observable      — scripts/checklist-silent-catch.mjs
 *   [AUTO] 9. TypeScript clean — npm run typecheck
 *   [SLOW]10. Production build — scripts/checklist-build.mjs (--full only)
 *
 *   [MANUAL] 2. Committed
 *   [MANUAL] 5. Retry-safe
 *   [MANUAL] 6. Mobile-friendly
 *   [MANUAL] 7. Low-data optimized
 *   [MANUAL] 8. Offline-safe
 *
 * Exits 0 (all automated gates green) or 1 (any gate failed).
 */

import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { join } from "path";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(__dirname, "..");

const includeBuild = process.argv.includes("--full");

// ─── Gate definitions ──────────────────────────────────────────────────────

const AUTOMATED_GATES = [
  {
    id: 9,
    name: "TypeScript clean",
    cmd: "npx tsc --noEmit --skipLibCheck",
    fast: true,
  },
  {
    id: 3,
    name: "Logged (no console.log)",
    cmd: "node scripts/checklist-logs.mjs",
    fast: true,
  },
  {
    id: 4,
    name: "Observable (no silent catches)",
    cmd: "node scripts/checklist-silent-catch.mjs",
    fast: true,
  },
  {
    id: 1,
    name: "Tested (project guard)",
    cmd: "node scripts/project-guard.mjs",
    fast: false, // ~20s for full test suite
  },
];

if (includeBuild) {
  AUTOMATED_GATES.push({
    id: 10,
    name: "Production build verified",
    cmd: "node scripts/checklist-build.mjs",
    fast: false,
  });
}

const MANUAL_GATES = [
  { id: 2,  name: "Committed — clean tree, no debug code, no secrets" },
  { id: 5,  name: "Retry-safe — idempotent writes, deterministic doc IDs" },
  { id: 6,  name: "Mobile-friendly — tested at 360px, tap targets ≥44px" },
  { id: 7,  name: "Low-data optimized — bundle justified, .select() used" },
  { id: 8,  name: "Offline-safe — mutations go through offline queue" },
];

// ─── Runner ────────────────────────────────────────────────────────────────

function run(cmd) {
  try {
    execSync(cmd, { cwd: ROOT, stdio: "pipe" });
    return { ok: true };
  } catch (err) {
    const output = [
      err.stdout?.toString().trim(),
      err.stderr?.toString().trim(),
    ]
      .filter(Boolean)
      .join("\n");
    return { ok: false, output };
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────

console.log("");
console.log("╔══════════════════════════════════════════════════════════╗");
console.log("║         ZURIA Production Checklist — All Gates          ║");
console.log("╚══════════════════════════════════════════════════════════╝");
console.log("");
if (includeBuild) {
  console.log("  Mode: FULL (including production build — slow)");
} else {
  console.log("  Mode: FAST (automated gates, skipping build)");
  console.log("  For production deploy: npm run checklist:full");
}
console.log("");

const results = [];
let anyFailed = false;

// ── Run automated gates ────────────────────────────────────────────────────
console.log("  ── Automated Gates ──────────────────────────────────────");
for (const gate of AUTOMATED_GATES.sort((a, b) => a.id - b.id)) {
  process.stdout.write(`  Gate ${gate.id}: ${gate.name} ... `);
  const t0 = Date.now();
  const result = run(gate.cmd);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  if (result.ok) {
    console.log(`✅  (${elapsed}s)`);
    results.push({ ...gate, ok: true });
  } else {
    console.log(`✗   FAILED (${elapsed}s)`);
    if (result.output) {
      const lines = result.output.split("\n").slice(0, 8);
      for (const line of lines) {
        console.error(`         ${line}`);
      }
    }
    results.push({ ...gate, ok: false });
    anyFailed = true;
  }
}

// ── Manual gates reminder ─────────────────────────────────────────────────
console.log("");
console.log("  ── Manual Gates (cannot be automated) ──────────────────");
for (const gate of MANUAL_GATES) {
  console.log(`  Gate ${gate.id}: [ ] ${gate.name}`);
}

// ── Final summary ─────────────────────────────────────────────────────────
const passed = results.filter((r) => r.ok).length;
const failed = results.filter((r) => !r.ok).length;

console.log("");
console.log("══════════════════════════════════════════════════════════");

if (anyFailed) {
  console.error(`✗  ${failed} automated gate${failed > 1 ? "s" : ""} FAILED — NOT safe to merge`);
  console.error("");
  console.error("  Fix all failures, then re-run: npm run checklist");
  console.error("");
  process.exit(1);
} else {
  console.log(`✅  All ${passed} automated gates passed`);
  console.log("");
  console.log("  Verify the 5 manual gates above, then this PR is");
  console.log("  ready to merge. See PRODUCTION_CHECKLIST.md for details.");
  console.log("");
  process.exit(0);
}
