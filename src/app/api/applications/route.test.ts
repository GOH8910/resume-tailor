import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.hoisted(() => vi.fn());
const plans = vi.hoisted(() => ({ get: vi.fn() }));
const applications = vi.hoisted(() => ({ count: vi.fn(), list: vi.fn() }));
const createManualApplication = vi.hoisted(() => vi.fn());
const env = vi.hoisted(() => ({}) as Record<string, unknown>);
vi.mock("@/lib/auth", () => ({ getAuth: () => ({ api: { getSession } }) }));
vi.mock("@/lib/deps", () => ({ plans, applications, banks: {} }));
vi.mock("@/lib/env", async (importOriginal) => ({ ...(await importOriginal<object>()), env }));
vi.mock("@/tailor/tailor", () => ({ createManualApplication }));

import { parseEnv } from "@/lib/env";
import { clearLimits } from "@/lib/limits";
import { POST } from "./route";

const ADA = { user: { id: "u1", email: "ada@example.com", name: "Ada" }, session: { id: "s1" } };
const job = { company: "Acme", jobDescription: "We need Go engineers." };

function useEnv(source: Record<string, string>) {
  for (const key of Object.keys(env)) delete env[key];
  Object.assign(env, parseEnv(source));
}

async function create(body: Record<string, unknown> = job) {
  getSession.mockResolvedValueOnce(ADA);
  return POST(new Request("http://localhost/api/applications", { method: "POST", body: JSON.stringify(body) }));
}

beforeEach(() => {
  vi.resetAllMocks();
  plans.get.mockResolvedValue({ plan: "free", credits: 0 });
  applications.count.mockResolvedValue(0);
  createManualApplication.mockResolvedValue({ id: "a1" });
  useEnv({ APP_MODE: "hosted" });
  clearLimits();
});

describe("POST /api/applications", () => {
  it("creates a manual application for the signed-in user", async () => {
    const res = await create({ ...job, roleTitle: "Engineer" });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ application: { id: "a1" } });
    expect(createManualApplication).toHaveBeenCalledWith({ userId: "u1", ...job, roleTitle: "Engineer" }, expect.anything());
  });

  it("refuses a 201st saved resume with a 409", async () => {
    applications.count.mockResolvedValue(200);
    const res = await create();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("You have 200 saved resumes; delete some first");
    expect(createManualApplication).not.toHaveBeenCalled();
  });

  it("refuses a job description over 20,000 characters with a 400", async () => {
    expect((await create({ ...job, jobDescription: "x".repeat(20_001) })).status).toBe(400);
    expect(createManualApplication).not.toHaveBeenCalled();
  });

  it("answers the 31st new resume in 10 minutes with a 429, in hosted mode only", async () => {
    for (let i = 0; i < 30; i++) expect((await create()).status).toBe(201);
    const res = await create();
    expect(res.status).toBe(429);
    expect((await res.json()).details).toEqual({ retryAfter: 20 });
    useEnv({ APP_MODE: "selfhost" });
    expect((await create()).status).toBe(201);
  });
});
