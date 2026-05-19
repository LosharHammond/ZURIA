#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# install-hooks.sh — installs ZURIA git hooks (Linux / macOS / WSL)
#
# Usage:
#   bash scripts/install-hooks.sh
#
# What it installs:
#   .git/hooks/pre-commit  — project-wide guard (TS + ESLint + all test suites)
#   .git/hooks/pre-push    — full behavioral suite (1000+ cases)
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

HOOKS_DIR="$(git rev-parse --git-dir)/hooks"

echo "Installing ZURIA regression hooks into $HOOKS_DIR …"

# ── pre-commit: project-wide guard ───────────────────────────────────────────
cat > "$HOOKS_DIR/pre-commit" << 'HOOK'
#!/usr/bin/env bash
# ZURIA pre-commit: project-wide regression guard
set -e
cd "$(git rev-parse --show-toplevel)"

echo ""
echo "┌──────────────────────────────────────────────────────────┐"
echo "│  ZURIA Project Guard — pre-commit check                  │"
echo "│  Checks: TypeScript · ESLint · all 17 test suites        │"
echo "└──────────────────────────────────────────────────────────┘"

if [ "${SKIP_REGRESSION:-0}" = "1" ]; then
  echo "⚠  SKIP_REGRESSION=1 — guard bypassed."
  exit 0
fi

node scripts/project-guard.mjs
STATUS=$?

if [ $STATUS -ne 0 ]; then
  echo ""
  echo "❌  Project guard FAILED — commit blocked."
  echo ""
  echo "    If the change is intentional (e.g. you fixed a failing test):"
  echo "      npm run project:update-baseline"
  echo "      git add __tests__/project-health-baseline.json"
  echo ""
  echo "    Emergency bypass: SKIP_REGRESSION=1 git commit …"
  echo ""
  exit 1
fi

echo "✅  Project guard passed."
echo ""
HOOK

chmod +x "$HOOKS_DIR/pre-commit"

# ── pre-push: full behavioral suite ──────────────────────────────────────────
cat > "$HOOKS_DIR/pre-push" << 'HOOK'
#!/usr/bin/env bash
# ZURIA pre-push: full behavioral regression suite
set -e
cd "$(git rev-parse --show-toplevel)"

echo ""
echo "┌─────────────────────────────────────────────────────────────┐"
echo "│  ZURIA Full Regression Suite — pre-push check (1000+ cases) │"
echo "└─────────────────────────────────────────────────────────────┘"

if [ "${SKIP_REGRESSION:-0}" = "1" ]; then
  echo "⚠  SKIP_REGRESSION=1 — suite bypassed."
  exit 0
fi

npx jest 16-behavioral-regression --no-coverage 2>&1
STATUS=$?

if [ $STATUS -ne 0 ]; then
  echo ""
  echo "❌  Behavioral regression FAILED — push blocked."
  echo "    Fix the failing tests before pushing."
  echo ""
  exit 1
fi

echo "✅  All behavioral tests pass. Pushing …"
echo ""
HOOK

chmod +x "$HOOKS_DIR/pre-push"

echo ""
echo "✅  Hooks installed:"
echo "   pre-commit  → project-wide guard (TS + ESLint + all 17 suites vs baseline)"
echo "   pre-push    → full behavioral suite (1000+ cases)"
echo ""
echo "To bypass in an emergency: SKIP_REGRESSION=1 git commit …"
echo ""
