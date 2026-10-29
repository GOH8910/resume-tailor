import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.hoisted(() => vi.fn());
const plans = vi.hoisted(() => ({ get: vi.fn() }));
const credits = vi.hoisted(() => ({ balance: vi.fn() }));
const env = vi.hoisted(() => ({}) as Record<string, unknown>);
vi.mock("@/lib/auth", () => ({ getAuth: () => ({ api: { getSession } }) }));
vi.mock("@/lib/deps", () => ({ plans, credits }));
vi.mock("@/lib/env", async (importOriginal) => ({ ...(await importOriginal<object>()), env }));

import { parseEnv } from "@/lib/env";
import { GET } from "./route";

const ADA = { user: { id: "u1", email: "ada@example.com", name: "Ada" }, session: { id: "s1" } };
const get = () => GET(new Request("http://localhost/api/me"));

function useEnv(source: Record<string, string>) {
  for (const key of Object.keys(env)) delete env[key];
  Object.assign(env, parseEnv(source));
}

beforeEach(() => {
  vi.resetAllMocks();
  useEnv({ APP_MODE: "hosted", CREDITS_PER_TAILOR: "3", CREDITS_PER_CHAT_MESSAGE: "1" });
});

describe("GET /api/me", () => {
  it("answers 401 without a session", async () => {
    getSession.mockResolvedValueOnce(null);
    expect((await get()).status).toBe(401);
    expect(plans.get).not.toHaveBeenCalled();
  });

  it("describes a free account in hosted mode: Haiku, credits and ads", async () => {
    useEnv({ APP_MODE: "hosted", AD_PROVIDER: "test", CREDITS_PER_TAILOR: "3", CREDITS_PER_CHAT_MESSAGE: "1" });
    getSession.mockResolvedValueOnce(ADA);
    plans.get.mockResolvedValue({ plan: "free", credits: 0 });
    credits.balance.mockResolvedValue(5);

    const res = await get();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      email: "ada@example.com",
      plan: "free",
      mode: "hosted",
      credits: 5,
      policy: { model: "claude-haiku-5-5", picksModel: false, chargesCredits: true, showsAds: true, limited: true },
      creditsPerTailor: 3,
      creditsPerChatMessage: 1,
      adsAvailable: true,
      ads: { provider: "test", ssv: false, minWatchSeconds: 7 },
      isAdmin: false,
    });
    expect(credits.balance).toHaveBeenCalledWith("u1");
  });

  it("says no ads are available while the server has no ad network", async () => {
    getSession.mockResolvedValueOnce(ADA);
    plans.get.mockResolvedValue({ plan: "free", credits: 0 });
    credits.balance.mockResolvedValue(0);

    const body = await (await get()).json();

    expect(body.adsAvailable).toBe(false);
    expect(body.ads).toEqual({ provider: "none", ssv: false, minWatchSeconds: 7 });
  });

  it("hands the browser the Google ad unit and SSV flag, and no secrets", async () => {
    useEnv({ APP_MODE: "hosted", AD_PROVIDER: "google", AD_UNIT_PATH: "/123/rewarded", AD_SSV_ENABLED: "true" });
    getSession.mockResolvedValueOnce(ADA);
    plans.get.mockResolvedValue({ plan: "free", credits: 0 });
    credits.balance.mockResolvedValue(0);

    const body = await (await get()).json();

    expect(body.ads).toEqual({ provider: "google", adUnitPath: "/123/rewarded", ssv: true, minWatchSeconds: 7 });
  });

  it("describes an unlimited account in hosted mode", async () => {
    getSession.mockResolvedValueOnce(ADA);
    plans.get.mockResolvedValue({ plan: "unlimited", credits: 0 });

    const body = await (await get()).json();

    expect(body.plan).toBe("unlimited");
    expect(body.policy).toEqual({ model: "claude-sonnet-5-5", picksModel: true, chargesCredits: false, showsAds: false, limited: true });
  });

  it("tells an account listed in ADMIN_EMAILS that it is an admin, whatever its plan", async () => {
    useEnv({ APP_MODE: "hosted", ADMIN_EMAILS: "Ops@example.com, ada@example.com" });
    getSession.mockResolvedValueOnce(ADA);
    plans.get.mockResolvedValue({ plan: "free", credits: 0 });
    credits.balance.mockResolvedValue(0);

    expect((await (await get()).json()).isAdmin).toBe(true);
  });

  it("describes any account in selfhost mode as unrestricted", async () => {
    useEnv({ APP_MODE: "selfhost", UNLIMITED_MODEL: "claude-opus-5-5" });
    getSession.mockResolvedValueOnce(ADA);
    plans.get.mockResolvedValue({ plan: "free", credits: 0 });

    const body = await (await get()).json();

    expect(body.mode).toBe("selfhost");
    expect(body.ads.provider).toBe("none");
    expect(body.policy).toEqual({ model: "claude-opus-5-5", picksModel: true, chargesCredits: false, showsAds: false, limited: false });
  });
});
