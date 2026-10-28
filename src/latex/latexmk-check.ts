import { type ChildProcess, spawn } from "node:child_process";
import { type LatexCommand, latexCommand, latexEnv, latexRunAs } from "./compile";

export type LatexmkStatus = "ok" | "missing" | `error: ${string}`;
export type LatexmkCheckOptions = { latexmkPath?: string; timeoutMs?: number; runAs?: string };

const OK_TTL_MS = 5 * 60_000;
// Fly gives the whole health check 5 s, so the probe has to answer well inside that.
const DEFAULT_TIMEOUT_MS = 4_000;
// GNU timeout exits 124 when it stopped the command, and 127 (like a shell) when the command was not found.
const TIMEOUT_EXIT_CODE = 124;
const NOT_FOUND_EXIT_CODE = 127;

let lastOk: number | undefined;
let inFlight: Promise<LatexmkStatus> | undefined;

export function resetLatexmkCache(): void {
  lastOk = undefined;
  inFlight = undefined;
}

/**
 * Whether `latexmk -version` runs, the same way compiles run it (through sudo when LATEX_RUN_AS is set, so a
 * broken sudo rule shows up here). Only an ok answer is cached: a failure is re-probed on the next check,
 * so a one-off timeout under load does not keep the machine marked unhealthy for five minutes.
 * Checks that arrive while a probe is running share it, so a burst on the public endpoint spawns one process.
 * Never rejects.
 */
export function checkLatexmk(options: LatexmkCheckOptions = {}): Promise<LatexmkStatus> {
  if (lastOk !== undefined && Date.now() - lastOk < OK_TTL_MS) return Promise.resolve("ok");
  if (!inFlight) {
    const probing = runProbe(options).finally(() => {
      if (inFlight === probing) inFlight = undefined;
    });
    inFlight = probing;
  }
  return inFlight;
}

async function runProbe(options: LatexmkCheckOptions): Promise<LatexmkStatus> {
  const latexmk = options.latexmkPath ?? process.env.LATEXMK_PATH ?? "latexmk";
  const runAs = latexRunAs(options.runAs);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const status = await probe(latexCommand(latexmk, ["-version"], runAs, timeoutMs), runAs !== undefined, timeoutMs);
  if (status === "ok") lastOk = Date.now();
  return status;
}

function probe(command: LatexCommand, viaSudo: boolean, timeoutMs: number): Promise<LatexmkStatus> {
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      // No pipes: a stray grandchild holding stdout open could otherwise delay the answer past the timeout.
      child = spawn(command.file, command.args, { env: latexEnv(), stdio: "ignore" });
    } catch (err) {
      resolve(`error: ${err instanceof Error ? err.name : "spawn failed"}`);
      return;
    }
    const timer = setTimeout(() => {
      // Under sudo this only stops sudo; the GNU timeout inside it stops latexmk shortly after.
      child.kill("SIGKILL");
      resolve("error: timeout");
    }, timeoutMs);
    child.once("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (err.code !== "ENOENT") resolve(`error: ${err.code ?? err.name}`);
      else resolve(viaSudo ? "error: sudo not found" : "missing");
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve("ok");
      else if (viaSudo && code === TIMEOUT_EXIT_CODE) resolve("error: timeout");
      else if (viaSudo && code === NOT_FOUND_EXIT_CODE) resolve("missing");
      else resolve(`error: exit ${code ?? signal}`);
    });
  });
}
