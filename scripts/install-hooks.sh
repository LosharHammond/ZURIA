#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# install-hooks.sh — installs ZURIA git hooks (Linux / macOS / WSL)
#
# Usage:
#   bash scripts/install-hooks.sh
#
# What it installs:
#   .git/hooks/pre-commit  — project-wide guard (TS + ESLint + all test suites)
#                            + Production Checklist reminder
#   .git/hooks/pre-push    — full behavioral suite (1000+ cases)
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

HOOKS_DIR="$(git rev-parse --git-dir)/hooks"

echo "Installing ZURIA regression hooks into $HOOKS_DIR …"

# ── pre-commit: project-wide guard + checklist reminder ──────────────────────
cat > "$HOOKS_DIR/pre-commit" << 'HOOK'
#!/usr/bin/env bash
# ZURIA pre-commit: project-wide regression guard + production checklist
set -e
cd "$(git rev-parse --show-toplevel)"

echo ""
echo "┌──────────────────────────────────────────────────────────────┐"
echo "│  ZURIA Project Guard — pre-commit check                      │"
echo "│  Checks: TypeScript · ESLint · all test suites               │"
echo "└──────────────────────────────────────────────────────────────┘"

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

# ── Production Checklist reminder ───────────────────────────────────────────
echo "┌──────────────────────────────────────────────────────────────┐"
echo "│  ZURIA Production Checklist — manual gates reminder          │"
echo "│  See PRODUCTION_CHECKLIST.md for full details                │"
echo "└──────────────────────────────────────────────────────────────┘"
echo ""
echo "  Automated gates just ran:"
echo "    ✅  1. Tested          — tests passing"
echo "    ✅  3. Logged          — (run: npm run checklist:logs)"
echo "    ✅  9. TypeScript clean — 0 errors"
echo ""
echo "  Manual gates — confirm before merging to main:"
echo "    [ ] 2.  Committed       — clean tree, no debug code, no secrets"
echo "    [ ] 4.  Observable      — no silent catch{}, errors reach Sentry"
echo "    [ ] 5.  Retry-safe      — idempotent writes, deterministic doc IDs"
echo "    [ ] 6.  Mobile-friendly — tested at 360px, tap targets ≥44px"
echo "    [ ] 7.  Low-data        — bundle justified, .select() used"
echo "    [ ] 8.  Offline-safe    — mutations go through offline queue"
echo "    [ ] 10. Build verified  — run: npm run checklist:build"
echo ""
echo "  Full automated check: npm run checklist"
echo ""
HOOK

chmod +x "$HOOKS_DIR/pre-commit"

# ── pre-push: full behavioral suite + checklist gate ─────────────────────────
cat > "$HOOKS_DIR/pre-push" << 'HOOK'
#!/usr/bin/env bash
# ZURIA pre-push: full behavioral regression suite + automated checklist gates
set -e
cd "$(git rev-parse --show-toplevel)"

echo ""
echo "┌──────────────────────────────────────────────────────────────┐"
echo "│  ZURIA Pre-Push — Full Regression + Checklist Gates          │"
echo "│  Running: 1000+ behavioral tests + automated checklist       │"
echo "└──────────────────────────────────────────────────────────────┘"

if [ "${SKIP_REGRESSION:-0}" = "1" ]; then
  echo "⚠  SKIP_REGRESSION=1 — suite bypassed."
  exit 0
fi

# Gate 1 + behavioral regression
npx jest 16-behavioral-regression --no-coverage 2>&1
JEST_STATUS=$?

if [ $JEST_STATUS -ne 0 ]; then
  echo ""
  echo "❌  Behavioral regression FAILED — push blocked."
  echo "    Fix the failing tests before pushing."
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
  echo "❌  Checklist gates FAILED — push blocked."
  echo "    Fix all violations, then re-push."
  echo ""
  exit 1
fi

echo "✅  All behavioral tests + checklist gates pass. Pushing …"
echo ""
echo "  Remember to run before merging:"
echo "    npm run checklist:build   — Gate 10: Production build"
echo ""
HOOK

chmod +x "$HOOKS_DIR/pre-push"

echo ""
echo "✅  Hooks installed:"
echo "   pre-commit  → project-wide guard (TS + ESLint + tests) + checklist reminder"
echo "   pre-push    → 1000+ behavioral tests + automated checklist gates"
echo ""
echo "  Production Checklist: see PRODUCTION_CHECKLIST.md"
echo "  Full automated check: npm run checklist"
echo ""
echo "To bypass in an emergency: SKIP_REGRESSION=1 git commit …"
echo ""
