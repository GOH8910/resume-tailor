import { describe, expect, it } from "vitest";
import { createRateLimiter } from "./rate-limit";

const T0 = 1_700_000_000_000;
const seconds = (n: number) => T0 + n * 1000;

describe("createRateLimiter", () => {
  it("allows a burst up to the capacity, then refuses", () => {
    const limiter = createRateLimiter({ capacity: 3, refillPerSecond: 0.1 });
    expect(limiter.take("u1", T0)).toEqual({ ok: true });
    expect(limiter.take("u1", T0)).toEqual({ ok: true });
    expect(limiter.take("u1", T0)).toEqual({ ok: true });
    expect(limiter.take("u1", T0).ok).toBe(false);
  });

  it("refills at the given rate, up to the capacity and no further", () => {
    const limiter = createRateLimiter({ capacity: 2, refillPerSecond: 0.1 });
    limiter.take("u1", T0);
    limiter.take("u1", T0);
    expect(limiter.take("u1", seconds(9)).ok).toBe(false);
    expect(limiter.take("u1", seconds(10)).ok).toBe(true);
    // A long idle spell refills to the capacity only.
    expect(limiter.take("u1", seconds(1000)).ok).toBe(true);
    expect(limiter.take("u1", seconds(1000)).ok).toBe(true);
    expect(limiter.take("u1", seconds(1000)).ok).toBe(false);
  });

  it("says how many whole seconds until the next token", () => {
    const limiter = createRateLimiter({ capacity: 2, refillPerSecond: 0.1 });
    limiter.take("u1", T0);
    limiter.take("u1", T0);
    expect(limiter.take("u1", T0)).toEqual({ ok: false, retryAfterSeconds: 10 });
    expect(limiter.take("u1", seconds(4))).toEqual({ ok: false, retryAfterSeconds: 6 });
    expect(limiter.take("u1", seconds(9.5))).toEqual({ ok: false, retryAfterSeconds: 1 });
  });

  it("does not spend a token on a refused request", () => {
    const limiter = createRateLimiter({ capacity: 1, refillPerSecond: 0.1 });
    limiter.take("u1", T0);
    for (let s = 1; s < 10; s++) expect(limiter.take("u1", seconds(s)).ok).toBe(false);
    expect(limiter.take("u1", seconds(10)).ok).toBe(true);
  });

  it("keeps a separate bucket per key", () => {
    const limiter = createRateLimiter({ capacity: 1, refillPerSecond: 0.1 });
    expect(limiter.take("u1", T0).ok).toBe(true);
    expect(limiter.take("u1", T0).ok).toBe(false);
    expect(limiter.take("u2", T0).ok).toBe(true);
  });

  it("forgets keys idle for longer than idleMs, on a later call", () => {
    const limiter = createRateLimiter({ capacity: 1, refillPerSecond: 1, idleMs: 60_000 });
    limiter.take("idle", T0);
    limiter.take("busy", seconds(50));
    expect(limiter.size()).toBe(2);
    limiter.take("busy", seconds(121));
    expect(limiter.size()).toBe(1);
  });

  it("never forgets a key before its bucket would be full again", () => {
    // 10 tokens at one per 10 minutes take 100 minutes to refill, longer than the 1 minute idleMs.
    const limiter = createRateLimiter({ capacity: 10, refillPerSecond: 1 / 600, idleMs: 60_000 });
    for (let i = 0; i < 10; i++) limiter.take("u1", T0);
    limiter.take("other", seconds(30 * 60));
    expect(limiter.size()).toBe(2);
    expect(limiter.take("u1", seconds(30 * 60))).toEqual({ ok: true });
    expect(limiter.take("u1", seconds(30 * 60)).ok).toBe(true);
    expect(limiter.take("u1", seconds(30 * 60)).ok).toBe(true);
    expect(limiter.take("u1", seconds(30 * 60)).ok).toBe(false);
  });

  it("clear() forgets every key", () => {
    const limiter = createRateLimiter({ capacity: 1, refillPerSecond: 0.1 });
    limiter.take("u1", T0);
    limiter.clear();
    expect(limiter.size()).toBe(0);
    expect(limiter.take("u1", T0).ok).toBe(true);
  });

  it("rejects settings that would never refill", () => {
    expect(() => createRateLimiter({ capacity: 0, refillPerSecond: 1 })).toThrow();
    expect(() => createRateLimiter({ capacity: 1, refillPerSecond: 0 })).toThrow();
  });
});
