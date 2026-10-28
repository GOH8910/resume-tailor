import { describe, expect, it } from "vitest";
import { safeNextPath } from "./next-path";

describe("safeNextPath", () => {
  it.each(["/", "/bank", "/tailor/abc?x=1"])("keeps the same-site path %s", (next) => {
    expect(safeNextPath(next)).toBe(next);
  });

  it.each([undefined, "", "bank", "https://evil.example", "//evil.example", "/\\evil.example", ["/bank", "/tailor"]])(
    "falls back to / for %j",
    (next) => {
      expect(safeNextPath(next)).toBe("/");
    },
  );
});
