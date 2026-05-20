/**
 * In-memory rate limiter — works per-process instance.
 *
 * UPGRADE PATH: For distributed rate limiting across Vercel serverless instances,
 * install @upstash/ratelimit + @upstash/redis and set:
 *   UPSTASH_REDIS_REST_URL
 *   UPSTASH_REDIS_REST_TOKEN
 * in Vercel → Project Settings → Environment Variables, then replace this
 * module with the Upstash implementation.
 */

import { createLogger } from "@/lib/observability/logger";
const logger = createLogger("rate-limit");

interface Bucket {
  count: number;
  resetAt: number;
}

const store = new Map<string, Bucket>();
let _warnedAboutInMemory = false;
let lastSweep = 0;

function sweepExpired(now: number) {
  if (now - lastSweep < 5 * 60 * 1000) return;
  lastSweep = now;
  for (const [key, bucket] of store) {
    if (bucket.resetAt < now) store.delete(key);
  }
}

/**
 * Check whether `key` is within its rate limit.
 *
 * @param key      Identifier to rate-limit (e.g. phone number, IP)
 * @param max      Maximum allowed requests in the window
 * @param windowMs Time window in milliseconds
 * @returns `{ allowed: true }` or `{ allowed: false, retryAfterMs: number }`
 */
export function rateLimit(
  key: string,
  max: number,
  windowMs: number
): { allowed: boolean; retryAfterMs?: number } {
  // Warn once per cold-start in production
  if (process.env.NODE_ENV === "production" && !_warnedAboutInMemory) {
    _warnedAboutInMemory = true;
    logger.warn("Using in-memory rate limiter. Install @upstash/ratelimit + UPSTASH_REDIS env vars for distributed limiting.");
  }

  const now    = Date.now();
  sweepExpired(now);
  const bucket = store.get(key);

  if (!bucket || bucket.resetAt < now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true };
  }

  if (bucket.count >= max) {
    return { allowed: false, retryAfterMs: bucket.resetAt - now };
  }

  bucket.count += 1;
  return { allowed: true };
}
