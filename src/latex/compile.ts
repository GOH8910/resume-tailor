import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isEnoent } from "@/lib/fs";
import { countPdfPages } from "./page-count";

export type CompileResult =
  | { ok: true; pdf: Buffer; pages: number; log: string }
  | { ok: false; message: string; log: string };

export type CompileOptions = { latexmkPath?: string; timeoutMs?: number };

type RunResult = { code: number | null; timedOut: boolean; error?: NodeJS.ErrnoException };

/** PATH with the usual MacTeX and Homebrew locations appended, for servers launched from an IDE. */
export function latexEnv(): NodeJS.ProcessEnv {
  const extra = ["/Library/TeX/texbin", "/usr/local/bin", "/opt/homebrew/bin"];
  return { ...process.env, PATH: [process.env.PATH, ...extra].filter(Boolean).join(":") };
}

/** Runs latexmk in its own process group so a timeout can kill latexmk AND its pdflatex child. */
function runLatexmk(latexmk: string, args: string[], dir: string, timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    const child = spawn(latexmk, args, { cwd: dir, env: latexEnv(), detached: true, stdio: "ignore" });
    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          // The group is already gone.
        }
      }
    }, timeoutMs);
    const finish = (result: RunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    child.once("error", (err) => finish({ code: null, timedOut, error: err as NodeJS.ErrnoException }));
    child.once("exit", (code) => finish({ code, timedOut }));
  });
}

export async function compileTex(tex: string, options: CompileOptions = {}): Promise<CompileResult> {
  const latexmk = options.latexmkPath ?? process.env.LATEXMK_PATH ?? "latexmk";
  const timeout = options.timeoutMs ?? 60_000;
  const dir = await mkdtemp(path.join(os.tmpdir(), "resume-tailor-"));
  try {
    // Prepended lines work before \documentclass, so they also protect a user-supplied template:
    // keep page objects uncompressed for page counting, and render unknown Unicode as "?" instead of failing.
    const source = [
      "\\pdfobjcompresslevel=0",
      "\\makeatletter\\def\\UTFviii@undefined@err#1{?}\\makeatother",
      tex,
    ].join("\n");
    await writeFile(path.join(dir, "resume.tex"), source, "utf8");
    // -norc ignores any ~/.latexmkrc (it could move the aux dir or enable shell escape); -no-shell-escape blocks \write18.
    const args = ["-norc", "-no-shell-escape", "-pdf", "-interaction=nonstopmode", "-halt-on-error", `-output-directory=${dir}`, "resume.tex"];
    const run = await runLatexmk(latexmk, args, dir, timeout);
    const log = await readLog(dir);
    if (run.error) {
      if (run.error.code === "ENOENT") {
        return { ok: false, message: `latexmk not found at "${latexmk}". Install MacTeX or set LATEXMK_PATH.`, log };
      }
      return { ok: false, message: `Could not run latexmk: ${run.error.message}`, log };
    }
    if (run.timedOut) {
      return { ok: false, message: `LaTeX compilation timed out after ${Math.round(timeout / 1000)}s and was stopped.`, log };
    }
    if (run.code !== 0) {
      return { ok: false, message: "LaTeX compilation failed. See the log for details.", log };
    }
    let pdf: Buffer;
    try {
      pdf = await readFile(path.join(dir, "resume.pdf"));
    } catch (err) {
      if (isEnoent(err)) return { ok: false, message: "latexmk reported success but produced no PDF.", log };
      throw err;
    }
    return { ok: true, pdf, pages: countPdfPages(pdf), log };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function readLog(dir: string): Promise<string> {
  try {
    return await readFile(path.join(dir, "resume.log"), "utf8");
  } catch {
    return "";
  }
}
