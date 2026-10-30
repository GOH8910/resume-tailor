import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.hoisted(() => vi.fn());
const plans = vi.hoisted(() => ({ get: vi.fn() }));
const applications = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn() }));
const env = vi.hoisted(() => ({}) as Record<string, unknown>);
vi.mock("@/lib/auth", () => ({ getAuth: () => ({ api: { getSession } }) }));
vi.mock("@/lib/deps", () => ({ plans, applications }));
vi.mock("@/lib/env", async (importOriginal) => ({ ...(await importOriginal<object>()), env }));

import type { ResumeState } from "@/applications/schema";
import { parseEnv } from "@/lib/env";
import { clearLimits } from "@/lib/limits";
import { PUT } from "./route";

const ADA = { user: { id: "u1", email: "ada@example.com", name: "Ada" }, session: { id: "s1" } };
const ID = "2026-10-01-acme-aaaaaaaa";
const RESUME: ResumeState = { summary: "", education: [], experience: [], projects: [], skills: [] };

function useEnv(source: Record<string, string>) {
  for (const key of Object.keys(env)) delete env[key];
  Object.assign(env, parseEnv(source));
}

async function save(resume: unknown = RESUME) {
  getSession.mockResolvedValueOnce(ADA);
  const request = new Request(`http://localhost/api/applications/${ID}`, { method: "PUT", body: JSON.stringify({ resume }) });
  return PUT(request, { params: Promise.resolve({ id: ID }) });
}

beforeEach(() => {
  vi.resetAllMocks();
  plans.get.mockResolvedValue({ plan: "free", credits: 0 });
  applications.get.mockResolvedValue({ id: ID, resume: RESUME });
  applications.save.mockImplementation(async (_userId: string, application: unknown) => application);
  useEnv({ APP_MODE: "hosted" });
  clearLimits();
});

describe("PUT /api/applications/[id]", () => {
  it("saves the resume onto the stored application", async () => {
    const res = await save();
    expect(res.status).toBe(200);
    expect(applications.save).toHaveBeenCalledWith("u1", { id: ID, resume: RESUME });
  });

  it("refuses a resume over 700 KB as JSON with a 413, saving nothing", async () => {
    const bullets = Array.from({ length: 1_200 }, (_, i) => ({ bulletId: `b${i}`, original: "", text: "x".repeat(600) }));
    const res = await save({ ...RESUME, experience: [{ entryId: "e1", rationale: "", bullets }] });
    expect(res.status).toBe(413);
    expect((await res.json()).error).toBe("The resume is too large: keep it under 700 KB");
    expect(applications.save).not.toHaveBeenCalled();
  });

  it("answers the 121st save in 10 minutes with a 429, in hosted mode only", async () => {
    for (let i = 0; i < 120; i++) expect((await save()).status).toBe(200);
    const res = await save();
    expect(res.status).toBe(429);
    expect((await res.json()).details).toEqual({ retryAfter: 5 });
    expect(applications.save).toHaveBeenCalledTimes(120);
    useEnv({ APP_MODE: "selfhost" });
    expect((await save()).status).toBe(200);
  });
});
