import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.hoisted(() => vi.fn());
const plans = vi.hoisted(() => ({ get: vi.fn() }));
const exportAccount = vi.hoisted(() => vi.fn());
const db = vi.hoisted(() => ({ name: "the database" }));
const env = vi.hoisted(() => ({}) as Record<string, unknown>);
vi.mock("@/lib/auth", () => ({ getAuth: () => ({ api: { getSession } }) }));
vi.mock("@/lib/deps", () => ({ plans }));
vi.mock("@/db/client", () => ({ getDb: async () => db }));
vi.mock("@/account/export", () => ({ exportAccount }));
vi.mock("@/lib/env", async (importOriginal) => ({ ...(await importOriginal<object>()), env }));

import { parseEnv } from "@/lib/env";
import { clearLimits } from "@/lib/limits";
import { GET } from "./route";

const ADA = { user: { id: "u1", email: "ada@example.com", name: "Ada" }, session: { id: "s1" } };
const EXPORTED = { exportedAt: "2026-10-29T12:00:00.000Z", email: "ada@example.com", bank: { summary: "Hi" }, applications: [], credits: [] };

function useEnv(source: Record<string, string>) {
  for (const key of Object.keys(env)) delete env[key];
  Object.assign(env, parseEnv(source));
}

async function exportAs(session = ADA) {
  getSession.mockResolvedValueOnce(session);
  return GET(new Request("http://localhost/api/account/export"));
}

beforeEach(() => {
  vi.resetAllMocks();
  plans.get.mockResolvedValue({ plan: "free", credits: 0 });
  exportAccount.mockResolvedValue(EXPORTED);
  useEnv({ APP_MODE: "hosted" });
  clearLimits();
});

describe("GET /api/account/export", () => {
  it("answers 401 without a session", async () => {
    getSession.mockResolvedValueOnce(null);
    expect((await GET(new Request("http://localhost/api/account/export"))).status).toBe(401);
    expect(exportAccount).not.toHaveBeenCalled();
  });

  it("downloads the signed-in account's data as a JSON attachment", async () => {
    const res = await exportAs();

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="resume-tailor-export.json"');
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual(EXPORTED);
    expect(exportAccount).toHaveBeenCalledExactlyOnceWith(db, { id: "u1", email: "ada@example.com" });
  });

  it("allows a burst of 5 exports per account in hosted mode", async () => {
    for (let i = 0; i < 5; i++) expect((await exportAs()).status).toBe(200);
    const res = await exportAs();
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).not.toBeNull();
    expect(exportAccount).toHaveBeenCalledTimes(5);
  });

  it("does not limit a self-hosted server", async () => {
    useEnv({ APP_MODE: "selfhost" });
    for (let i = 0; i < 6; i++) expect((await exportAs()).status).toBe(200);
  });
});
