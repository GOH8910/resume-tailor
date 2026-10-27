import { describe, expect, it } from "vitest";
import { countPdfPages } from "./page-count";

describe("countPdfPages", () => {
  it("counts /Type /Page objects but not the /Pages tree", () => {
    const pdf = Buffer.from("%PDF-1.5\n1 0 obj << /Type /Pages >>\n2 0 obj << /Type /Page >>\n3 0 obj <</Type/Page>>\n");
    expect(countPdfPages(pdf)).toBe(2);
  });
  it("returns 0 when nothing matches", () => {
    expect(countPdfPages(Buffer.from("%PDF-1.5\n"))).toBe(0);
  });
});
