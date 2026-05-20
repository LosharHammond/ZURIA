# ZURIA Production Checklist

> **This is law.**
> Every feature — no matter how small — must clear every gate before it
> is considered done. No exceptions. No "I'll fix it later."
> "Later" does not exist in production.

---

## The 10 Gates

A feature is **not complete** until all 10 gates are green.

---

### 1. Tested

Every new code path has a test. Not a placeholder. A real test that
would catch a regression.

**Automated check:** `npm run project:guard` (runs on every commit via pre-commit hook)

**Manual checks:**
- [ ] Happy path tested
- [ ] Error / edge case tested
- [ ] If it touches Firestore: idempotency tested
- [ ] If it touches auth: unauthorized access tested
- [ ] `npm test` passes locally with 0 failures

**Why:** Code without tests is a liability. ZURIA handles real business money.
A silent regression in the debt or payment flow can destroy someone's livelihood.

---

### 2. Committed

No work exists only in your head or in an uncommitted working tree.

**Automated check:** `git status` must show a clean tree before deploy.

**Manual checks:**
- [ ] All changes are staged and committed
- [ ] Commit message is descriptive (`feat:`, `fix:`, `chore:`, etc.)
- [ ] No debug code, commented-out blocks, or TODO left in
- [ ] No `.env` or secrets accidentally staged

**Why:** Uncommitted work is invisible. It can't be reviewed, rolled back,
or debugged. If it isn't committed, it doesn't exist.

---

### 3. Logged

Every server-side function uses `createLogger()`. No raw `console.log`.

**Automated check:** `npm run checklist:logs` scans for console usage in production code.

**Manual checks:**
- [ ] All new `lib/`, `app/api/` code uses `createLogger(module-name)`
- [ ] Errors are logged with context: `logger.error("msg", { err, userId, businessId })`
- [ ] No `console.log`, `console.warn`, `console.error` in `lib/` or `app/api/`
- [ ] Client components may use `console.error` only for unrecoverable UI errors

**Reference implementation:**
```typescript
import { createLogger } from "@/lib/observability/logger";
const logger = createLogger("my-module");
logger.info("action taken", { userId, businessId, amount });
logger.warn("degraded path", { reason, fallback });
logger.error("operation failed", { err: String(err), context });
```

**Why:** `console.log` on Vercel is invisible after the fact. Structured logs
are queryable. When a business owner reports a problem, you need to find it.

---

### 4. Observable

Errors are captured. Silent `catch {}` blocks are forbidden in production code.

**Automated check:** `npm run checklist:silent-catch` scans for empty catch blocks.

**Manual checks:**
- [ ] All `catch` blocks either re-throw, log, or call `captureZuriaError()`
- [ ] New API routes have error boundaries that return structured JSON errors
- [ ] Critical paths (payments, auth, data writes) have Sentry instrumentation
- [ ] No `catch {}` or `catch (e) { /* ignore */ }` in `lib/` or `app/api/`

**Reference implementation:**
```typescript
// Good — observable failure
} catch (err) {
  logger.error("payment failed", { err: String(err), userId });
  captureZuriaError(err, { extra: { userId } });
  return NextResponse.json({ error: "Payment failed" }, { status: 500 });
}

// BAD — silent death
} catch {}
```

**Why:** You cannot fix what you cannot see. A silent error in a payment
route means money is lost and you don't know why.

---

### 5. Retry-Safe

Every write operation is idempotent. Running it twice produces the same result as running it once.

**Automated check:** None (architectural, must be manual)

**Manual checks:**
- [ ] Firestore writes use deterministic doc IDs where possible (not `doc().id`)
- [ ] Webhook handlers check for existing records before processing
- [ ] Payment operations use idempotency keys (`idempotency_keys` collection)
- [ ] No double-charge risk: verify before charging, not after
- [ ] Cron jobs are safe to re-run (they skip already-processed records)
- [ ] API routes that create data are protected from concurrent duplicate calls

**Reference pattern:**
```typescript
// Deterministic doc ID — safe to replay
const docId = `${userId}_${eventType}_${reference}`;
await db.doc(`collection/${docId}`).create(data); // throws if exists = dedup
```

**Why:** Vercel serverless functions can be called twice for the same request.
Webhooks are retried. Networks are unreliable. Non-idempotent code charges
customers twice. This has happened to real businesses.

---

### 6. Mobile-Friendly

ZURIA's users are on low-end Android phones. Every UI works on a 360px screen.

**Automated check:** None (visual, must be manual or Playwright)

