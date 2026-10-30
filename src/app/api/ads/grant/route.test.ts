import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.hoisted(() => vi.fn());
const plans = vi.hoisted(() => ({ get: vi.fn() }));
const credits = vi.hoisted(() => ({ grantAd: vi.fn(), adSessionStatus: vi.fn(), balance: vi.fn() }));
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

async function grantAs(plan: "free" | "unlimited", body: unknown) {
  getSession.mockResolvedValueOnce(ADA);
  plans.get.mockResolvedValue({ plan, credits: 0 });
  return POST(new Request("http://localhost/api/ads/grant", { method: "POST", body: JSON.stringify(body) }));
}

beforeEach(() => {
  vi.resetAllMocks();
  credits.grantAd.mockResolvedValue({ credits: 4 });
  credits.adSessionStatus.mockResolvedValue({ status: "started" });
  credits.balance.mockResolvedValue(3);
  useEnv({ APP_MODE: "hosted", AD_PROVIDER: "test" });
});

describe("POST /api/ads/grant", () => {
  it("answers 401 without a session", async () => {
    getSession.mockResolvedValueOnce(null);
    const res = await POST(new Request("http://localhost/api/ads/grant", { method: "POST", body: JSON.stringify({ sessionId: SESSION_ID }) }));
    expect(res.status).toBe(401);
  });

  it("grants the account's session and answers with the new balance", async () => {
    const res = await grantAs("free", { sessionId: SESSION_ID });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ credits: 4 });
    expect(credits.grantAd).toHaveBeenCalledExactlyOnceWith({ userId: "u1", sessionId: SESSION_ID });
  });

  it.each([[{}], [{ sessionId: "not-a-uuid" }]])("refuses a body without a session id (%j) with a 400", async (body) => {
    expect((await grantAs("free", body)).status).toBe(400);
    expect(credits.grantAd).not.toHaveBeenCalled();
  });

  it("passes a rejected grant's 409 and reason through", async () => {
    credits.grantAd.mockRejectedValue(new AppError("The ad was closed too early", 409, { reason: "watched too briefly" }));
    const res = await grantAs("free", { sessionId: SESSION_ID });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "The ad was closed too early", details: { reason: "watched too briefly" } });
  });

  it("only reports the session's status and the balance while server-side verification grants", async () => {
    useEnv({ APP_MODE: "hosted", AD_PROVIDER: "test", AD_SSV_ENABLED: "true" });
    const res = await grantAs("free", { sessionId: SESSION_ID });
    expect(await res.json()).toEqual({ status: "started", credits: 3 });
    expect(credits.adSessionStatus).toHaveBeenCalledWith("u1", SESSION_ID);
    expect(credits.grantAd).not.toHaveBeenCalled();
  });

  it("refuses accounts without ads and servers without an ad network", async () => {
    expect((await grantAs("unlimited", { sessionId: SESSION_ID })).status).toBe(400);
    useEnv({ APP_MODE: "hosted", AD_PROVIDER: "none" });
    expect((await grantAs("free", { sessionId: SESSION_ID })).status).toBe(503);
    expect(credits.grantAd).not.toHaveBeenCalled();
  });
});
