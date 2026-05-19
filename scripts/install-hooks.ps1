# install-hooks.ps1 — installs ZURIA git hooks (Windows / PowerShell)
#
# Usage (from repo root):
#   .\scripts\install-hooks.ps1
#
# What it installs:
#   .git/hooks/pre-commit  — project-wide guard (TS + ESLint + all tests vs baseline)
#   .git/hooks/pre-push    — full behavioral suite (1000+ cases)

$ErrorActionPreference = "Stop"

$gitDir   = (git rev-parse --git-dir)
$hooksDir = Join-Path $gitDir "hooks"

if (-not (Test-Path $hooksDir)) {
    New-Item -ItemType Directory -Path $hooksDir | Out-Null
}

Write-Host ""
Write-Host "Installing ZURIA regression hooks into $hooksDir ..." -ForegroundColor Cyan

# ── pre-commit: project-wide guard ────────────────────────────────────────────
$preCommit = @'
#!/usr/bin/env bash
# ZURIA pre-commit: project-wide regression guard
set -e
cd "$(git rev-parse --show-toplevel)"

echo ""
echo "+----------------------------------------------------------+"
echo "|  ZURIA Project Guard -- pre-commit check                |"
echo "|  Checks: TypeScript · ESLint · all 17 test suites       |"
echo "+----------------------------------------------------------+"

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
'@

$preCommitPath = Join-Path $hooksDir "pre-commit"
# Write WITHOUT BOM — PowerShell 5.1 Out-File adds BOM which breaks bash.
[System.IO.File]::WriteAllText($preCommitPath, $preCommit, [System.Text.UTF8Encoding]::new($false))

# ── pre-push ──────────────────────────────────────────────────────────────────
$prePush = @'
#!/usr/bin/env bash
# ZURIA pre-push: full behavioral regression suite
set -e
cd "$(git rev-parse --show-toplevel)"

echo ""
echo "+---------------------------------------------------------------+"
echo "|  ZURIA Full Regression Suite -- pre-push check (1000+ cases) |"
echo "+---------------------------------------------------------------+"

if [ "${SKIP_REGRESSION:-0}" = "1" ]; then
  echo "WARNING: SKIP_REGRESSION=1 -- suite bypassed."
  exit 0
fi

npx jest 16-behavioral-regression --no-coverage 2>&1
STATUS=$?

if [ $STATUS -ne 0 ]; then
  echo ""
  echo "FAILED: Behavioral regression -- push blocked."
  echo "Fix the failing tests before pushing."
  echo ""
  exit 1
fi

echo "PASSED: All behavioral tests. Pushing ..."
echo ""
'@

$prePushPath = Join-Path $hooksDir "pre-push"
[System.IO.File]::WriteAllText($prePushPath, $prePush, [System.Text.UTF8Encoding]::new($false))

Write-Host ""
Write-Host "Hooks installed:" -ForegroundColor Green
Write-Host "  pre-commit  -> project-wide guard (TS + ESLint + all 17 suites vs baseline)"
Write-Host "  pre-push    -> full behavioral suite (1000+ cases)"
Write-Host ""
Write-Host "NOTE: Git hooks are bash scripts. They run via Git Bash on Windows."
Write-Host "      Make sure Git Bash is on your PATH."
Write-Host ""
Write-Host "To bypass in an emergency: set SKIP_REGRESSION=1 before committing."
Write-Host ""
