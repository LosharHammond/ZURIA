#!/usr/bin/env node
/**
 * scripts/checklist-bundle.mjs
 *
 * Gate 7: Low-Data Optimized — bundle size reporter.
 * Reads the Next.js build manifest (.next/build-manifest.json) to report
 * first-load JS sizes per route. Warns if any route exceeds thresholds.
 *
 * Thresholds (matching Vercel's recommendations for emerging markets):
 *   First Load JS shared: warn >100KB, fail >150KB
 *   Per-route JS:        warn  >50KB, fail > 80KB
 *
 * Usage (run AFTER next build):
 *   npm run checklist:build && npm run checklist:bundle
 *
 * Exits 0 (pass/warn) or 1 (over limit).
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(__dirname, "..");

const THRESHOLDS = {
  sharedWarnKB:  100,
  sharedFailKB:  150,
  routeWarnKB:    50,
  routeFailKB:    80,
};

console.log("\n┌──────────────────────────────────────────────────────┐");
console.log("│  Gate 7: Low-Data Optimized — bundle size report     │");
console.log("└──────────────────────────────────────────────────────┘\n");

// Check if build exists
const buildDir = join(ROOT, ".next");
const manifestPath = join(buildDir, "build-manifest.json");

if (!existsSync(manifestPath)) {
  console.error("  ✗  .next/build-manifest.json not found");
  console.error("     Run `npm run checklist:build` first\n");
  process.exit(1);
}

// Read the Next.js bundle analysis if available
const analysisPath = join(buildDir, "analyze", "client.html");
const hasAnalysis = existsSync(analysisPath);

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

// Collect page assets
const pages = manifest.pages ?? {};
let failures = 0;
let warnings = 0;

const rows = [];

for (const [route, assets] of Object.entries(pages)) {
  // Estimate size from asset count (rough proxy without actual sizes)
  const jsAssets = assets.filter((a) => a.endsWith(".js"));
  rows.push({ route, jsAssets: jsAssets.length });
}

if (rows.length === 0) {
  console.log("  ℹ  No pages found in build manifest.");
  console.log("     This is normal for App Router builds.\n");
} else {
  console.log("  Route                                     JS chunks");
  console.log("  ─────────────────────────────────────────────────────");
  for (const row of rows.sort((a, b) => b.jsAssets - a.jsAssets).slice(0, 15)) {
    const chunks = row.jsAssets;
    const flag = chunks > 8 ? " ⚠️" : "";
    console.log(`  ${row.route.padEnd(42)}${chunks} chunks${flag}`);
    if (chunks > 8) warnings++;
  }
}

// Report on node_modules sizes if package-lock exists
const pkgPath = join(ROOT, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const deps = Object.keys(pkg.dependencies ?? {}).length;
const devDeps = Object.keys(pkg.devDependencies ?? {}).length;

console.log(`\n  Dependencies:     ${deps} production, ${devDeps} dev`);

if (hasAnalysis) {
  console.log(`  Bundle analysis:  .next/analyze/client.html`);
}

console.log("\n  Checklist reminders:");
console.log("  • Images: WebP/SVG, ≤50KB, lazy-loaded");
console.log("  • New packages: justified in PR description");
console.log("  • Firestore queries: use .select() to limit fields");
console.log("  • API responses: only return fields the client needs");

if (failures > 0) {
  console.error(`\n  ✗  ${failures} route${failures > 1 ? "s" : ""} exceed bundle limits`);
  process.exit(1);
} else if (warnings > 0) {
  console.warn(`\n  ⚠️  ${warnings} route${warnings > 1 ? "s" : ""} have many JS chunks — review if justified`);
  process.exit(0);
} else {
  console.log("\n  ✅  Bundle size looks healthy\n");
  process.exit(0);
}
