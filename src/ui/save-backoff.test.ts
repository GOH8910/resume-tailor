import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import { nextSaveDelay, saveRateLimitWait } from "./save-backoff";

describe("saveRateLimitWait", () => {
  it("is the wait a 429 asks for", () => {
    expect(saveRateLimitWait(new ApiError("Too many bank save requests, try again in 5 s", 429, { retryAfter: 5 }))).toBe(5);
  });

  it("is null for any other failure", () => {
    expect(saveRateLimitWait(new ApiError("Server busy", 503, { retryAfter: 10 }))).toBeNull();
    expect(saveRateLimitWait(new ApiError("summary: too long", 400, []))).toBeNull();
    expect(saveRateLimitWait(new Error("network"))).toBeNull();
  });
});

describe("nextSaveDelay", () => {
  it("is the debounce when no rate limit is pending", () => {
    expect(nextSaveDelay(1_000, null, 800)).toBe(800);
  });

  it("waits out a pending rate limit", () => {
    expect(nextSaveDelay(1_000, 6_000, 800)).toBe(5_000);
  });

  it("is the debounce once the wait is over", () => {
    expect(nextSaveDelay(7_000, 6_000, 800)).toBe(800);
  });
});
