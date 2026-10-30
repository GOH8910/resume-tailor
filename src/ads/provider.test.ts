import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adClientConfig } from "./client-config";
import { createTestAdTimer, testAdSeconds } from "./provider";

describe("testAdSeconds", () => {
  it("plays a second past the minimum watch time, and never under two seconds", () => {
    expect(testAdSeconds(7)).toBe(8);
    expect(testAdSeconds(1)).toBe(2);
    expect(testAdSeconds(0)).toBe(2);
    expect(testAdSeconds(0.5)).toBe(2);
  });
});

describe("createTestAdTimer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("finishes once, only after the whole ad has played", () => {
    const onDone = vi.fn();
    createTestAdTimer(1, onDone);
    vi.advanceTimersByTime(1900);
    expect(onDone).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(onDone).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5000);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("reports progress rising to 1", () => {
    const fractions: number[] = [];
    createTestAdTimer(3, () => {}, (fraction) => fractions.push(fraction));
    vi.advanceTimersByTime(4000);
    expect(fractions[0]).toBeCloseTo(0.025);
    expect(fractions.at(-1)).toBe(1);
    expect(fractions).toEqual([...fractions].sort((a, b) => a - b));
  });

  it("measures elapsed time, so a throttled timer still ends on schedule", () => {
    const onDone = vi.fn();
    createTestAdTimer(1, onDone);
    // A background tab may run the interval late: the clock jumps without the ticks in between.
    vi.setSystemTime(Date.now() + 2000);
    vi.advanceTimersToNextTimer();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("does not finish once stopped", () => {
    const onDone = vi.fn();
    const stop = createTestAdTimer(1, onDone);
    vi.advanceTimersByTime(1000);
    stop();
    vi.advanceTimersByTime(5000);
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe("adClientConfig", () => {
  const base = { AD_UNIT_PATH: "/123/rewarded", AD_SSV_ENABLED: false, AD_MIN_WATCH_SECONDS: 7 };

  it("passes the provider, SSV flag and minimum watch time", () => {
    expect(adClientConfig({ ...base, adProvider: "test", AD_SSV_ENABLED: true })).toEqual({
      provider: "test",
      ssv: true,
      minWatchSeconds: 7,
    });
  });

  it("names the ad unit only for Google", () => {
    expect(adClientConfig({ ...base, adProvider: "google" }).adUnitPath).toBe("/123/rewarded");
    expect(adClientConfig({ ...base, adProvider: "none" })).not.toHaveProperty("adUnitPath");
    expect(adClientConfig({ ...base, adProvider: "google", AD_UNIT_PATH: undefined })).not.toHaveProperty("adUnitPath");
  });
});
