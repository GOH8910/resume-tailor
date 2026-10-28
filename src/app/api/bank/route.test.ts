import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.hoisted(() => vi.fn());
const banks = vi.hoisted(() => ({ createEmpty: vi.fn(), read: vi.fn(), write: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAuth: () => ({ api: { getSession } }) }));
vi.mock("@/lib/deps", () => ({ banks }));

import { GET, PUT } from "./route";

const ADA = { user: { id: "u1", email: "ada@example.com", name: "Ada" }, session: { id: "s1" } };
const get = () => GET(new Request("http://localhost/api/bank"));

beforeEach(() => vi.resetAllMocks());

describe("GET /api/bank", () => {
  it("answers 401 without a session and touches no bank", async () => {
    getSession.mockResolvedValueOnce(null);
    expect((await get()).status).toBe(401);
    expect(banks.createEmpty).not.toHaveBeenCalled();
    expect(banks.read).not.toHaveBeenCalled();
  });

  it("creates the signed-in user's bank if it is missing, then reads it", async () => {
    getSession.mockResolvedValueOnce(ADA);
    banks.read.mockResolvedValueOnce({ profile: { name: "Ada" } });

    const res = await get();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ profile: { name: "Ada" } });
    expect(banks.createEmpty).toHaveBeenCalledWith("u1", "Ada");
    expect(banks.read).toHaveBeenCalledWith("u1");
    expect(banks.createEmpty.mock.invocationCallOrder[0]).toBeLessThan(banks.read.mock.invocationCallOrder[0]);
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
