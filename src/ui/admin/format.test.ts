import { describe, expect, it } from "vitest";
import { formatGbp } from "./format";

describe("formatGbp", () => {
  it("shows pounds and pence", () => {
    expect(formatGbp(0)).toBe("£0.00");
    expect(formatGbp(2)).toBe("£2.00");
    expect(formatGbp(1.234)).toBe("£1.23");
  });

  it("keeps fractions of a penny visible, since a single Haiku call costs less", () => {
    expect(formatGbp(0.004213)).toBe("£0.0042");
    expect(formatGbp(0.0000004)).toBe("£0.0000");
  });
});
