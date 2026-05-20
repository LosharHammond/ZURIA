# install-hooks.ps1 — installs ZURIA git hooks (Windows / PowerShell)
#
# Usage (from repo root):
#   .\scripts\install-hooks.ps1
#
# What it installs:
#   .git/hooks/pre-commit  — project-wide guard (TS + ESLint + all tests)
#                            + Production Checklist reminder
#   .git/hooks/pre-push    — full behavioral suite (1000+ cases)
#                            + automated checklist gates (logs + silent catch)

$ErrorActionPreference = "Stop"

$gitDir   = (git rev-parse --git-dir)
$hooksDir = Join-Path $gitDir "hooks"

if (-not (Test-Path $hooksDir)) {
    New-Item -ItemType Directory -Path $hooksDir | Out-Null
}

Write-Host ""
Write-Host "Installing ZURIA regression hooks into $hooksDir ..." -ForegroundColor Cyan

# ── pre-commit: project-wide guard + checklist reminder ───────────────────────
$preCommit = @'
#!/usr/bin/env bash
# ZURIA pre-commit: project-wide regression guard + production checklist
set -e
cd "$(git rev-parse --show-toplevel)"

echo ""
echo "+--------------------------------------------------------------+"
echo "|  ZURIA Project Guard -- pre-commit check                    |"
echo "|  Checks: TypeScript . ESLint . all test suites              |"
echo "+--------------------------------------------------------------+"

if [ "${SKIP_REGRESSION:-0}" = "1" ]; then
  echo "WARNING: SKIP_REGRESSION=1 -- guard bypassed."
  exit 0
fi

node scripts/project-guard.mjs
STATUS=$?

if [ $STATUS -ne 0 ]; then
  echo ""
  echo "FAILED: Project guard -- commit blocked."
  echo ""
  echo "If the change is intentional (e.g. you fixed a failing test):"
  echo "  npm run project:update-baseline"
  echo "  git add __tests__/project-health-baseline.json"
  echo ""
  echo "To bypass in an emergency:"
  echo "  SKIP_REGRESSION=1 git commit ..."
  echo ""
  exit 1
fi

echo "PASSED: Project guard."
echo ""

# -- Production Checklist reminder -------------------------------------------
echo "+--------------------------------------------------------------+"
echo "|  ZURIA Production Checklist -- manual gates reminder        |"
echo "|  See PRODUCTION_CHECKLIST.md for full details               |"
echo "+--------------------------------------------------------------+"
echo ""
echo "  Automated gates just ran:"
echo "    OK  1. Tested          -- tests passing"
echo "    OK  9. TypeScript clean -- 0 errors"
echo ""
echo "  Manual gates -- confirm before merging to main:"
echo "    [ ] 2.  Committed       -- clean tree, no debug code, no secrets"
echo "    [ ] 3.  Logged          -- run: npm run checklist:logs"
echo "    [ ] 4.  Observable      -- no silent catch{}, errors reach Sentry"
echo "    [ ] 5.  Retry-safe      -- idempotent writes, deterministic doc IDs"
echo "    [ ] 6.  Mobile-friendly -- tested at 360px, tap targets >=44px"
echo "    [ ] 7.  Low-data        -- bundle justified, .select() used"
echo "    [ ] 8.  Offline-safe    -- mutations go through offline queue"
echo "    [ ] 10. Build verified  -- run: npm run checklist:build"
echo ""
echo "  Full automated check: npm run checklist"
echo ""
'@

$preCommitPath = Join-Path $hooksDir "pre-commit"
[System.IO.File]::WriteAllText($preCommitPath, $preCommit, [System.Text.UTF8Encoding]::new($false))

# ── pre-push: behavioral suite + checklist gates ──────────────────────────────
$prePush = @'
#!/usr/bin/env bash
# ZURIA pre-push: full behavioral regression suite + checklist gates
set -e
cd "$(git rev-parse --show-toplevel)"

echo ""
echo "+---------------------------------------------------------------+"
echo "|  ZURIA Pre-Push -- Full Regression + Checklist Gates         |"
echo "|  Running: 1000+ behavioral tests + logs + silent catch scan  |"
echo "+---------------------------------------------------------------+"

if [ "${SKIP_REGRESSION:-0}" = "1" ]; then
  echo "WARNING: SKIP_REGRESSION=1 -- suite bypassed."
  exit 0
fi

npx jest 16-behavioral-regression --no-coverage 2>&1
JEST_STATUS=$?

if [ $JEST_STATUS -ne 0 ]; then
  echo ""
  echo "FAILED: Behavioral regression -- push blocked."
  echo "Fix the failing tests before pushing."
  echo ""
  exit 1
fi

# Gate 3: Logged
node scripts/checklist-logs.mjs
LOGS_STATUS=$?

# Gate 4: Observable
node scripts/checklist-silent-catch.mjs
CATCH_STATUS=$?

if [ $LOGS_STATUS -ne 0 ] || [ $CATCH_STATUS -ne 0 ]; then
  echo ""
  echo "FAILED: Checklist gates -- push blocked."
  echo "Fix all violations, then re-push."
  echo ""
  exit 1
fi

echo "PASSED: All behavioral tests + checklist gates. Pushing ..."
echo ""
echo "  Remember to run before merging:"
echo "    npm run checklist:build   -- Gate 10: Production build"
echo ""
'@

$prePushPath = Join-Path $hooksDir "pre-push"
[System.IO.File]::WriteAllText($prePushPath, $prePush, [System.Text.UTF8Encoding]::new($false))

Write-Host ""
Write-Host "Hooks installed:" -ForegroundColor Green
Write-Host "  pre-commit  -> project-wide guard + Production Checklist reminder"
Write-Host "  pre-push    -> 1000+ behavioral tests + automated checklist gates"
Write-Host ""
Write-Host "  Production Checklist: see PRODUCTION_CHECKLIST.md"
Write-Host "  Full automated check: npm run checklist"
Write-Host ""
Write-Host "NOTE: Git hooks are bash scripts. They run via Git Bash on Windows."
Write-Host "      Make sure Git Bash is on your PATH."
Write-Host ""
Write-Host "To bypass in an emergency: set SKIP_REGRESSION=1 before committing."
Write-Host ""
