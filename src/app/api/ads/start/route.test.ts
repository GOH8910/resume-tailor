import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.hoisted(() => vi.fn());
const plans = vi.hoisted(() => ({ get: vi.fn() }));
const credits = vi.hoisted(() => ({ startAdSession: vi.fn() }));
const env = vi.hoisted(() => ({}) as Record<string, unknown>);
vi.mock("@/lib/auth", () => ({ getAuth: () => ({ api: { getSession } }) }));
vi.mock("@/lib/deps", () => ({ plans, credits }));
vi.mock("@/lib/env", async (importOriginal) => ({ ...(await importOriginal<object>()), env }));

import { parseEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { POST } from "./route";

const ADA = { user: { id: "u1", email: "ada@example.com", name: "Ada" }, session: { id: "s1" } };
const SESSION_ID = "7d3c0d0e-1b2a-4c5d-8e9f-0a1b2c3d4e5f";

function useEnv(source: Record<string, string>) {
  for (const key of Object.keys(env)) delete env[key];
  Object.assign(env, parseEnv(source));
}

async function startAs(plan: "free" | "unlimited", headers: Record<string, string> = {}) {
  getSession.mockResolvedValueOnce(ADA);
  plans.get.mockResolvedValue({ plan, credits: 0 });
  return POST(new Request("http://localhost/api/ads/start", { method: "POST", headers }));
}

beforeEach(() => {
  vi.resetAllMocks();
  credits.startAdSession.mockResolvedValue({ sessionId: SESSION_ID });
  useEnv({ APP_MODE: "hosted", AD_PROVIDER: "test" });
});

describe("POST /api/ads/start", () => {
  it("answers 401 without a session", async () => {
    getSession.mockResolvedValueOnce(null);
    expect((await POST(new Request("http://localhost/api/ads/start", { method: "POST" }))).status).toBe(401);
  });

  it("starts an ad session for a free account, keyed to its client IP and the provider", async () => {
    const res = await startAs("free", { "fly-client-ip": "203.0.113.1" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sessionId: SESSION_ID });
    expect(credits.startAdSession).toHaveBeenCalledExactlyOnceWith({ userId: "u1", ip: "203.0.113.1", provider: "test" });
  });

  it("refuses an account that sees no ads with a 400", async () => {
    const res = await startAs("unlimited");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Ads are not available for this account");
    useEnv({ APP_MODE: "selfhost", AD_PROVIDER: "test" });
    expect((await startAs("free")).status).toBe(400);
    expect(credits.startAdSession).not.toHaveBeenCalled();
  });

  it("answers 503 while the server has no ad network", async () => {
    useEnv({ APP_MODE: "hosted", AD_PROVIDER: "none" });
    const res = await startAs("free");
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("Ads are not available yet");
    expect(credits.startAdSession).not.toHaveBeenCalled();
  });

  it("passes the daily cap's 429 through with its reset time", async () => {
    const details = { reason: "account", resetsAt: "2026-10-30T00:00:00.000Z" };
    credits.startAdSession.mockRejectedValue(new AppError("Daily ad limit reached", 429, details));
    const res = await startAs("free");
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "Daily ad limit reached", details });
  });
});
