// Simple in-memory rate limiter — works per process instance.
// For multi-instance deployments, replace with Redis-backed solution.
//
// SECURITY WARNING: In serverless / multi-instance deployments (e.g. Vercel,
// Cloud Run), each instance maintains its own independent store. A single
// attacker can exhaust the per-instance limit on one instance and retry on
// another, effectively multiplying the allowed attempts by the number of
// running instances. For production use with security-critical limits
// (e.g. forgot-pin, login), replace this with a shared Redis store such as
// @upstash/ratelimit + Upstash Redis.
if (process.env.NODE_ENV === "production") {
  console.warn(
    "[rate-limit] WARNING: Using in-memory rate limiter in production. " +
    "Limits are per-instance and will not be enforced across multiple serverless instances. " +
    "Replace with a Redis-backed solution for reliable rate limiting."
  );
}

interface Bucket {
  count: number;
  resetAt: number;
}

const store = new Map<string, Bucket>();

// Clean up expired buckets every 5 minutes to prevent memory leaks
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of store) {
      if (bucket.resetAt < now) store.delete(key);
    }
  }, 5 * 60 * 1000);
}

/**
 * Check whether `key` is within its rate limit.
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
  const now = Date.now();
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
