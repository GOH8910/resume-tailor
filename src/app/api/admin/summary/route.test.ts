import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.hoisted(() => vi.fn());
const plans = vi.hoisted(() => ({ get: vi.fn() }));
const usage = vi.hoisted(() => ({ name: "usage service" }));
const adminSummary = vi.hoisted(() => vi.fn());
const db = vi.hoisted(() => ({ name: "the database" }));
const env = vi.hoisted(() => ({}) as Record<string, unknown>);
vi.mock("@/lib/auth", () => ({ getAuth: () => ({ api: { getSession } }) }));
vi.mock("@/lib/deps", () => ({ plans, usage }));
vi.mock("@/db/client", () => ({ getDb: async () => db }));
vi.mock("@/admin/summary", () => ({ adminSummary }));
vi.mock("@/lib/env", async (importOriginal) => ({ ...(await importOriginal<object>()), env }));

import { parseEnv } from "@/lib/env";
import { GET } from "./route";

const as = (email: string) => ({ user: { id: "u1", email, name: "Ed" }, session: { id: "s1" } });
const SUMMARY = { manualPause: false };

function getAs(session: unknown) {
  getSession.mockResolvedValueOnce(session);
  return GET(new Request("http://localhost/api/admin/summary"));
}

beforeEach(() => {
  vi.resetAllMocks();
  for (const key of Object.keys(env)) delete env[key];
  Object.assign(env, parseEnv({ APP_MODE: "hosted", ADMIN_EMAILS: "ops@example.com", FREE_DAILY_BUDGET_GBP: "3.5" }));
  plans.get.mockResolvedValue({ plan: "unlimited", credits: 0 });
  adminSummary.mockResolvedValue(SUMMARY);
});

describe("GET /api/admin/summary", () => {
  it("answers 401 without a session", async () => {
    expect((await getAs(null)).status).toBe(401);
  });

  it("answers 404 to an account that is not an admin, even an unlimited one", async () => {
    const res = await getAs(as("ada@example.com"));
    expect(res.status).toBe(404);
    expect(adminSummary).not.toHaveBeenCalled();
  });

  it("answers the summary to an admin, with the configured budget", async () => {
    const res = await getAs(as("Ops@Example.com"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(SUMMARY);
    expect(adminSummary).toHaveBeenCalledExactlyOnceWith({ db, usage, freeDailyBudgetGbp: 3.5 });
  });
});
