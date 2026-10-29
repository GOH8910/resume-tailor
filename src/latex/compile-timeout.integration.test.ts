import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compileTex } from "./compile";

// How compileTex stops a latexmk that outlives its time limit, with stand-in scripts in place of latexmk.

describe("compileTex timeout handling (stand-in latexmk)", () => {
  // Long enough for the stand-in shell to install its trap before the signal, even on a loaded machine.
  const STANDIN_TIMEOUT_MS = 1_000;
  // Timers may fire a little early relative to Date.now().
  const TIMER_SLACK_MS = 50;
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
    const result = await compileTex("x", { latexmkPath: latexmk, timeoutMs: STANDIN_TIMEOUT_MS });
    const elapsed = Date.now() - started;
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/timed out/);
    expect(result.log).toContain("got SIGTERM");
    expect(elapsed).toBeGreaterThanOrEqual(STANDIN_TIMEOUT_MS - TIMER_SLACK_MS);
    // Well before the SIGKILL that follows 3 s later: SIGTERM alone stopped it.
    expect(elapsed).toBeLessThan(STANDIN_TIMEOUT_MS + 2_000);
  }, 10_000);

  it("kills the process group with SIGKILL when SIGTERM is ignored", async () => {
    const latexmk = await fakeLatexmk("ignores-term", "trap '' TERM\nsleep 37.25");
    const started = Date.now();
    const result = await compileTex("x", { latexmkPath: latexmk, timeoutMs: STANDIN_TIMEOUT_MS });
    const elapsed = Date.now() - started;
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/timed out/);
    // Not before the SIGKILL 3 s after the timeout, and before the give-up 2 s after that: SIGKILL stopped it.
    expect(elapsed).toBeGreaterThanOrEqual(STANDIN_TIMEOUT_MS + 3_000 - TIMER_SLACK_MS);
    expect(elapsed).toBeLessThan(STANDIN_TIMEOUT_MS + 4_500);
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
      const result = await compileTex("x", { latexmkPath: latexmk, timeoutMs: STANDIN_TIMEOUT_MS });
      const elapsed = Date.now() - started;
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.message).toMatch(/timed out/);
      // It gave up 3 s + 2 s after the timeout instead of waiting out the 41 s holder.
      expect(elapsed).toBeGreaterThanOrEqual(STANDIN_TIMEOUT_MS + 5_000 - TIMER_SLACK_MS);
      expect(elapsed).toBeLessThan(STANDIN_TIMEOUT_MS + 8_000);
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
