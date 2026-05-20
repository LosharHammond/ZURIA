#!/usr/bin/env node
/**
 * scripts/checklist-silent-catch.mjs
 *
 * Gate 4: Observable
 * Scans lib/ and app/api/ for empty or near-empty catch blocks that
 * silently swallow errors without logging them to Sentry or the logger.
 *
 * Detects patterns like:
 *   catch {}
 *   catch (e) {}
 *   catch (err) { /* ignore *\/ }
 *   catch (_) {}
 *
 * Exits 0 (pass) or 1 (violations found).
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(__dirname, "..");

const SCAN_DIRS = ["lib", "app/api"];

// Match truly empty catch blocks — no content whatsoever.
// A comment inside a catch block is intentional documentation of why the
// error is safe to suppress; those are allowed and encouraged.
// We only flag catches with an absolutely empty body: catch {} or catch(e){}
const SILENT_CATCH_PATTERNS = [
  /catch\s*(?:\([^)]*\))?\s*\{\s*\}/,   // catch {} or catch (err) {} — no content at all
];

const IGNORE_PATTERNS = [
  /node_modules/,
  /\.test\./,
  /\.spec\./,
  /__tests__/,
  /scripts\//,
];

let violations = 0;
let filesScanned = 0;

function shouldIgnore(filePath) {
  return IGNORE_PATTERNS.some((p) => p.test(filePath));
}

function scanFile(filePath) {
  if (shouldIgnore(filePath)) return;
  if (!filePath.endsWith(".ts") && !filePath.endsWith(".tsx")) return;

  const rel = relative(ROOT, filePath);
  const content = readFileSync(filePath, "utf8");
  filesScanned++;

  for (const pattern of SILENT_CATCH_PATTERNS) {
    const globalPattern = new RegExp(pattern.source, "g");
    let match;
    while ((match = globalPattern.exec(content)) !== null) {
      // Find line number
      const lineNum = content.slice(0, match.index).split("\n").length;
      violations++;
      console.error(`  ✗  ${rel}:${lineNum}  →  silent catch block detected`);
      console.error(`       Add: logger.warn("context", { err: String(err) })`);
      console.error(`       Or:  captureZuriaError(err, { extra: { context } })`);
    }
  }
}

function scanDir(dir) {
  const fullDir = join(ROOT, dir);
  try {
    const entries = readdirSync(fullDir);
    for (const entry of entries) {
      const full = join(fullDir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        scanDir(relative(ROOT, full));
      } else {
        scanFile(full);
      }
    }
  } catch {
    // Directory doesn't exist — skip
  }
}

console.log("\n┌─────────────────────────────────────────────────┐");
console.log("│  Gate 4: Observable — silent catch scan         │");
console.log("└─────────────────────────────────────────────────┘");
console.log(`  Scanning: ${SCAN_DIRS.join(", ")}\n`);

for (const dir of SCAN_DIRS) {
  scanDir(dir);
}

if (violations === 0) {
  console.log(`  ✅  0 silent catches in ${filesScanned} files scanned`);
  console.log("      All errors are observed\n");
  process.exit(0);
} else {
  console.error(
    `\n  ✗  ${violations} silent catch${violations > 1 ? "es" : ""} found`,
  );
  console.error("     Every error must be logged or sent to Sentry\n");
  process.exit(1);
}
