import { describe, expect, it } from "vitest";
import { newId } from "./ids";

describe("newId", () => {
  it("prefixes and uses 8 hex chars", () => {
    expect(newId("b")).toMatch(/^b_[0-9a-f]{8}$/);
  });
  it("is different each call", () => {
    expect(newId("e")).not.toBe(newId("e"));
  });
});
