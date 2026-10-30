import { execFileSync } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as realSleep } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { compileTex } from "./compile";

// How compileTex stops a latexmk that outlives its time limit, with stand-in scripts in place of latexmk.

/** Waits in real time (node:timers/promises is not faked) until `file` exists, or throws after `limitMs`. */
async function waitForFile(file: string, limitMs: number): Promise<void> {
  const deadline = performance.now() + limitMs;
  for (;;) {
    try {
      await access(file);
      return;
    } catch {
      if (performance.now() > deadline) throw new Error(`${file} did not appear within ${limitMs} ms`);
      await realSleep(20);
    }
  }
}

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
    // It publishes its pid (by rename, so the file is never seen half-written) only once it has detached.
    const pidFile = path.join(bin, "holder.pid");
    const holder = `perl -MPOSIX -e 'POSIX::setsid(); open(my $f, ">", "$ARGV[0].tmp") or die; print $f $$; close $f; rename("$ARGV[0].tmp", $ARGV[0]) or die; sleep 41' "${pidFile}"`;
    const latexmk = await fakeLatexmk("holder", `rm -f "${pidFile}"\n${holder} &\nsleep 30`);
    // compileTex's timers run on fake time and the test moves the clock only once the holder has detached, so no
    // signal can reach it first, however slowly the stand-in starts on a loaded machine (a real 1 s timeout
    // occasionally fired before the holder existed in full-suite runs).
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let settled = false;
    try {
      const compiling = compileTex("x", { latexmkPath: latexmk, timeoutMs: STANDIN_TIMEOUT_MS }).finally(() => {
        settled = true;
      });
      await waitForFile(pidFile, 10_000);
      // The timeout (SIGTERM to the group), then SIGKILL 3 s later: neither reaches the holder, which keeps the
      // output open. Real pauses let any early end of output arrive before the check.
      await vi.advanceTimersByTimeAsync(STANDIN_TIMEOUT_MS + 3_000);
      await realSleep(300);
      await vi.advanceTimersByTimeAsync(2_000 - 1);
      await realSleep(300);
      expect(settled).toBe(false);
      // The give-up, 2 s after the SIGKILL, ends the wait instead of the holder's 41 s.
      await vi.advanceTimersByTimeAsync(1);
      const result = await compiling;
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.message).toMatch(/timed out/);
    } finally {
      vi.useRealTimers();
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
