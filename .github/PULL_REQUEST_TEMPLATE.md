## What this PR does

<!-- One paragraph. What changed and why. -->

## How to test

<!-- Step-by-step instructions a reviewer can follow to verify the change works. -->

---

## Production Checklist

> Every box must be checked before this PR can merge.
> See [PRODUCTION_CHECKLIST.md](../PRODUCTION_CHECKLIST.md) for full details on each gate.

- [ ] **1. Tested** — Tests written and passing (`npm run project:guard` green)
- [ ] **2. Committed** — Clean git tree, no debug code, no `.env` secrets staged
- [ ] **3. Logged** — `createLogger()` used in all new `lib/` and `app/api/` code; no `console.log`
- [ ] **4. Observable** — No silent `catch {}` blocks; errors are logged or reach Sentry
- [ ] **5. Retry-safe** — Firestore writes are idempotent; deterministic doc IDs used where possible
- [ ] **6. Mobile-friendly** — Tested at 360px; tap targets ≥ 44px; no horizontal scroll
- [ ] **7. Low-data optimized** — No unjustified bundle growth; Firestore queries use `.select()`
- [ ] **8. Offline-safe** — UI degrades gracefully offline; mutations go through offline queue
- [ ] **9. TypeScript clean** — `npm run typecheck` exits 0; no new `any` without justification
- [ ] **10. Production build verified** — `npm run checklist:build` passes clean

---

## Automated results

<!-- Paste the output of `npm run checklist` here if running it locally, or link to CI run. -->

```
npm run checklist output:
(paste here)
```
