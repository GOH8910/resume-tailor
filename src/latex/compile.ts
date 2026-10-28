import { spawn } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

/** `runAs` (default: LATEX_RUN_AS) runs TeX as that user through sudo; see latexCommand. */
export type CompileOptions = { latexmkPath?: string; timeoutMs?: number; runAs?: string };

export type LatexCommand = { file: string; args: string[] };

type RunResult = { code: number | null; timedOut: boolean; output: string; error?: NodeJS.ErrnoException };

const MAX_OUTPUT_CHARS = 1024 * 1024;

// -norc ignores any ~/.latexmkrc (it could move the aux dir or enable shell escape); -no-shell-escape blocks \write18.
const LATEXMK_ARGS = ["-norc", "-no-shell-escape", "-pdf", "-interaction=nonstopmode", "-halt-on-error", "-file-line-error", "resume.tex"];

// The path the sudoers rule allows.
const GNU_TIMEOUT = "/usr/bin/timeout";
const INNER_TIMEOUT_MARGIN_MS = 5_000;
const INNER_KILL_AFTER_S = 3;
// GNU timeout exits 124 when it stopped the command, and 127 (like a shell) when the command was not found.
const TIMEOUT_EXIT_CODE = 124;
const NOT_FOUND_EXIT_CODE = 127;

// After the server's own timeout: SIGTERM first, because sudo relays SIGTERM to TeX but dies on SIGKILL without
// relaying it; SIGKILL if the group is still there KILL_AFTER_MS later; and stop waiting GIVE_UP_AFTER_MS after that.
const KILL_AFTER_MS = 3_000;
const GIVE_UP_AFTER_MS = 2_000;

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

/**
 * How latexmk is run. With `runAs`, it runs as that user through sudo, so TeX cannot read the server's files or
 * its environment under /proc. The server cannot signal that user's processes, so GNU timeout runs inside sudo
 * and stops TeX (its whole process group) a little before the server's own timeout fires.
 */
export function latexCommand(latexmk: string, args: string[], runAs: string | undefined, timeoutMs: number): LatexCommand {
  if (!runAs) return { file: latexmk, args };
  // Short limits (the health probe's) would leave no time at all after a fixed margin.
  const innerMs = Math.max(timeoutMs - INNER_TIMEOUT_MARGIN_MS, timeoutMs / 2);
  const seconds = Math.max(1, Math.ceil(innerMs / 1000));
  return {
    file: "sudo",
    args: ["-n", "-u", runAs, "--", GNU_TIMEOUT, "-k", String(INNER_KILL_AFTER_S), `${seconds}s`, latexmk, ...args],
  };
}

/** The user TeX runs as: the option, else LATEX_RUN_AS, else the server's own user. */
export function latexRunAs(runAs?: string): string | undefined {
  return runAs ?? (process.env.LATEX_RUN_AS || undefined);
}

/** Runs latexmk in its own process group so a timeout can stop latexmk AND its pdflatex child. */
function runLatexmk(command: LatexCommand, dir: string, timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    let output = "";
    const timers: NodeJS.Timeout[] = [];
    const child = spawn(command.file, command.args, { cwd: dir, env: latexEnv(), detached: true, stdio: ["ignore", "pipe", "pipe"] });
    const signalGroup = (signal: NodeJS.Signals) => {
      if (!child.pid) return;
      try {
        process.kill(-child.pid, signal);
      } catch {
        // The group is already gone.
      }
    };
    const finish = (result: Omit<RunResult, "output" | "timedOut">) => {
      if (settled) return;
      settled = true;
      timers.forEach(clearTimeout);
      // latexmk may have exited on SIGTERM while something else in its group ignored it.
      if (timedOut) signalGroup("SIGKILL");
      resolve({ ...result, timedOut, output });
    };
    timers.push(
      setTimeout(() => {
        timedOut = true;
        signalGroup("SIGTERM");
        timers.push(setTimeout(() => signalGroup("SIGKILL"), KILL_AFTER_MS));
        // A process the server cannot signal (TeX under sudo) may keep the output open; it must not hold a queue slot.
        timers.push(
          setTimeout(() => {
            child.stdout?.destroy();
            child.stderr?.destroy();
            finish({ code: child.exitCode });
          }, KILL_AFTER_MS + GIVE_UP_AFTER_MS),
        );
      }, timeoutMs),
    );
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

/** The folder each compile gets its own fresh subfolder in: COMPILE_ROOT, else the system temp folder. */
export function compileRoot(): string {
  return process.env.COMPILE_ROOT || os.tmpdir();
}

export async function compileTex(tex: string, options: CompileOptions = {}): Promise<CompileResult> {
  const latexmk = options.latexmkPath ?? process.env.LATEXMK_PATH ?? "latexmk";
  const runAs = latexRunAs(options.runAs);
  const timeout = options.timeoutMs ?? 60_000;
  const dir = await mkdtemp(path.join(compileRoot(), "resume-tailor-"));
  try {
    // TeX's user shares a group with the server. The setgid bit (a plain 0o770 would clear it) puts TeX's output
    // files in that group, so the server can read the PDF; the server owns the folder, so it can remove them.
    if (runAs) await chmod(dir, 0o2770);
    await writeFile(path.join(dir, "resume.tex"), PREAMBLE_PREFIX + tex, "utf8");
    const run = await runLatexmk(latexCommand(latexmk, LATEXMK_ARGS, runAs, timeout), dir, timeout);
    // The captured output covers a timeout or an early latexmk failure, where no log file exists.
    const log = (await readLog(dir)) || run.output;
    const failure = runFailure(run, latexmk, runAs, timeout);
    if (failure) return { ok: false, message: failure, log };
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

function runFailure(run: RunResult, latexmk: string, runAs: string | undefined, timeoutMs: number): string | undefined {
  if (run.error?.code === "ENOENT") {
    return runAs
      ? `sudo not found, which is needed to run latexmk as "${runAs}". Install sudo or unset LATEX_RUN_AS.`
      : `latexmk not found at "${latexmk}". Install MacTeX or set LATEXMK_PATH.`;
  }
  if (run.error) return `Could not run latexmk: ${run.error.message}`;
  if (run.timedOut || (runAs && run.code === TIMEOUT_EXIT_CODE)) {
    return `LaTeX compilation timed out after ${Math.round(timeoutMs / 1000)}s and was stopped.`;
  }
  if (runAs && run.code === NOT_FOUND_EXIT_CODE) {
    return `latexmk not found at "${latexmk}" when run as "${runAs}". Check sudo's secure_path or set LATEXMK_PATH.`;
  }
  if (run.code !== 0) return "LaTeX compilation failed. See the log for details.";
  return undefined;
}

async function readLog(dir: string): Promise<string> {
  try {
    return await readFile(path.join(dir, "resume.log"), "utf8");
  } catch (err) {
    if (isEnoent(err)) return "";
    throw err;
  }
}
