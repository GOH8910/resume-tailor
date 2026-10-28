import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { latexEnv } from "./compile";
import { checkLatexmk, resetLatexmkCache } from "./latexmk-check";

let dir: string;
let runs: string;

// A stand-in latexmk that records each run, so the tests can count how often the probe spawned it.
async function fakeLatexmk(name: string, body: string): Promise<string> {
  const script = path.join(dir, name);
  await writeFile(script, `#!/bin/sh\necho run >> "${runs}"\n${body}\n`, { mode: 0o755 });
  return script;
}

async function runCount(): Promise<number> {
  try {
    return (await readFile(runs, "utf8")).split("\n").filter(Boolean).length;
  } catch {
    return 0;
  }
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "latexmk-check-"));
});
afterAll(() => rm(dir, { recursive: true, force: true }));
beforeEach(async () => {
  resetLatexmkCache();
  runs = path.join(dir, `runs-${Math.random().toString(36).slice(2)}`);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("checkLatexmk", () => {
  it("reports ok when latexmk -version exits 0", async () => {
    const latexmkPath = await fakeLatexmk("ok", "exit 0");
    expect(await checkLatexmk({ latexmkPath })).toBe("ok");
  });

  it("reports missing when the binary does not exist", async () => {
    expect(await checkLatexmk({ latexmkPath: path.join(dir, "nope") })).toBe("missing");
  });

  it("reports the exit code when latexmk fails", async () => {
    const latexmkPath = await fakeLatexmk("fails", "exit 3");
    expect(await checkLatexmk({ latexmkPath })).toBe("error: exit 3");
  });

  it("gives up after the timeout", async () => {
    const latexmkPath = await fakeLatexmk("hangs", "exec sleep 10");
    const started = Date.now();
    expect(await checkLatexmk({ latexmkPath, timeoutMs: 200 })).toBe("error: timeout");
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("reuses an ok result for 5 minutes, then probes again", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const latexmkPath = await fakeLatexmk("cached", "exit 0");

    expect(await checkLatexmk({ latexmkPath })).toBe("ok");
    vi.advanceTimersByTime(5 * 60_000 - 1);
    expect(await checkLatexmk({ latexmkPath })).toBe("ok");
    expect(await runCount()).toBe(1);

    vi.advanceTimersByTime(1);
    expect(await checkLatexmk({ latexmkPath })).toBe("ok");
    expect(await runCount()).toBe(2);
  });

  it("shares one probe between checks that arrive while it is running", async () => {
    const latexmkPath = await fakeLatexmk("slow-ok", "sleep 0.2\nexit 0");

    const statuses = await Promise.all(Array.from({ length: 5 }, () => checkLatexmk({ latexmkPath })));

    expect(statuses).toEqual(["ok", "ok", "ok", "ok", "ok"]);
    expect(await runCount()).toBe(1);
  });

  it("shares a failing probe too, then probes afresh on the next check", async () => {
    const latexmkPath = await fakeLatexmk("slow-fail", "sleep 0.2\nexit 2");

    const statuses = await Promise.all([checkLatexmk({ latexmkPath }), checkLatexmk({ latexmkPath })]);
    expect(statuses).toEqual(["error: exit 2", "error: exit 2"]);
    expect(await runCount()).toBe(1);

    await checkLatexmk({ latexmkPath });
    expect(await runCount()).toBe(2);
  });

  it("probes again on the next check after a failure", async () => {
    const latexmkPath = await fakeLatexmk("flaky", "exit 1");
    await checkLatexmk({ latexmkPath });
    await checkLatexmk({ latexmkPath });
    expect(await runCount()).toBe(2);
  });
});

function hasLatexmk(): boolean {
  try {
    execFileSync(process.env.LATEXMK_PATH ?? "latexmk", ["-version"], { env: latexEnv(), stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!hasLatexmk())("checkLatexmk (needs latexmk)", () => {
  it("finds the installed latexmk", async () => {
    expect(await checkLatexmk()).toBe("ok");
  });
});
