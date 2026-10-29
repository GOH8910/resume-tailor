import { beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({}) as Record<string, unknown>);
vi.mock("@/lib/env", async (importOriginal) => ({ ...(await importOriginal<object>()), env }));

import { parseEnv } from "./env";
import { AppError } from "./errors";
import { clearLimits, limits, limitUser, requireWithinLimit } from "./limits";
import { createRateLimiter } from "./rate-limit";

function useEnv(source: Record<string, string>) {
  for (const key of Object.keys(env)) delete env[key];
  Object.assign(env, parseEnv(source));
}

function caught(fn: () => void): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  return undefined;
}

beforeEach(() => {
  clearLimits();
  useEnv({ APP_MODE: "hosted" });
});

describe("requireWithinLimit", () => {
  it("passes while tokens remain", () => {
    const limiter = createRateLimiter({ capacity: 1, refillPerSecond: 0.1 });
    expect(() => requireWithinLimit(limiter, "u1", "tailor", 0)).not.toThrow();
  });

  it("throws a 429 that says how long to wait, in the message and in details.retryAfter", () => {
    const limiter = createRateLimiter({ capacity: 1, refillPerSecond: 0.1 });
    requireWithinLimit(limiter, "u1", "tailor", 0);
    const err = caught(() => requireWithinLimit(limiter, "u1", "tailor", 3_000));
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ status: 429, message: "Too many tailor requests, try again in 7 s", details: { retryAfter: 7 } });
  });
});

describe("limits", () => {
  it.each([
    ["tailor", 10],
    ["chat", 30],
    ["compile", 30],
    ["bankWrite", 60],
    ["adStart", 20],
    ["applicationCreate", 30],
  ] as const)("%s allows a burst of %i", (name, burst) => {
    const { limiter } = limits[name];
    for (let i = 0; i < burst; i++) expect(limiter.take("u1", 0).ok).toBe(true);
    expect(limiter.take("u1", 0).ok).toBe(false);
  });

  it("refills tailor at 10 an hour and chat at 30 per 10 minutes", () => {
    for (let i = 0; i < 10; i++) limits.tailor.limiter.take("u1", 0);
    expect(limits.tailor.limiter.take("u1", 0)).toEqual({ ok: false, retryAfterSeconds: 360 });
    for (let i = 0; i < 30; i++) limits.chat.limiter.take("u1", 0);
    expect(limits.chat.limiter.take("u1", 0)).toEqual({ ok: false, retryAfterSeconds: 20 });
  });
});

describe("limitUser", () => {
  const ada = { id: "u1", plan: "free" as const };

  it("limits every plan in hosted mode, keyed by the account", () => {
    for (let i = 0; i < 10; i++) limitUser("tailor", { id: "u1", plan: "unlimited" });
    expect(caught(() => limitUser("tailor", { id: "u1", plan: "unlimited" }))).toMatchObject({ status: 429 });
    expect(() => limitUser("tailor", { id: "u2", plan: "free" })).not.toThrow();
  });

  it("never limits a self-hosted server", () => {
    useEnv({ APP_MODE: "selfhost" });
    for (let i = 0; i < 50; i++) limitUser("tailor", ada);
    expect(limits.tailor.limiter.size()).toBe(0);
  });
});
