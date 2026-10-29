import { describe, expect, it } from "vitest";
import { safeNextPath } from "./next-path";

describe("safeNextPath", () => {
  it.each(["/", "/bank", "/tailor/abc?x=1", "/bank?q=a%2Fb", "/tailor#notes"])("keeps the same-site path %s", (next) => {
    expect(safeNextPath(next)).toBe(next);
  });

  it.each([
    undefined,
    "",
    "bank",
    "https://evil.example",
    "http://localhost:3000/bank",
    "javascript:alert(1)",
    "//evil.example",
    "/\\evil.example",
    "/bank\\x",
    "/\tevil.example",
    "/bank\n",
    "/bank\u007f",
    "/%2F%2Fevil.example",
    "/%2fevil.example",
    "/%5Cevil.example",
    ["/bank", "/tailor"],
  ])("falls back to the dashboard for %j", (next) => {
    expect(safeNextPath(next)).toBe("/dashboard");
  });
});
