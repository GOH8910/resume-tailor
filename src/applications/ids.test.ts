import { describe, expect, it } from "vitest";
import { assertApplicationId, newApplicationId, slugify } from "./ids";

describe("slugify", () => {
  it("lowercases, dashes and trims", () => {
    expect(slugify("  Tencent  Games / EU! ")).toBe("tencent-games-eu");
  });
  it("caps length without trailing dash", () => {
    expect(slugify("a".repeat(29) + "-b")).toBe("a".repeat(29));
  });
  it("falls back when nothing is left", () => {
    expect(slugify("!!!")).toBe("application");
  });
});

describe("newApplicationId", () => {
  it("is date-company-random", () => {
    const id = newApplicationId("Acme Corp", new Date("2026-10-27T10:00:00Z"));
    expect(id).toMatch(/^2026-10-27-acme-corp-[0-9a-f]{8}$/);
    expect(assertApplicationId(id)).toBe(id);
  });
});

describe("assertApplicationId", () => {
  it("rejects path-like ids", () => {
    expect(() => assertApplicationId("../x")).toThrow();
    expect(() => assertApplicationId("A B")).toThrow();
  });
});
