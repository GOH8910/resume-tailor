import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.hoisted(() => vi.fn());
const banks = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));
const plans = vi.hoisted(() => ({ get: vi.fn() }));
const env = vi.hoisted(() => ({}) as Record<string, unknown>);
vi.mock("@/lib/auth", () => ({ getAuth: () => ({ api: { getSession } }) }));
vi.mock("@/lib/deps", () => ({ banks, plans }));
vi.mock("@/lib/env", async (importOriginal) => ({ ...(await importOriginal<object>()), env }));

import { emptyBank } from "@/bank/schema";
import { parseEnv } from "@/lib/env";
import { clearLimits } from "@/lib/limits";
import { GET, PUT } from "./route";

function useEnv(source: Record<string, string>) {
  for (const key of Object.keys(env)) delete env[key];
  Object.assign(env, parseEnv(source));
}

/** Saves `bank` as Ada and returns the response. */
async function put(bank: unknown) {
  getSession.mockResolvedValueOnce(ADA);
  return PUT(new Request("http://localhost/api/bank", { method: "PUT", body: JSON.stringify(bank) }));
}

const withBullet = (text: string) => ({
  ...emptyBank("Ada"),
  experience: [{ id: "e1", title: "Engineer", start: "", end: "", bullets: [{ id: "b1", text }] }],
});

const ADA = { user: { id: "u1", email: "ada@example.com", name: "Ada" }, session: { id: "s1" } };
const get = () => GET(new Request("http://localhost/api/bank"));

beforeEach(() => {
  vi.resetAllMocks();
  plans.get.mockResolvedValue({ plan: "free", credits: 0 });
  banks.write.mockImplementation(async (_userId: string, bank: unknown) => bank);
  useEnv({ APP_MODE: "hosted" });
  clearLimits();
});

describe("GET /api/bank", () => {
  it("answers 401 without a session and touches no bank", async () => {
    getSession.mockResolvedValueOnce(null);
    expect((await get()).status).toBe(401);
    expect(banks.read).not.toHaveBeenCalled();
  });

  it("reads the signed-in user's bank", async () => {
    getSession.mockResolvedValueOnce(ADA);
    banks.read.mockResolvedValueOnce({ profile: { name: "Ada" } });

    const res = await get();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ profile: { name: "Ada" } });
    expect(banks.read).toHaveBeenCalledWith("u1");
  });
});

describe("PUT /api/bank", () => {
  it("writes the body to the signed-in user's bank, ignoring any ?profile=", async () => {
    getSession.mockResolvedValueOnce(ADA);
    const body = emptyBank("Ada");

    const res = await PUT(new Request("http://localhost/api/bank?profile=someone-else", { method: "PUT", body: JSON.stringify(body) }));

    expect(res.status).toBe(200);
    expect(banks.write).toHaveBeenCalledWith("u1", body);
  });

  it("refuses a body that is not a bank with a 400, writing nothing", async () => {
    const res = await put({ profile: { name: "Ada" } });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Bank does not match the schema");
    expect(banks.write).not.toHaveBeenCalled();
  });

  it("caps bullets at 600 characters", async () => {
    expect((await put(withBullet("x".repeat(600)))).status).toBe(200);
    const res = await put(withBullet("x".repeat(601)));
    expect(res.status).toBe(400);
    expect((await res.json()).details[0].message).toBe("A bullet can be at most 600 characters");
    expect(banks.write).toHaveBeenCalledOnce();
  });

  it("refuses a bank over 300,000 characters of JSON with a 413", async () => {
    const bullets = Array.from({ length: 600 }, (_, i) => ({ id: `b${i}`, text: "x".repeat(500) }));
    const big = { ...emptyBank("Ada"), experience: [{ id: "e1", title: "Engineer", start: "", end: "", bullets }] };
    expect(JSON.stringify(big).length).toBeGreaterThan(300_000);
    const res = await put(big);
    expect(res.status).toBe(413);
    expect((await res.json()).error).toBe("The bank is too large to save: keep it under 300,000 characters");
    expect(banks.write).not.toHaveBeenCalled();
  });

  it("answers the 61st save in 10 minutes with a 429 in hosted mode", async () => {
    for (let i = 0; i < 60; i++) expect((await put(emptyBank("Ada"))).status).toBe(200);
    const res = await put(emptyBank("Ada"));
    expect(res.status).toBe(429);
    expect((await res.json()).details).toEqual({ retryAfter: 10 });
    expect(banks.write).toHaveBeenCalledTimes(60);
  });

  it("does not limit saves on a self-hosted server", async () => {
    useEnv({ APP_MODE: "selfhost" });
    for (let i = 0; i < 65; i++) expect((await put(emptyBank("Ada"))).status).toBe(200);
  });
});
