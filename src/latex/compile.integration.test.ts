import { execFileSync } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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

  it("fills one page from a nearly empty document", async () => {
    const doc = { ...exampleDocument, summary: "", education: [], experience: [], projects: [], skills: [] };
    const result = await compileTex(buildTex(doc, await loadTemplate()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pages).toBe(1);
  }, 90_000);

  it("runs onto more pages when the body does not fit at the smallest font size", async () => {
    const long = "Built and deployed a multi-agent incident-triage service on Kubernetes, cutting mean time to resolution by 40%.";
    const bullets = Array.from({ length: 70 }, (_, i) => `${i + 1}. ${long}`);
    const doc = { ...exampleDocument, projects: [{ title: "Huge", start: "", end: "", bullets }] };
    const result = await compileTex(buildTex(doc, await loadTemplate()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pages).toBeGreaterThan(1);
  }, 90_000);

  it("honours a fixed font size and custom margins", async () => {
    const layout = { fontSize: 9, margins: { top: 0.4, bottom: 0.4, left: 0.5, right: 0.5 } };
    const result = await compileTex(buildTex({ ...exampleDocument, layout }, await loadTemplate()));
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

describe.skipIf(!hasLatexmk())("compileTex file writes (integration, needs latexmk)", () => {
  // compileTex works in a fresh folder under the temp dir, so "../<name>" from there lands in the temp dir too.
  const name = `resume-written-${process.pid}-${Date.now()}.txt`;
  const target = path.join(os.tmpdir(), name);
  const write = (file: string) =>
    `\\documentclass{article}\\begin{document}x\\newwrite\\out\\immediate\\openout\\out=${file} \\immediate\\write\\out{x}\\immediate\\closeout\\out\\end{document}`;
  const previous = process.env.openout_any;

  // A permissive parent environment proves that compileTex's own setting is what blocks the write.
  beforeAll(() => {
    process.env.openout_any = "a";
  });
  afterAll(async () => {
    if (previous === undefined) delete process.env.openout_any;
    else process.env.openout_any = previous;
    await rm(target, { force: true });
  });

  it("refuses to write a file by absolute path", async () => {
    const result = await compileTex(write(target));
    expect(result.ok).toBe(false);
    await expect(access(target)).rejects.toThrow();
  }, 90_000);

  it("refuses to write a file into a parent directory", async () => {
    const result = await compileTex(write(`../${name}`));
    expect(result.ok).toBe(false);
    await expect(access(target)).rejects.toThrow();
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

describe("compileTex with a stand-in latexmk that prints its environment", () => {
  it("runs latexmk without the server's secrets", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://app:hunter2@db.internal/resume");
    const dir = await mkdtemp(path.join(os.tmpdir(), "env-latexmk-"));
    try {
      const script = path.join(dir, "latexmk");
      await writeFile(script, "#!/bin/sh\nenv >&2\nexit 1\n", { mode: 0o755 });
      const result = await compileTex("x", { latexmkPath: script });
      expect(result.log).toMatch(/^openout_any=p$/m);
      expect(result.log).not.toContain("hunter2");
    } finally {
      vi.unstubAllEnvs();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
