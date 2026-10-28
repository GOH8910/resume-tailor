import { describe, expect, it } from "vitest";
import { DEFAULT_LAYOUT, LayoutSchema, layoutPreamble, resolveLayout, sameLayout } from "./layout";

const custom = { fontSize: 11, margins: { top: 0.5, bottom: 0.5, left: 0.6, right: 0.6 } };

describe("resolveLayout", () => {
  it("prefers the resume, then the bank default, then the built-in default", () => {
    expect(resolveLayout(custom, DEFAULT_LAYOUT)).toBe(custom);
    expect(resolveLayout(undefined, custom)).toBe(custom);
    expect(resolveLayout(undefined, undefined)).toBe(DEFAULT_LAYOUT);
  });
});

describe("sameLayout", () => {
  it("compares by value and treats undefined as distinct from a layout", () => {
    expect(sameLayout(custom, { ...custom, margins: { ...custom.margins } })).toBe(true);
    expect(sameLayout(custom, { ...custom, fontSize: null })).toBe(false);
    expect(sameLayout(custom, undefined)).toBe(false);
    expect(sameLayout(undefined, undefined)).toBe(true);
  });
});

describe("layoutPreamble", () => {
  it("writes margins with two decimals and the font size in tenths of a point", () => {
    expect(layoutPreamble(custom)).toBe(
      "\\def\\resumeFontTenths{110}\\def\\resumeMarginTop{0.50in}\\def\\resumeMarginBottom{0.50in}\\def\\resumeMarginLeft{0.60in}\\def\\resumeMarginRight{0.60in}",
    );
  });
  it("uses zero for the automatic font size and rounds half points", () => {
    expect(layoutPreamble(DEFAULT_LAYOUT)).toContain("\\def\\resumeFontTenths{0}");
    expect(layoutPreamble({ ...custom, fontSize: 10.5 })).toContain("\\def\\resumeFontTenths{105}");
  });
});

describe("LayoutSchema", () => {
  it("rejects margins and sizes outside the supported range", () => {
    expect(LayoutSchema.safeParse({ fontSize: 20, margins: custom.margins }).success).toBe(false);
    expect(LayoutSchema.safeParse({ fontSize: null, margins: { ...custom.margins, top: 0 } }).success).toBe(false);
    expect(LayoutSchema.safeParse(custom).success).toBe(true);
  });
});
