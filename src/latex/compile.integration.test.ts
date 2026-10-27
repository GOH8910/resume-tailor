import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildTex } from "./build";
import { compileTex, latexEnv } from "./compile";
import { exampleDocument } from "./fixture";
import { loadTemplate } from "./template";

function hasLatexmk(): boolean {
  try {
    execFileSync(process.env.LATEXMK_PATH ?? "latexmk", ["--version"], { env: latexEnv(), stdio: "ignore" });
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

  it("kills latexmk and pdflatex when the compile times out", async () => {
    const loop = "\\documentclass{article}\\begin{document}\\def\\x{\\x}\\x\\end{document}";
    const result = await compileTex(loop, { timeoutMs: 3000 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/timed out/);
    await new Promise((r) => setTimeout(r, 300));
    let orphans = "";
    try {
      orphans = execFileSync("pgrep", ["-f", "pdflatex.*resume.tex"], { encoding: "utf8" });
    } catch {
      // pgrep exits 1 when nothing matches, which is what we want.
    }
    expect(orphans.trim()).toBe("");
  }, 30_000);

  it("refuses shell escape from the document", async () => {
    const evil = "\\documentclass{article}\\begin{document}x\\immediate\\write18{kpsewhich --version}\\end{document}";
    const result = await compileTex(evil);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.log).toMatch(/runsystem\(kpsewhich --version\)\.\.\.disabled/);
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

describe("compileTex with a stand-in latexmk that leaves no log", () => {
  it("falls back to the captured output", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "fake-latexmk-"));
    try {
      const script = path.join(dir, "latexmk");
      await writeFile(script, "#!/bin/sh\necho 'fake latexmk output' >&2\nexit 1\n", { mode: 0o755 });
      const result = await compileTex("x", { latexmkPath: script });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.log).toContain("fake latexmk output");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
