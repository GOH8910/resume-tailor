import { execFileSync } from "node:child_process";
import { access, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildTex } from "./build";
import { compileRoot, compileTex, latexEnv } from "./compile";
import { writeFakeSudo } from "./fake-sudo";
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
  // compileTex works in a fresh subfolder of compileRoot(), so "../<name>" from there names this same file.
  const name = `resume-written-${process.pid}-${Date.now()}.txt`;
  const target = path.join(compileRoot(), name);
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
    expect(result.log).toContain("I can't write on file");
    await expect(access(target)).rejects.toThrow();
  }, 90_000);

  it("refuses to write a file into a parent directory", async () => {
    const result = await compileTex(write(`../${name}`));
    expect(result.ok).toBe(false);
    expect(result.log).toContain("I can't write on file");
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

describe("compileTex under COMPILE_ROOT (stand-in latexmk)", () => {
  it("compiles in a fresh folder under COMPILE_ROOT and removes it afterwards", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "compile-root-"));
    const bin = await mkdtemp(path.join(os.tmpdir(), "pwd-latexmk-"));
    vi.stubEnv("COMPILE_ROOT", root);
    try {
      const script = path.join(bin, "latexmk");
      await writeFile(script, "#!/bin/sh\npwd >&2\nexit 1\n", { mode: 0o755 });
      const result = await compileTex("x", { latexmkPath: script });
      expect(result.log).toContain(path.join(await realpath(root), "resume-tailor-"));
      expect(await readdir(root)).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
      await rm(root, { recursive: true, force: true });
      await rm(bin, { recursive: true, force: true });
    }
  });
});

