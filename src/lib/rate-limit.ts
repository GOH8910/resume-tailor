export type RateLimiterOptions = {
  /** The burst size: how many requests a fresh key may make at once. */
  capacity: number;
  refillPerSecond: number;
  /** Forget a key idle this long (default 1 h), but never before its bucket would have refilled anyway. */
  idleMs?: number;
};

export type TakeResult = { ok: true } | { ok: false; retryAfterSeconds: number };

export type RateLimiter = {
  take(key: string, now?: number): TakeResult;
  /** How many keys are tracked (for tests). */
  size(): number;
  /** Forgets every key (for tests). */
  clear(): void;
};

type Bucket = { tokens: number; updatedAt: number };

const HOUR_MS = 60 * 60 * 1000;
const SWEEP_EVERY_MS = 60_000;
// Refill sums fractions of a token, so a bucket that should hold exactly one may hold 0.9999999.
const EPSILON = 1e-9;

/**
 * Token buckets per key, in memory: per process and reset by a restart, which is fine on one machine.
 * A refused request spends nothing, so retrying early does not push the wait further out.
 */
export function createRateLimiter({ capacity, refillPerSecond, idleMs = HOUR_MS }: RateLimiterOptions): RateLimiter {
  if (!(capacity >= 1) || !(refillPerSecond > 0)) throw new Error("A rate limiter needs capacity >= 1 and a positive refill rate");
  // Dropping a key resets it to a full bucket, which is only harmless once it would be full anyway.
  const forgetAfterMs = Math.max(idleMs, (capacity / refillPerSecond) * 1000);
  const buckets = new Map<string, Bucket>();
  let lastSweep = Number.NEGATIVE_INFINITY;

  function sweep(now: number): void {
    if (now - lastSweep < SWEEP_EVERY_MS) return;
    lastSweep = now;
    for (const [key, bucket] of buckets) {
      if (now - bucket.updatedAt > forgetAfterMs) buckets.delete(key);
    }
  }

  return {
    take(key, now = Date.now()) {
      sweep(now);
      const bucket = buckets.get(key);
      const elapsedSeconds = bucket ? Math.max(0, now - bucket.updatedAt) / 1000 : 0;
      const tokens = bucket ? Math.min(capacity, bucket.tokens + elapsedSeconds * refillPerSecond) : capacity;
      if (tokens >= 1 - EPSILON) {
        buckets.set(key, { tokens: Math.max(0, tokens - 1), updatedAt: now });
        return { ok: true };
      }
      buckets.set(key, { tokens, updatedAt: now });
      // Rounded to whole milliseconds first, so float noise cannot add a second.
      const waitMs = Math.round(((1 - tokens) / refillPerSecond) * 1000);
      return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)) };
    },
    size: () => buckets.size,
    clear: () => buckets.clear(),
  };
}
