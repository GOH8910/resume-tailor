import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { buildTex } from "./build";
import { compileTex, latexEnv } from "./compile";
import { exampleDocument } from "./fixture";
import { loadTemplate } from "./template";

function hasLatexmk(): boolean {
  try {
    execFileSync("latexmk", ["--version"], { env: latexEnv(), stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!hasLatexmk())("compileTex (integration, needs latexmk)", () => {
  it("compiles the example document to a one-page PDF", async () => {
    const tex = buildTex(exampleDocument, await loadTemplate());
    const result = await compileTex(tex);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(result.pages).toBe(1);
  }, 90_000);

  it("compiles bullets full of special and unicode characters", async () => {
    const nasty = [
      "Specials: & % $ # _ { } ~ ^ \\ < > and [brackets] first",
      "Unicode: ≥99.9% uptime, ≈2× faster, 5−3, μs, naïve – café’s “quote”, ✓ done, 日本語, 🚀",
      "Spaces:\u200Bzero\u2009thin\u202Fnarrow and cafe\u0301",
    ];
    const doc = { ...exampleDocument, projects: [{ title: "Edge cases", start: "", end: "", bullets: nasty }] };
    const result = await compileTex(buildTex(doc, await loadTemplate()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pages).toBe(1);
  }, 90_000);

  it("counts pages even when the template does not disable object streams", async () => {
    const template = (await loadTemplate()).replace("\\pdfobjcompresslevel=0", "");
    const result = await compileTex(buildTex(exampleDocument, template));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pages).toBe(1);
  }, 90_000);

  it("returns the log when LaTeX fails", async () => {
    const result = await compileTex("\\documentclass{article}\\begin{document}\\undefinedmacro\\end{document}");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.log).toContain("Undefined control sequence");
  }, 90_000);
});

describe("compileTex with a missing binary", () => {
  it("reports that latexmk is missing", async () => {
    const result = await compileTex("\\documentclass{article}\\begin{document}x\\end{document}", {
      latexmkPath: "/definitely/not/latexmk",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/latexmk/i);
  });
});