**Manual checks:**
- [ ] Tested at 360×640 viewport (Chrome DevTools → Moto G4)
- [ ] No horizontal scroll on any screen width ≥ 360px
- [ ] All tap targets are ≥ 44×44px (buttons, links, icon buttons)
- [ ] Text is readable without zooming (≥ 14px body, ≥ 12px labels)
- [ ] Forms are usable with a mobile keyboard (inputs don't get hidden)
- [ ] No hover-only interactions (hover doesn't exist on touch screens)
- [ ] Bottom navigation is not obscured by content
- [ ] Modals/sheets scroll correctly on mobile

**Why:** Our target user is a market trader in Accra with a GH₵300 phone.
If it doesn't work on a 360px screen, it doesn't work.

---

### 7. Low-Data Optimized

Ghana's data costs are real. Every byte costs money.

**Automated check:** `npm run checklist:bundle` reports bundle size changes.

**Manual checks:**
- [ ] New images are WebP/SVG, ≤ 50KB, with `loading="lazy"` where appropriate
- [ ] New npm packages are justified (check with `npm run checklist:bundle`)
- [ ] API responses only return fields the client needs (no over-fetching)
- [ ] Firestore queries use `.select()` to limit returned fields where possible
- [ ] No polling loops — use Firestore listeners or on-demand fetch
- [ ] Dashboard data is cached (60s stale window — see `use-business-data.ts`)
- [ ] New fonts/icons use existing Lucide + system fonts (no new font loads)

**Reference:**
```typescript
// Good — fetch only what you need
.select("businessId", "userId", "type", "amount", "createdAt")

// BAD — fetches entire document (may be 2KB per doc × 500 docs = 1MB)
.get()  // without .select()
```

**Why:** A user on MTN Ghana pays per MB. A dashboard that pulls 2MB of data
on every page load is a product killer.

---

### 8. Offline-Safe

ZURIA must degrade gracefully with no internet. Core flows never hard-crash offline.

**Automated check:** None (manual or Playwright with network throttling)

**Manual checks:**
- [ ] New transaction writes go through the offline queue (`lib/offline/queue.ts`)
- [ ] UI shows meaningful state when offline (no blank screens, no infinite spinners)
- [ ] Read-only views show cached data when offline (stale is better than empty)
- [ ] No `fetch()` calls in UI code that aren't wrapped in try/catch with offline fallback
- [ ] Firestore reads use the correct persistence mode (already configured globally)
- [ ] New background jobs (crons, workers) handle `ECONNRESET` / timeout gracefully

**Reference:**
```typescript
// Good — offline-aware fetch
try {
  const data = await fetch("/api/data");
  setData(await data.json());
} catch {
  // Show cached data, don't crash
  setOffline(true);
}
```

**Why:** Network coverage in Ghana is inconsistent. A trader mid-transaction
losing internet must not lose their data.

---

### 9. TypeScript Clean

Zero TypeScript errors. `any` is a red flag. `@ts-ignore` requires a comment.

**Automated check:** `npm run typecheck` (runs on every commit via pre-commit hook)

**Manual checks:**
- [ ] `npx tsc --noEmit` exits with code 0
- [ ] No new `any` types without explicit justification in a comment
- [ ] No `@ts-ignore` without a comment explaining why
- [ ] No `as unknown as X` escape hatches without justification
- [ ] New Firestore document shapes are typed (not `Record<string, any>`)
- [ ] API route request/response bodies are typed and validated (use `zod`)

**Reference:**
```typescript
// BAD
const data = doc.data() as any;

// Good
const data = doc.data() as UserDocument;

// Better
import { UserSchema } from "@/types/domain";
const data = UserSchema.parse(doc.data());
```

**Why:** TypeScript is your first line of defence. Every `any` is a hole in the net.
ZURIA processes financial data — a type error is a potential data corruption.

---

### 10. Production Build Verified

The app must build clean. Warnings are yellow flags. Errors are blockers.

**Automated check:** `npm run checklist:build` (wraps `next build`)

**Manual checks:**
- [ ] `next build` exits with code 0 locally
- [ ] No new build warnings (treat warnings as errors)
- [ ] Bundle size has not grown by more than 10% for any route without justification
- [ ] New environment variables are added to `.env.example`
- [ ] New API routes have the correct `export const dynamic` setting
- [ ] No `<Image>` components missing `alt`, `width`, or `height`
- [ ] No `useEffect` with missing dependencies (ESLint exhaustive-deps)

**Why:** A broken build means a broken deploy. Vercel can't fix what it can't build.
Discovering a build error after merging to main means a broken production site.

---

## Quick Reference Card

Copy this into your PR description or checklist before every merge:

```
## Production Checklist

- [ ] 1. Tested — tests written and passing (npm run project:guard)
- [ ] 2. Committed — clean git tree, no debug code, no secrets
- [ ] 3. Logged — createLogger() used, no console.log in lib/api (npm run checklist:logs)
- [ ] 4. Observable — no silent catch{}, errors reach Sentry
- [ ] 5. Retry-safe — idempotent writes, deterministic doc IDs
- [ ] 6. Mobile-friendly — works at 360px, touch targets ≥44px
- [ ] 7. Low-data optimized — bundle size justified, queries use .select()
- [ ] 8. Offline-safe — degraded gracefully, mutations go through offline queue
- [ ] 9. TypeScript clean — 0 errors, no unjustified any/ts-ignore (npm run typecheck)
- [ ] 10. Production build verified — next build clean (npm run checklist:build)
```

---

## Automated Gates Summary

| Gate | Command | Runs On |
|------|---------|---------|
| Tests | `npm run project:guard` | Every commit (pre-commit hook) |
| TypeScript | `npm run typecheck` | Every commit + CI |
| ESLint | `npm run lint` | Every commit + CI |
| Console usage | `npm run checklist:logs` | Manual / CI |
| Silent catches | `npm run checklist:silent-catch` | Manual / CI |
| Bundle size | `npm run checklist:bundle` | Manual |
| Build | `npm run checklist:build` | Manual / CI |
| Full suite | `npm run checklist` | Manual / pre-push |

---

## Why This Exists

ZURIA is not a side project anymore. Real business owners — market traders,
salon owners, pharmacists in Ghana — are trusting it with their livelihood data.

A bug in the payment flow costs them real money.
A crash in the offline queue loses real transactions.
A broken build takes down their only financial record-keeping tool.

**Operational discipline now. Technical debt never.**

> "The time to make a house is when you're building it, not after it's built."
> — Ghanaian proverb
