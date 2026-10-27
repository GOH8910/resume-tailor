import { describe, expect, it } from "vitest";
import { escapeLatex } from "./escape";

describe("escapeLatex", () => {
  it.each([
    ["&", "\\&"],
    ["%", "\\%"],
    ["$", "\\$"],
    ["#", "\\#"],
    ["_", "\\_"],
    ["{", "\\{"],
    ["}", "\\}"],
    ["~", "\\textasciitilde{}"],
    ["^", "\\textasciicircum{}"],
    ["\\", "\\textbackslash{}"],
  ])("escapes %s", (input, expected) => {
    expect(escapeLatex(input)).toBe(expected);
  });

  it("escapes a realistic bullet in one pass", () => {
    expect(escapeLatex("Cut costs by ~90% using C# & {Go}")).toBe(
      "Cut costs by \\textasciitilde{}90\\% using C\\# \\& \\{Go\\}",
    );
  });

  it("does not double-escape the braces it inserts", () => {
    expect(escapeLatex("a\\b")).toBe("a\\textbackslash{}b");
  });

  it("passes unicode and punctuation through", () => {
    expect(escapeLatex("naïve – café’s “quote”")).toBe("naïve – café’s “quote”");
  });

  it("handles empty strings", () => {
    expect(escapeLatex("")).toBe("");
  });
});
