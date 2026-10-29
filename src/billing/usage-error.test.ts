import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { attachUsage, usageFromError } from "./usage-error";
import type { ModelUsage } from "./usage-types";

const USED: ModelUsage = { model: "claude-haiku-5-5", inputTokens: 10_000, outputTokens: 2_500 };

describe("attachUsage and usageFromError", () => {
  it("tags an error with the usage without changing what the client sees", () => {
    const original = new AppError("Application already exists", 409, { id: "a1" });
    const tagged = attachUsage(original, USED);
    expect(tagged).toBe(original);
    expect(tagged).toMatchObject({ message: "Application already exists", status: 409, details: { id: "a1" } });
    expect(usageFromError(tagged)).toEqual(USED);
    expect(JSON.stringify(tagged)).not.toContain("inputTokens");
  });

  it("wraps a thrown non-error so it can carry the usage", () => {
    const tagged = attachUsage("boom", USED);
    expect(tagged).toBeInstanceOf(Error);
    expect(tagged.message).toBe("boom");
    expect(usageFromError(tagged)).toEqual(USED);
  });

  it("finds no usage on an untagged error or a malformed one", () => {
    expect(usageFromError(new Error("x"))).toBeUndefined();
    expect(usageFromError(undefined)).toBeUndefined();
    expect(usageFromError("x")).toBeUndefined();
    expect(usageFromError(Object.assign(new Error("x"), { usage: { model: "m" } }))).toBeUndefined();
  });
});
