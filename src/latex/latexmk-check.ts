import { type ChildProcess, spawn } from "node:child_process";
import { latexEnv } from "./compile";

export type LatexmkStatus = "ok" | "missing" | `error: ${string}`;
export type LatexmkCheckOptions = { latexmkPath?: string; timeoutMs?: number };

const OK_TTL_MS = 5 * 60_000;
// Fly gives the whole health check 5 s, so the probe has to answer well inside that.
const DEFAULT_TIMEOUT_MS = 4_000;

let lastOk: number | undefined;

export function resetLatexmkCache(): void {
  lastOk = undefined;
}

/**
 * Whether `latexmk -version` runs. Only an ok answer is cached: a failure is re-probed on the next check,
 * so a one-off timeout under load does not keep the machine marked unhealthy for five minutes.
 * Never rejects.
 */
export async function checkLatexmk(options: LatexmkCheckOptions = {}): Promise<LatexmkStatus> {
  if (lastOk !== undefined && Date.now() - lastOk < OK_TTL_MS) return "ok";
  const latexmk = options.latexmkPath ?? process.env.LATEXMK_PATH ?? "latexmk";
  const status = await probe(latexmk, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  if (status === "ok") lastOk = Date.now();
  return status;
}

function probe(latexmk: string, timeoutMs: number): Promise<LatexmkStatus> {
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      // No pipes: a stray grandchild holding stdout open could otherwise delay the answer past the timeout.
      child = spawn(latexmk, ["-version"], { env: latexEnv(), stdio: "ignore" });
    } catch (err) {
      resolve(`error: ${err instanceof Error ? err.name : "spawn failed"}`);
      return;
    }
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve("error: timeout");
    }, timeoutMs);
    child.once("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      resolve(err.code === "ENOENT" ? "missing" : `error: ${err.code ?? err.name}`);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve(code === 0 ? "ok" : `error: exit ${code ?? signal}`);
    });
  });
}
