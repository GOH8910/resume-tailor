import os from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { compileRoot, latexCommand, latexEnv } from "./compile";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("latexEnv", () => {
  it("keeps secrets out of the TeX environment", () => {
    vi.stubEnv("SOME_API_SECRET", "sk-should-never-reach-tex");
    vi.stubEnv("DATABASE_URL", "postgres://app:hunter2@db.internal/resume");

    const env = latexEnv();

    expect(env).not.toHaveProperty("SOME_API_SECRET");
    expect(env).not.toHaveProperty("DATABASE_URL");
    expect(JSON.stringify(env)).not.toContain("hunter2");
  });

  it("passes only PATH, HOME, TMPDIR, locale and TeX search variables, plus openout_any", () => {
    const allowed = /^(PATH|HOME|TMPDIR|LANG|LC_ALL|TEXMF[A-Z0-9_]*|TEXINPUTS|openout_any)$/;
    expect(Object.keys(latexEnv()).filter((key) => !allowed.test(key))).toEqual([]);
  });

  it("appends the TeX and Homebrew directories to PATH", () => {
    vi.stubEnv("PATH", "/usr/bin:/bin");
    expect(latexEnv().PATH).toBe("/usr/bin:/bin:/Library/TeX/texbin:/usr/local/bin:/opt/homebrew/bin");
  });

  it("forbids writes outside the compile folder even when the parent allows them", () => {
    vi.stubEnv("openout_any", "a");
    expect(latexEnv().openout_any).toBe("p");
  });

  it("keeps the home, temp, locale and custom TeX settings that are set", () => {
    vi.stubEnv("HOME", "/home/ada");
    vi.stubEnv("TMPDIR", "/scratch");
    vi.stubEnv("LANG", "en_GB.UTF-8");
    vi.stubEnv("LC_ALL", "en_GB.UTF-8");
    vi.stubEnv("TEXMFHOME", "/home/ada/texmf");
    vi.stubEnv("TEXINPUTS", ".:/home/ada/tex//:");

    expect(latexEnv()).toMatchObject({
      HOME: "/home/ada",
      TMPDIR: "/scratch",
      LANG: "en_GB.UTF-8",
      LC_ALL: "en_GB.UTF-8",
      TEXMFHOME: "/home/ada/texmf",
      TEXINPUTS: ".:/home/ada/tex//:",
    });
  });

  it("leaves out TEXMFOUTPUT, under which openout_any=p would still allow absolute writes", () => {
    vi.stubEnv("TEXMFOUTPUT", "/");
    vi.stubEnv("TEXMFHOME", "/home/ada/texmf");

    const env = latexEnv();

    expect(env).not.toHaveProperty("TEXMFOUTPUT");
    expect(env.TEXMFHOME).toBe("/home/ada/texmf");
  });

  it("leaves out variables that are not set", () => {
    vi.stubEnv("LC_ALL", undefined);
    expect(latexEnv()).not.toHaveProperty("LC_ALL");
  });
});

describe("latexCommand", () => {
  const args = ["-norc", "resume.tex"];

  it("runs latexmk directly when no user is configured", () => {
    expect(latexCommand("latexmk", args, undefined, 60_000)).toEqual({ file: "latexmk", args });
  });

  it("runs latexmk as the configured user through sudo, under GNU timeout 5 s inside the server's limit", () => {
    expect(latexCommand("latexmk", args, "tex", 60_000)).toEqual({
      file: "sudo",
      args: ["-n", "-u", "tex", "--", "/usr/bin/timeout", "-k", "3", "55s", "latexmk", "-norc", "resume.tex"],
    });
  });

  it("rounds the inner timeout up to whole seconds", () => {
    expect(latexCommand("latexmk", args, "tex", 60_500).args).toContain("56s");
  });

  it("keeps the inner timeout at half the limit or more when the limit is short", () => {
    expect(latexCommand("latexmk", args, "tex", 4_000).args).toContain("2s");
    expect(latexCommand("latexmk", args, "tex", 3_000).args).toContain("2s");
    expect(latexCommand("latexmk", args, "tex", 500).args).toContain("1s");
  });
});

describe("compileRoot", () => {
  it("uses COMPILE_ROOT when set", () => {
    vi.stubEnv("COMPILE_ROOT", "/var/lib/compile");
    expect(compileRoot()).toBe("/var/lib/compile");
  });

  it("falls back to the system temp folder", () => {
    vi.stubEnv("COMPILE_ROOT", undefined);
    expect(compileRoot()).toBe(os.tmpdir());
  });

  it("treats an empty COMPILE_ROOT as unset", () => {
    vi.stubEnv("COMPILE_ROOT", "");
    expect(compileRoot()).toBe(os.tmpdir());
  });
});
