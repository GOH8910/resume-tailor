import { afterEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/types";

const forgetOldIps = vi.hoisted(() => vi.fn());
vi.mock("./service", () => ({ forgetOldIps }));

import { IP_PURGE_INTERVAL_MS, startIpPurge } from "./ip-purge";

const db = {} as Db;
const HOUR = 60 * 60 * 1000;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  forgetOldIps.mockReset();
});

describe("startIpPurge", () => {
  it("purges at once and then every hour", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-29T12:00:00Z") });
    forgetOldIps.mockResolvedValue(0);

    startIpPurge(async () => db);
    await vi.advanceTimersByTimeAsync(0);
    expect(forgetOldIps).toHaveBeenCalledOnce();
    expect(forgetOldIps).toHaveBeenLastCalledWith(db, new Date("2026-10-29T12:00:00Z"));

    await vi.advanceTimersByTimeAsync(HOUR - 1);
    expect(forgetOldIps).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(forgetOldIps).toHaveBeenCalledTimes(2);
    expect(forgetOldIps).toHaveBeenLastCalledWith(db, new Date("2026-10-29T13:00:00Z"));
    await vi.advanceTimersByTimeAsync(2 * HOUR);
    expect(forgetOldIps).toHaveBeenCalledTimes(4);
    expect(IP_PURGE_INTERVAL_MS).toBe(HOUR);
  });

  it("logs a failed run, never throws, and tries again the next hour", async () => {
    vi.useFakeTimers();
    const failure = new Error("connection refused");
    forgetOldIps.mockRejectedValueOnce(failure).mockResolvedValue(3);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => startIpPurge(async () => db)).not.toThrow();
    await vi.advanceTimersByTimeAsync(0);
    expect(errors).toHaveBeenCalledOnce();
    expect(errors).toHaveBeenCalledWith(expect.stringContaining("[credits]"), failure);

    await vi.advanceTimersByTimeAsync(HOUR);
    expect(forgetOldIps).toHaveBeenCalledTimes(2);
    expect(errors).toHaveBeenCalledOnce();
  });

  it("logs a database that cannot be opened, without throwing", async () => {
    vi.useFakeTimers();
    const failure = new Error("migration failed");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    startIpPurge(() => Promise.reject(failure));
    await vi.advanceTimersByTimeAsync(0);

    expect(forgetOldIps).not.toHaveBeenCalled();
    expect(errors).toHaveBeenCalledWith(expect.stringContaining("[credits]"), failure);
  });

  it("does not keep the process alive", () => {
    vi.useFakeTimers();
    forgetOldIps.mockResolvedValue(0);
    const unref = vi.fn();
    vi.spyOn(globalThis, "setInterval").mockReturnValue({ unref } as unknown as NodeJS.Timeout);

    startIpPurge(async () => db);

    expect(setInterval).toHaveBeenCalledWith(expect.any(Function), HOUR);
    expect(unref).toHaveBeenCalledOnce();
  });
});
