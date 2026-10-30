import { describe, expect, it } from "vitest";
import { secondsUntil } from "./countdown";

describe("secondsUntil", () => {
  it("rounds the time left up to whole seconds", () => {
    expect(secondsUntil(10_000, 0)).toBe(10);
    expect(secondsUntil(10_000, 100)).toBe(10);
    expect(secondsUntil(10_000, 9_001)).toBe(1);
  });

  it("is 0 at and after the deadline", () => {
    expect(secondsUntil(10_000, 10_000)).toBe(0);
    expect(secondsUntil(10_000, 12_000)).toBe(0);
  });
});
