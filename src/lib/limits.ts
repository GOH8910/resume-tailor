import type { Plan } from "@/billing/plan";
import { currentPolicy } from "@/billing/policy";
import { AppError } from "./errors";
import { createRateLimiter, type RateLimiter } from "./rate-limit";

type Limit = { limiter: RateLimiter; label: string };

const HOUR_S = 60 * 60;
const TEN_MINUTES_S = 10 * 60;

/** `count` requests per `windowSeconds`, as a burst of `count` that refills evenly across the window. */
function perWindow(count: number, windowSeconds: number, label: string): Limit {
  return { limiter: createRateLimiter({ capacity: count, refillPerSecond: count / windowSeconds }), label };
}

/** Burst limits per account, in memory on the one machine (fly.toml runs one). */
export const limits = {
  tailor: perWindow(10, HOUR_S, "tailor"),
  chat: perWindow(30, TEN_MINUTES_S, "chat"),
  compile: perWindow(30, TEN_MINUTES_S, "compile"),
  bankWrite: perWindow(60, TEN_MINUTES_S, "bank save"),
  adStart: perWindow(20, HOUR_S, "ad"),
  applicationCreate: perWindow(30, TEN_MINUTES_S, "new resume"),
} satisfies Record<string, Limit>;

export type LimitName = keyof typeof limits;

/** Takes a token for `key`, or throws a 429 whose `details.retryAfter` is the wait in seconds. */
export function requireWithinLimit(limiter: RateLimiter, key: string, label: string, now?: number): void {
  const result = limiter.take(key, now);
  if (result.ok) return;
  const wait = result.retryAfterSeconds;
  throw new AppError(`Too many ${label} requests, try again in ${wait} s`, 429, { retryAfter: wait });
}

/** Applies a limit to the account in hosted mode; a self-hosted server has one trusted operator and no limits. */
export function limitUser(name: LimitName, user: { id: string; plan: Plan }): void {
  if (!currentPolicy(user.plan).limited) return;
  const { limiter, label } = limits[name];
  requireWithinLimit(limiter, user.id, label);
}

/** Forgets every account's usage (for tests: the limits outlive a single test). */
export function clearLimits(): void {
  for (const { limiter } of Object.values(limits)) limiter.clear();
}
