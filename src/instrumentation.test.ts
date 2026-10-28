import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getDb = vi.hoisted(() => vi.fn());
vi.mock("@/db/client", () => ({ getDb }));
vi.mock("@/lib/env", () => ({ env: {} }));

import { register } from "./instrumentation";

describe("register", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NEXT_PHASE", "phase-production-server");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.doUnmock("@/lib/env");
    vi.resetModules();
    getDb.mockReset();
  });

  it("migrates at boot", async () => {
    getDb.mockResolvedValue({});

    await register();

    expect(getDb).toHaveBeenCalledOnce();
  });

  it("resolves and logs when the migration fails, so the server keeps serving", async () => {
    const failure = new Error("connection refused");
    getDb.mockRejectedValue(failure);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(register()).resolves.toBeUndefined();

    expect(logged).toHaveBeenCalledWith(expect.stringContaining("[db]"), failure);
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

  it("does nothing during the production build", async () => {
    vi.stubEnv("NEXT_PHASE", "phase-production-build");

    await register();

    expect(getDb).not.toHaveBeenCalled();
  });
});
