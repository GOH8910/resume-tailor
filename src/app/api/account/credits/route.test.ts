import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.hoisted(() => vi.fn());
const plans = vi.hoisted(() => ({ get: vi.fn() }));
const credits = vi.hoisted(() => ({ balance: vi.fn(), history: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAuth: () => ({ api: { getSession } }) }));
vi.mock("@/lib/deps", () => ({ plans, credits }));

import { GET } from "./route";

const ADA = { user: { id: "u1", email: "ada@example.com", name: "Ada" }, session: { id: "s1" } };
const get = () => GET(new Request("http://localhost/api/account/credits"));

beforeEach(() => {
  vi.resetAllMocks();
  plans.get.mockResolvedValue({ plan: "free", credits: 0 });
});

describe("GET /api/account/credits", () => {
  it("answers 401 without a session", async () => {
    getSession.mockResolvedValueOnce(null);
    expect((await get()).status).toBe(401);
    expect(credits.history).not.toHaveBeenCalled();
  });

  it("answers the signed-in account's balance and its last 50 ledger rows", async () => {
    getSession.mockResolvedValueOnce(ADA);
    credits.balance.mockResolvedValue(3);
    credits.history.mockResolvedValue([
      { id: "e2", kind: "tailor", amount: -2, ref: "app-1", createdAt: new Date("2026-10-29T11:00:00Z") },
      { id: "e1", kind: "ad", amount: 1, ref: "ad-1", createdAt: new Date("2026-10-29T10:00:00Z") },
    ]);

    const res = await get();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      credits: 3,
      events: [
        { kind: "tailor", amount: -2, ref: "app-1", createdAt: "2026-10-29T11:00:00.000Z" },
        { kind: "ad", amount: 1, ref: "ad-1", createdAt: "2026-10-29T10:00:00.000Z" },
      ],
    });
    expect(credits.balance).toHaveBeenCalledWith("u1");
    expect(credits.history).toHaveBeenCalledWith("u1", 50);
  });
});