describe("compileTex as another user (stand-in sudo)", () => {
  let bin: string;
  let root: string;

  async function fakeLatexmk(name: string, body: string): Promise<string> {
    const script = path.join(bin, name);
    await writeFile(script, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    return script;
  }

  beforeAll(async () => {
    bin = await mkdtemp(path.join(os.tmpdir(), "sudo-latexmk-"));
    root = await mkdtemp(path.join(os.tmpdir(), "sudo-root-"));
    await writeFakeSudo(bin);
  });
  afterAll(async () => {
    await rm(bin, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  });
  beforeEach(() => {
    vi.stubEnv("PATH", `${bin}:${process.env.PATH}`);
    vi.stubEnv("COMPILE_ROOT", root);
    vi.stubEnv("LATEX_RUN_AS", undefined);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("runs latexmk through sudo and GNU timeout as that user", async () => {
    const latexmk = await fakeLatexmk("args", 'echo "latexmk as $FAKE_SUDO_RUN_AS: $*" >&2\nexit 1');
    const result = await compileTex("x", { latexmkPath: latexmk, runAs: "tex", timeoutMs: 60_000 });
    expect(result.log).toContain(`sudo -n -u tex -- /usr/bin/timeout -k 3 55s ${latexmk} -norc -no-shell-escape -pdf`);
    expect(result.log).toContain("latexmk as tex: -norc -no-shell-escape -pdf -interaction=nonstopmode");
  });

  it("takes the user from LATEX_RUN_AS", async () => {
    vi.stubEnv("LATEX_RUN_AS", "texuser");
    const latexmk = await fakeLatexmk("env-user", 'echo "latexmk as $FAKE_SUDO_RUN_AS" >&2\nexit 1');
    const result = await compileTex("x", { latexmkPath: latexmk });
    expect(result.log).toContain("latexmk as texuser");
  });

  it("keeps the compile folder in the shared group so TeX's files stay readable to the server", async () => {
    const latexmk = await fakeLatexmk("mode", "ls -ld . >&2\nexit 1");
    const result = await compileTex("x", { latexmkPath: latexmk, runAs: "tex" });
    expect(result.log).toMatch(/^drwxrws---/m);
  });

  it("returns the PDF that TeX wrote", async () => {
    const latexmk = await fakeLatexmk("writes-pdf", "printf '%%PDF-1.4 stand-in' > resume.pdf");
    const result = await compileTex("x", { latexmkPath: latexmk, runAs: "tex" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pdf.toString()).toBe("%PDF-1.4 stand-in");
  });

  it("explains that sudo is missing", async () => {
    vi.stubEnv("PATH", await mkdtemp(path.join(os.tmpdir(), "no-sudo-")));
    const latexmk = await fakeLatexmk("unused", "exit 0");
    const result = await compileTex("x", { latexmkPath: latexmk, runAs: "tex" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/sudo not found/);
    expect(result.message).toMatch(/LATEX_RUN_AS/);
  });

  it("explains that latexmk is missing for that user", async () => {
    const result = await compileTex("x", { latexmkPath: "/definitely/not/latexmk", runAs: "tex" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/latexmk not found/);
    expect(result.message).toMatch(/"tex"/);
  });

  it("reports a timeout when GNU timeout stopped latexmk", async () => {
    const latexmk = await fakeLatexmk("inner-timeout", "exit 124");
    const result = await compileTex("x", { latexmkPath: latexmk, runAs: "tex" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/timed out/);
  });

  it("treats exit 124 as an ordinary failure when latexmk runs directly", async () => {
    const latexmk = await fakeLatexmk("plain-124", "exit 124");
    const result = await compileTex("x", { latexmkPath: latexmk });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/compilation failed/);
  });
});

describe("compileTex timeout handling (stand-in latexmk)", () => {
  let bin: string;

  async function fakeLatexmk(name: string, body: string): Promise<string> {
    const script = path.join(bin, name);
    await writeFile(script, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    return script;
  }

  function running(pattern: string): string {
    try {
      return execFileSync("pgrep", ["-f", pattern], { encoding: "utf8" }).trim();
    } catch {
      // pgrep exits 1 when nothing matches.
      return "";
    }
  }

  beforeAll(async () => {
    bin = await mkdtemp(path.join(os.tmpdir(), "timeout-latexmk-"));
  });
  afterAll(() => rm(bin, { recursive: true, force: true }));

  it("asks latexmk to stop with SIGTERM first, which sudo can relay to TeX", async () => {
    const latexmk = await fakeLatexmk("term", "trap 'echo got SIGTERM >&2; exit 143' TERM\nsleep 30 &\nwait");
    const started = Date.now();
    const result = await compileTex("x", { latexmkPath: latexmk, timeoutMs: 300 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/timed out/);
    expect(result.log).toContain("got SIGTERM");
    expect(Date.now() - started).toBeLessThan(2_000);
  }, 10_000);

  it("kills the process group with SIGKILL when SIGTERM is ignored", async () => {
    const latexmk = await fakeLatexmk("ignores-term", "trap '' TERM\nsleep 37.25");
    const started = Date.now();
    const result = await compileTex("x", { latexmkPath: latexmk, timeoutMs: 300 });
    const elapsed = Date.now() - started;
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/timed out/);
    expect(elapsed).toBeGreaterThanOrEqual(3_000);
    expect(elapsed).toBeLessThan(5_000);
    expect(running("sleep 37.25")).toBe("");
  }, 15_000);

  it("stops waiting when a process it cannot signal keeps the output open", async () => {
    // The holder leaves the process group, like a TeX process owned by another user that the server cannot kill.
    const pidFile = path.join(bin, "holder.pid");
    const latexmk = await fakeLatexmk(
      "holder",
      `perl -MPOSIX -e 'POSIX::setsid(); open(my $f, ">", $ARGV[0]) or die; print $f $$; close $f; sleep 41' "${pidFile}" &\nsleep 30`,
    );
    const started = Date.now();
    try {
      const result = await compileTex("x", { latexmkPath: latexmk, timeoutMs: 300 });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.message).toMatch(/timed out/);
      expect(Date.now() - started).toBeLessThan(8_000);
    } finally {
      const pid = Number(await readFile(pidFile, "utf8").catch(() => ""));
      if (pid > 0) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // Already gone.
        }
      }
    }
  }, 20_000);
});
