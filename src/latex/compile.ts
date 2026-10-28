import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isEnoent } from "@/lib/fs";
import { countPdfPages } from "./page-count";

/**
 * `pages` is 0 when the page objects could not be counted, so callers must treat 0 as unknown rather than as an empty PDF.
 * `pdf` is `Buffer<ArrayBuffer>` so it is accepted as a `Response` body.
 */
export type CompileResult =
  | { ok: true; pdf: Buffer<ArrayBuffer>; pages: number; log: string }
  | { ok: false; message: string; log: string };

export type CompileOptions = { latexmkPath?: string; timeoutMs?: number };

type RunResult = { code: number | null; timedOut: boolean; output: string; error?: NodeJS.ErrnoException };

const MAX_OUTPUT_CHARS = 1024 * 1024;

// Kept on the same line as the document so LaTeX log line numbers match the generated source. It works before
// \documentclass, so it also protects a user-supplied template: page objects stay uncompressed for page counting,
// and unknown Unicode renders as "?" instead of failing.
const PREAMBLE_PREFIX =
  "\\pdfobjcompresslevel=0\\makeatletter\\def\\UTFviii@undefined@err#1{?}\\makeatother";

// Appended to PATH for servers launched from an IDE, which often miss them.
const TEX_BIN_DIRS = ["/Library/TeX/texbin", "/usr/local/bin", "/opt/homebrew/bin"];
const PASSED_THROUGH = new Set(["HOME", "TMPDIR", "LANG", "LC_ALL"]);
// kpathsea search settings, so a custom TeX setup keeps working.
const TEX_SETTING = /^(TEXMF[A-Z0-9_]*|TEXINPUTS)$/;
// kpathsea allows absolute writes under TEXMFOUTPUT even with openout_any=p.
const BLOCKED = new Set(["TEXMFOUTPUT"]);

/**
 * The whole environment TeX runs with, built from an allowlist rather than copied from process.env so that
 * secrets (database URL, auth secret, API keys) stay out of TeX's own environment.
 * openout_any=p (kpathsea reads it from the environment, ahead of texmf.cnf) stops a document writing to
 * dotfiles, absolute paths or parent directories, so it can only write inside its temp folder.
 * Reads are not confined by TeX (TeX Live 2026 made openin_any a no-op): they rely on escapeLatex and, in the
 * container, on running TeX as a separate unprivileged user.
 */
export function latexEnv(): NodeJS.ProcessEnv {
  const kept = Object.entries(process.env).filter(
    ([key, value]) =>
      value !== undefined && !BLOCKED.has(key) && (PASSED_THROUGH.has(key) || TEX_SETTING.test(key)),
  );
  const env: NodeJS.Dict<string> = {
    ...Object.fromEntries(kept),
    PATH: [process.env.PATH, ...TEX_BIN_DIRS].filter(Boolean).join(":"),
    openout_any: "p",
  };
  // Next's global types make NODE_ENV a required key of ProcessEnv (their own TODO says it should be optional).
  return env as NodeJS.ProcessEnv;
}

/** Runs latexmk in its own process group so a timeout can kill latexmk AND its pdflatex child. */
function runLatexmk(latexmk: string, args: string[], dir: string, timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    let output = "";
    const child = spawn(latexmk, args, { cwd: dir, env: latexEnv(), detached: true, stdio: ["ignore", "pipe", "pipe"] });
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
    const finish = (result: Omit<RunResult, "output" | "timedOut">) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ...result, timedOut, output });
    };
    const collect = (chunk: string) => {
      if (output.length < MAX_OUTPUT_CHARS) output = (output + chunk).slice(0, MAX_OUTPUT_CHARS);
    };
    for (const stream of [child.stdout, child.stderr]) {
      stream?.setEncoding("utf8");
      stream?.on("data", collect);
    }
    child.once("error", (err) => finish({ code: null, error: err as NodeJS.ErrnoException }));
    // "close" rather than "exit" so the captured output is complete when it fires.
    child.once("close", (code) => finish({ code }));
  });
}

/** The folder each compile gets its own fresh subfolder in. */
export function compileRoot(): string {
  return os.tmpdir();
}

export async function compileTex(tex: string, options: CompileOptions = {}): Promise<CompileResult> {
  const latexmk = options.latexmkPath ?? process.env.LATEXMK_PATH ?? "latexmk";
  const timeout = options.timeoutMs ?? 60_000;
  const dir = await mkdtemp(path.join(compileRoot(), "resume-tailor-"));
  try {
    await writeFile(path.join(dir, "resume.tex"), PREAMBLE_PREFIX + tex, "utf8");
    // -norc ignores any ~/.latexmkrc (it could move the aux dir or enable shell escape); -no-shell-escape blocks \write18.
    const args = ["-norc", "-no-shell-escape", "-pdf", "-interaction=nonstopmode", "-halt-on-error", "-file-line-error", "resume.tex"];
    const run = await runLatexmk(latexmk, args, dir, timeout);
    // The captured output covers a timeout or an early latexmk failure, where no log file exists.
    const log = (await readLog(dir)) || run.output;
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
    let pdf: Buffer<ArrayBuffer>;
    try {
      pdf = await readFile(path.join(dir, "resume.pdf"));
    } catch (err) {
      if (isEnoent(err)) return { ok: false, message: "latexmk reported success but produced no PDF.", log };
      throw err;
    }
    return { ok: true, pdf, pages: countPdfPages(pdf), log };
  } finally {
    // Cleanup must never mask the compile result.
    try {
      await rm(dir, { recursive: true, force: true });
    } catch (err) {
      console.error(`Could not remove temp dir ${dir}:`, err);
    }
  }
}

async function readLog(dir: string): Promise<string> {
  try {
    return await readFile(path.join(dir, "resume.log"), "utf8");
  } catch (err) {
    if (isEnoent(err)) return "";
    throw err;
  }
}
