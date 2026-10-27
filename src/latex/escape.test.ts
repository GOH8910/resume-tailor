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

  it("maps common unicode math and typography to LaTeX commands", () => {
    expect(escapeLatex("≥99.9% uptime, ≈2× faster, 5−3, μs")).toBe(
      "\\ensuremath{\\geq}99.9\\% uptime, \\ensuremath{\\approx}2× faster, 5\\textminus{}3, \\textmu{}s",
    );
  });

  it("escapes angle brackets so T1 ligatures cannot turn << into guillemets", () => {
    expect(escapeLatex("std::cout << x")).toBe("std::cout \\textless{}\\textless{} x");
  });

  it("strips control and zero-width characters and normalises odd spaces", () => {
    // U+200B zero-width space, U+0007 bell, U+2009 thin space, U+202F narrow no-break space
    expect(escapeLatex("a​b\u0007c d e")).toBe("abc d e");
  });

  it("normalises decomposed accents to composed form", () => {
    expect(escapeLatex("café")).toBe("café");
  });

  it("handles consecutive specials and replacement-pattern lookalikes", () => {
    expect(escapeLatex("\\\\")).toBe("\\textbackslash{}\\textbackslash{}");
    expect(escapeLatex("%%")).toBe("\\%\\%");
    expect(escapeLatex("$&")).toBe("\\$\\&");
  });

  it("turns line-break characters into spaces instead of joining words", () => {
    expect(escapeLatex("first line\u000Bsecond line third")).toBe("first line second line third");
  });

  it("strips bidi marks and variation selectors", () => {
    // U+202A LRE, U+200E LRM, U+FE0F variation selector-16, U+2069 PDI
    expect(escapeLatex("‪a‎b️c⁩")).toBe("abc");
  });
});
