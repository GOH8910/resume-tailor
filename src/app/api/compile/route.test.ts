import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.hoisted(() => vi.fn());
const plans = vi.hoisted(() => ({ get: vi.fn() }));
const banks = vi.hoisted(() => ({ read: vi.fn() }));
const applications = vi.hoisted(() => ({ get: vi.fn(), savePdf: vi.fn() }));
const compileTex = vi.hoisted(() => vi.fn());
const env = vi.hoisted(() => ({}) as Record<string, unknown>);
vi.mock("@/lib/auth", () => ({ getAuth: () => ({ api: { getSession } }) }));
vi.mock("@/lib/deps", () => ({ plans, banks, applications }));
// Filled before the route loads: the compile queue reads COMPILE_CONCURRENCY when it is created.
vi.mock("@/lib/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/env")>();
  Object.assign(env, actual.parseEnv({ APP_MODE: "hosted" }));
  return { ...actual, env };
});
vi.mock("@/latex/compile", () => ({ compileTex }));
vi.mock("@/latex/template", () => ({ loadTemplate: async () => "%%CONTENT%%" }));

import { emptyBank } from "@/bank/schema";
import type { ResumeState } from "@/applications/schema";
import { parseEnv } from "@/lib/env";
import { clearLimits } from "@/lib/limits";
import { POST } from "./route";

const ADA = { user: { id: "u1", email: "ada@example.com", name: "Ada" }, session: { id: "s1" } };
const RESUME: ResumeState = { summary: "", education: [], experience: [], projects: [], skills: [] };
const PDF = { ok: true, pdf: Buffer.from("%PDF-1.4"), pages: 1, log: "" };

function useEnv(source: Record<string, string>) {
  for (const key of Object.keys(env)) delete env[key];
  Object.assign(env, parseEnv(source));
}

async function compile(resume: unknown = RESUME) {
  getSession.mockResolvedValueOnce(ADA);
  return POST(new Request("http://localhost/api/compile", { method: "POST", body: JSON.stringify({ resume }) }));
}

beforeEach(() => {
  vi.resetAllMocks();
  plans.get.mockResolvedValue({ plan: "free", credits: 0 });
  banks.read.mockResolvedValue(emptyBank("Ada"));
  compileTex.mockResolvedValue(PDF);
  useEnv({ APP_MODE: "hosted" });
  clearLimits();
});

describe("POST /api/compile", () => {
  it("answers the PDF with its page count", async () => {
    const res = await compile();
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Page-Count")).toBe("1");
  });

  it("runs TeX as the compile slot's own user, in a folder of that slot's group", async () => {
    useEnv({ APP_MODE: "hosted", LATEX_RUN_AS: "tex", COMPILE_ROOT: "/var/lib/compile" });
    await compile();
    // Which slot is free depends on earlier compiles; the user and the group must belong to the same one.
    const { runAs, group } = compileTex.mock.lastCall?.[1] as { runAs: string; group: string };
    const slot = /^tex([12])$/.exec(runAs)?.[1];
    expect(slot).toBeDefined();
    expect(group).toBe(`texrun${slot}`);
  });

  it("runs TeX as the server's user without LATEX_RUN_AS", async () => {
    await compile();
    expect(compileTex).toHaveBeenCalledWith(expect.any(String), {});
  });

  it("refuses a bullet over 600 characters with a 400, compiling nothing", async () => {
    const entry = { entryId: "e1", rationale: "", bullets: [{ bulletId: "b1", original: "", text: "x".repeat(601) }] };
    expect((await compile({ ...RESUME, experience: [entry] })).status).toBe(400);
    expect(compileTex).not.toHaveBeenCalled();
  });

  it("refuses a resume over 200 KB as JSON with a 413, compiling nothing", async () => {
    const bullets = Array.from({ length: 400 }, (_, i) => ({ bulletId: `b${i}`, original: "", text: "x".repeat(600) }));
    const res = await compile({ ...RESUME, experience: [{ entryId: "e1", rationale: "", bullets }] });
    expect(res.status).toBe(413);
    expect((await res.json()).error).toBe("The resume is too large: keep it under 200 KB");
    expect(compileTex).not.toHaveBeenCalled();
  });

  it("answers the 61st compile in 10 minutes with a 429 and Retry-After, in hosted mode only", async () => {
    for (let i = 0; i < 60; i++) expect((await compile()).status).toBe(200);
    const res = await compile();
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("10");
    expect(await res.json()).toEqual({ error: "Too many compile requests, try again in 10 s", details: { retryAfter: 10 } });
    expect(compileTex).toHaveBeenCalledTimes(60);

    useEnv({ APP_MODE: "selfhost" });
    expect((await compile()).status).toBe(200);
  });

  it("answers 503 with Retry-After: 10 when the compile queue is full", async () => {
    // Two compiles run (COMPILE_CONCURRENCY 2) and eight wait; the eleventh is turned away.
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    compileTex.mockImplementation(async () => {
      await held;
      return PDF;
    });
    useEnv({ APP_MODE: "selfhost" });
    const inFlight = Array.from({ length: 10 }, () => compile());
    // Let the ten reach the queue: each awaits the session, the plan and the bank first.
    await vi.waitFor(() => expect(compileTex).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 20));
    const res = await compile();
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("10");
    expect(await res.json()).toEqual({ error: "Server busy, try again in a moment", details: { retryAfter: 10 } });
    release();
    expect((await Promise.all(inFlight)).map((r) => r.status)).toEqual(Array(10).fill(200));
  });
});
