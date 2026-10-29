import { describe, expect, it } from "vitest";
import { nextUtcDay, startOfUtcDay } from "./day";

describe("UTC days", () => {
  it("starts a day at midnight UTC, whatever the time of day", () => {
    expect(startOfUtcDay(new Date("2026-10-29T23:59:59.999Z")).toISOString()).toBe("2026-10-29T00:00:00.000Z");
    expect(startOfUtcDay(new Date("2026-10-29T00:00:00.000Z")).toISOString()).toBe("2026-10-29T00:00:00.000Z");
  });

  it("ends a day at the next midnight UTC, across month and year ends", () => {
    expect(nextUtcDay(new Date("2026-10-29T12:00:00Z")).toISOString()).toBe("2026-10-30T00:00:00.000Z");
    expect(nextUtcDay(new Date("2026-10-31T23:00:00Z")).toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(nextUtcDay(new Date("2026-12-31T00:00:00Z")).toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});
