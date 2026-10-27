import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { isEnoent } from "@/lib/fs";
import { countPdfPages } from "./page-count";

const execFileAsync = promisify(execFile);

export type CompileResult =
  | { ok: true; pdf: Buffer; pages: number; log: string }
  | { ok: false; message: string; log: string };

export type CompileOptions = { latexmkPath?: string; timeoutMs?: number };

/** PATH with the usual MacTeX and Homebrew locations appended, for servers launched from an IDE. */
export function latexEnv(): NodeJS.ProcessEnv {
  const extra = ["/Library/TeX/texbin", "/usr/local/bin", "/opt/homebrew/bin"];
  return { ...process.env, PATH: [process.env.PATH, ...extra].filter(Boolean).join(":") };
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
    try {
      await execFileAsync(
        latexmk,
        ["-pdf", "-interaction=nonstopmode", "-halt-on-error", `-output-directory=${dir}`, "resume.tex"],
        { cwd: dir, env: latexEnv(), timeout, maxBuffer: 16 * 1024 * 1024 },
      );
    } catch (err) {
      const log = await readLog(dir);
      if (isEnoent(err)) {
        return { ok: false, message: `latexmk not found at "${latexmk}". Install MacTeX or set LATEXMK_PATH.`, log };
      }
      return { ok: false, message: "LaTeX compilation failed. See the log for details.", log };
    }
    const pdf = await readFile(path.join(dir, "resume.pdf"));
    return { ok: true, pdf, pages: countPdfPages(pdf), log: await readLog(dir) };
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
