import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { latexEnv } from "./compile";
import { writeFakeSudo } from "./fake-sudo";
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

describe("checkLatexmk as another user (stand-in sudo)", () => {
  let bin: string;

  beforeAll(async () => {
    bin = await mkdtemp(path.join(os.tmpdir(), "latexmk-check-sudo-"));
    await writeFakeSudo(bin);
  });
  afterAll(() => rm(bin, { recursive: true, force: true }));
  beforeEach(() => {
    vi.stubEnv("PATH", `${bin}:${process.env.PATH}`);
    vi.stubEnv("LATEX_RUN_AS", undefined);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // The stand-in sudo exits 99 unless it gets the sudo + GNU timeout command line, so "ok" proves the shape.
  it("probes latexmk through sudo as that user", async () => {
    const latexmkPath = await fakeLatexmk("as-tex", '[ "$FAKE_SUDO_RUN_AS" = tex ] || exit 5\nexit 0');
    expect(await checkLatexmk({ latexmkPath, runAs: "tex" })).toBe("ok");
    expect(await runCount()).toBe(1);
  });

  it("takes the user from LATEX_RUN_AS", async () => {
    vi.stubEnv("LATEX_RUN_AS", "tex");
    const latexmkPath = await fakeLatexmk("env-tex", '[ "$FAKE_SUDO_RUN_AS" = tex ] || exit 5\nexit 0');
    expect(await checkLatexmk({ latexmkPath })).toBe("ok");
  });

  it("reports a missing sudo as an error, not as a missing latexmk", async () => {
    vi.stubEnv("PATH", dir);
    const latexmkPath = await fakeLatexmk("no-sudo", "exit 0");
    expect(await checkLatexmk({ latexmkPath, runAs: "tex" })).toBe("error: sudo not found");
  });

  it("reports missing when latexmk cannot be found as that user", async () => {
    expect(await checkLatexmk({ latexmkPath: path.join(dir, "nope"), runAs: "tex" })).toBe("missing");
  });

  it("reports a sudo that refuses to run the command", async () => {
    const refusing = await mkdtemp(path.join(os.tmpdir(), "latexmk-check-refusing-"));
    try {
      await writeFile(path.join(refusing, "sudo"), "#!/bin/sh\necho 'sudo: a password is required' >&2\nexit 1\n", { mode: 0o755 });
      vi.stubEnv("PATH", refusing);
      const latexmkPath = await fakeLatexmk("refused", "exit 0");
      expect(await checkLatexmk({ latexmkPath, runAs: "tex" })).toBe("error: exit 1");
    } finally {
      await rm(refusing, { recursive: true, force: true });
    }
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
