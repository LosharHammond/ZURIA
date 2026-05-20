#!/usr/bin/env node
/**
 * scripts/checklist-logs.mjs
 *
 * Gate 3: Logged
 * Scans lib/ and app/api/ for raw console.log / console.warn / console.error
 * usage in production code. Client components are allowed console.error for
 * unrecoverable UI errors only.
 *
 * Exits 0 (pass) or 1 (violations found).
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(__dirname, "..");

// Directories to scan
const SCAN_DIRS = ["lib", "app/api"];

// Patterns that are violations
const CONSOLE_PATTERN = /\bconsole\.(log|warn|error|info|debug|trace)\s*\(/g;

// Files/patterns to ignore
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

  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip comment lines
    if (/^\s*(\/\/|\/\*)/.test(line)) continue;

    const matches = [...(line.matchAll(CONSOLE_PATTERN) ?? [])];
    for (const match of matches) {
      violations++;
      console.error(
        `  ✗  ${rel}:${i + 1}  →  console.${match[1]}() found`,
      );
      console.error(
        `       Use createLogger("${rel.split("/").pop()?.replace(/\.(ts|tsx)$/, "")}") instead`,
      );
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
console.log("│  Gate 3: Logged — console usage scan            │");
console.log("└─────────────────────────────────────────────────┘");
console.log(`  Scanning: ${SCAN_DIRS.join(", ")}\n`);

for (const dir of SCAN_DIRS) {
  scanDir(dir);
}

if (violations === 0) {
  console.log(`  ✅  0 console violations in ${filesScanned} files scanned`);
  console.log("      All production code uses createLogger()\n");
  process.exit(0);
} else {
  console.error(
    `\n  ✗  ${violations} violation${violations > 1 ? "s" : ""} found in ${filesScanned} files`,
  );
  console.error("     Replace with createLogger() from @/lib/observability/logger\n");
  process.exit(1);
}
