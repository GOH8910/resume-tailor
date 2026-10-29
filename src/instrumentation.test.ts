import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getDb = vi.hoisted(() => vi.fn());
const env = vi.hoisted(() => ({ FREE_MODEL: "claude-haiku-5-5", UNLIMITED_MODEL: "claude-sonnet-5-5" }));
vi.mock("@/db/client", () => ({ getDb }));
vi.mock("@/lib/env", () => ({ env }));

import { register } from "./instrumentation";

describe("register", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NEXT_PHASE", "phase-production-server");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    // Replaces the throwing env of the invalid-configuration test; unmocking would load the real settings.
    vi.doMock("@/lib/env", () => ({ env }));
    vi.resetModules();
    getDb.mockReset();
    Object.assign(env, { FREE_MODEL: "claude-haiku-5-5", UNLIMITED_MODEL: "claude-sonnet-5-5" });
  });

  it("migrates at boot", async () => {
    getDb.mockResolvedValue({});

    await register();

    expect(getDb).toHaveBeenCalledOnce();
  });

  it("keeps serving when the boot migration fails, and retries it every 30 s until it succeeds", async () => {
    vi.useFakeTimers();
    const failure = new Error("connection refused");
    getDb.mockRejectedValueOnce(failure).mockRejectedValueOnce(failure).mockResolvedValue({});
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const infos = vi.spyOn(console, "info").mockImplementation(() => {});

    await expect(register()).resolves.toBeUndefined();
    expect(getDb).toHaveBeenCalledOnce();
    expect(errors).toHaveBeenCalledOnce();
    expect(errors).toHaveBeenCalledWith(expect.stringContaining("[db]"), failure);

    await vi.advanceTimersByTimeAsync(29_999);
    expect(getDb).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(getDb).toHaveBeenCalledTimes(2);
    expect(errors).toHaveBeenCalledTimes(2);
    expect(infos).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(30_000);
    expect(getDb).toHaveBeenCalledTimes(3);
    expect(errors).toHaveBeenCalledTimes(2);
    expect(infos).toHaveBeenCalledOnce();
    expect(infos).toHaveBeenCalledWith(expect.stringContaining("[db]"));

    // Once it has succeeded, nothing is scheduled any more.
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(getDb).toHaveBeenCalledTimes(3);
  });

  it("schedules no retry when the boot migration succeeds", async () => {
    vi.useFakeTimers();
    getDb.mockResolvedValue({});

    await register();

    expect(vi.getTimerCount()).toBe(0);
  });

  it("exits when the configuration is invalid, so a bad release fails its deploy", async () => {
    const invalid = new Error("BETTER_AUTH_URL must be set in production");
    vi.doMock("@/lib/env", () => {
      throw invalid;
    });
    vi.resetModules();
    const { register: registerFresh } = await import("./instrumentation");
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    await registerFresh();

    expect(exit).toHaveBeenCalledWith(1);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("[env]"), expect.anything());
    expect(getDb).not.toHaveBeenCalled();
  });

  it("warns once about a configured model without a price, and keeps booting", async () => {
    getDb.mockResolvedValue({});
    env.UNLIMITED_MODEL = "claude-mystery-9";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await register();

    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/claude-mystery-9.*claude-opus-5-5/));
    expect(getDb).toHaveBeenCalledOnce();
  });

  it("does not warn when both configured models are priced", async () => {
    getDb.mockResolvedValue({});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await register();

    expect(warn).not.toHaveBeenCalled();
  });

  it("does nothing during the production build", async () => {
    vi.stubEnv("NEXT_PHASE", "phase-production-build");

    await register();

    expect(getDb).not.toHaveBeenCalled();
  });
});
