import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.hoisted(() => vi.fn());
const banks = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));
const plans = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAuth: () => ({ api: { getSession } }) }));
vi.mock("@/lib/deps", () => ({ banks, plans }));

import { GET, PUT } from "./route";

const ADA = { user: { id: "u1", email: "ada@example.com", name: "Ada" }, session: { id: "s1" } };
const get = () => GET(new Request("http://localhost/api/bank"));

beforeEach(() => {
  vi.resetAllMocks();
  plans.get.mockResolvedValue({ plan: "free", credits: 0 });
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
    banks.write.mockImplementationOnce(async (_userId: string, bank: unknown) => bank);
    const body = { profile: { name: "Ada" } };

    const res = await PUT(new Request("http://localhost/api/bank?profile=someone-else", { method: "PUT", body: JSON.stringify(body) }));

    expect(res.status).toBe(200);
    expect(banks.write).toHaveBeenCalledWith("u1", body);
  });
});
