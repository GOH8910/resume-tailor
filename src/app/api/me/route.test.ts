import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.hoisted(() => vi.fn());
const plans = vi.hoisted(() => ({ get: vi.fn() }));
const env = vi.hoisted(() => ({}) as Record<string, unknown>);
vi.mock("@/lib/auth", () => ({ getAuth: () => ({ api: { getSession } }) }));
vi.mock("@/lib/deps", () => ({ plans }));
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
    getSession.mockResolvedValueOnce(ADA);
    plans.get.mockResolvedValue({ plan: "free", credits: 5 });

    const res = await get();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      email: "ada@example.com",
      plan: "free",
      mode: "hosted",
      credits: 5,
      policy: { model: "claude-haiku-5-5", chargesCredits: true, showsAds: true, limited: true },
      creditsPerTailor: 3,
      creditsPerChatMessage: 1,
    });
    expect(plans.get).toHaveBeenCalledWith("u1", "free");
  });

  it("describes an unlimited account in hosted mode", async () => {
    getSession.mockResolvedValueOnce(ADA);
    plans.get.mockResolvedValue({ plan: "unlimited", credits: 0 });

    const body = await (await get()).json();

    expect(body.plan).toBe("unlimited");
    expect(body.policy).toEqual({ model: "claude-sonnet-5-5", chargesCredits: false, showsAds: false, limited: true });
  });

  it("describes any account in selfhost mode as unrestricted", async () => {
    useEnv({ APP_MODE: "selfhost", UNLIMITED_MODEL: "claude-opus-5-5" });
    getSession.mockResolvedValueOnce(ADA);
    plans.get.mockResolvedValue({ plan: "free", credits: 0 });

    const body = await (await get()).json();

    expect(body.mode).toBe("selfhost");
    expect(body.policy).toEqual({ model: "claude-opus-5-5", chargesCredits: false, showsAds: false, limited: false });
  });
});
