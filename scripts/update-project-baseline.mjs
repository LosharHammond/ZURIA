#!/usr/bin/env node
/**
 * update-project-baseline.mjs
 *
 * Convenience wrapper: regenerates __tests__/project-health-baseline.json
 * by running all checks and locking the current results.
 *
 * Usage:   npm run project:update-baseline
 */

import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

execSync("node scripts/project-guard.mjs", {
  cwd: ROOT,
  stdio: "inherit",
  env: { ...process.env, ZURIA_UPDATE_PROJECT_BASELINE: "1" },
});
