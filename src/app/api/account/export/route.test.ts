import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.hoisted(() => vi.fn());
const plans = vi.hoisted(() => ({ get: vi.fn() }));
const exportStream = vi.hoisted(() => vi.fn());
const db = vi.hoisted(() => ({ name: "the database" }));
const env = vi.hoisted(() => ({}) as Record<string, unknown>);
vi.mock("@/lib/auth", () => ({ getAuth: () => ({ api: { getSession } }) }));
vi.mock("@/lib/deps", () => ({ plans }));
vi.mock("@/db/client", () => ({ getDb: async () => db }));
vi.mock("@/account/export", () => ({ exportStream }));
vi.mock("@/lib/env", async (importOriginal) => ({ ...(await importOriginal<object>()), env }));

import { parseEnv } from "@/lib/env";
import { clearLimits } from "@/lib/limits";
import { GET } from "./route";

const ADA = { user: { id: "u1", email: "ada@example.com", name: "Ada" }, session: { id: "s1" } };
const EXPORTED = { exportedAt: "2026-10-29T12:00:00.000Z", email: "ada@example.com", bank: { summary: "Hi" }, applications: [] };

/** Like the real stream: holds its export slot until the body has been read to the end. */
function streamOf(body: unknown, onEnd: () => void): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(JSON.stringify(body)));
    },
    pull(controller) {
      controller.close();
      onEnd();
    },
  });
}

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
  exportStream.mockImplementation(async (_db: unknown, _account: unknown, onEnd: () => void) => streamOf(EXPORTED, onEnd));
  useEnv({ APP_MODE: "hosted" });
  clearLimits();
});

afterEach(() => vi.restoreAllMocks());

describe("GET /api/account/export", () => {
  it("answers 401 without a session", async () => {
    getSession.mockResolvedValueOnce(null);
    expect((await GET(new Request("http://localhost/api/account/export"))).status).toBe(401);
    expect(exportStream).not.toHaveBeenCalled();
  });

  it("downloads the signed-in account's data as a JSON attachment", async () => {
    const res = await exportAs();

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="resume-tailor-export.json"');
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual(EXPORTED);
    expect(exportStream).toHaveBeenCalledExactlyOnceWith(db, { id: "u1", email: "ada@example.com" }, expect.any(Function));
  });

  it("refuses a second export for the account while the first is still downloading", async () => {
    const first = await exportAs();
    const second = await exportAs();
    expect(second.status).toBe(409);
    expect((await second.json()).error).toBe("An export is already running");

    await first.text();
    const third = await exportAs();
    expect(third.status).toBe(200);
    await third.text();
  });

  it("runs two exports across the server at a time", async () => {
    const as = (id: string) => ({ ...ADA, user: { ...ADA.user, id, email: `${id}@example.com` } });
    const running = [await exportAs(as("u1")), await exportAs(as("u2"))];
    const third = await exportAs(as("u3"));
    expect(third.status).toBe(503);
    expect(third.headers.get("Retry-After")).toBe("10");
    for (const res of running) await res.text();
  });

  it("frees the slot when the export fails before streaming", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    exportStream.mockRejectedValueOnce(new Error("db down"));
    expect((await exportAs()).status).toBe(500);
    const retry = await exportAs();
    expect(retry.status).toBe(200);
    await retry.text();
  });

  it("allows a burst of 5 exports per account in hosted mode, and a refused one does not count", async () => {
    for (let i = 0; i < 5; i++) {
      const res = await exportAs();
      expect(res.status).toBe(200);
      if (i === 0) expect((await exportAs()).status).toBe(409);
      await res.text();
    }
    const res = await exportAs();
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).not.toBeNull();
    expect(exportStream).toHaveBeenCalledTimes(5);
  });

  it("does not limit a self-hosted server", async () => {
    useEnv({ APP_MODE: "selfhost" });
    for (let i = 0; i < 6; i++) {
      const res = await exportAs();
      expect(res.status).toBe(200);
      await res.text();
    }
  });
});
