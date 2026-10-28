import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
const getDb = vi.hoisted(() => vi.fn());
const checkLatexmk = vi.hoisted(() => vi.fn());
vi.mock("@/db/client", () => ({ getDb }));
vi.mock("@/latex/latexmk-check", () => ({ checkLatexmk }));

import { GET } from "./route";

const SECRET_URL = "postgres://app:hunter2@db.internal:5432/resume";

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  getDb.mockResolvedValue({ execute });
  execute.mockResolvedValue({ rows: [{ "?column?": 1 }] });
  checkLatexmk.mockResolvedValue("ok");
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("GET /api/health", () => {
  it("answers 200 when the database and latexmk are both fine", async () => {
    const res = await GET();

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true, db: "ok", latexmk: "ok" });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("answers 503 with the error code, never the message, when the database is unreachable", async () => {
    getDb.mockRejectedValueOnce(Object.assign(new Error(`connect ECONNREFUSED ${SECRET_URL}`), { code: "ECONNREFUSED" }));

    const res = await GET();
    const text = await res.text();

    expect(res.status).toBe(503);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(JSON.parse(text)).toEqual({ ok: false, db: "error: ECONNREFUSED", latexmk: "ok" });
    expect(text).not.toContain("hunter2");
  });

  it("reports the driver's code when the query error wraps it", async () => {
    const cause = Object.assign(new Error(`password authentication failed for ${SECRET_URL}`), { code: "28P01" });
    execute.mockRejectedValueOnce(new Error("Failed query: select 1", { cause }));

    const res = await GET();

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, db: "error: 28P01" });
  });

  it("falls back to the error's class name when there is no code", async () => {
    execute.mockRejectedValueOnce(new TypeError(`bad ${SECRET_URL}`));

    expect(await (await GET()).json()).toMatchObject({ ok: false, db: "error: TypeError" });
  });

  it("gives up on a hanging database after 4 seconds", async () => {
    vi.useFakeTimers();
    execute.mockReturnValueOnce(new Promise(() => {}));

    const pending = GET();
    await vi.advanceTimersByTimeAsync(4_000);
    const res = await pending;

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, db: "error: timeout", latexmk: "ok" });
  });

  it("answers 503 when latexmk is missing", async () => {
    checkLatexmk.mockResolvedValueOnce("missing");

    const res = await GET();

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, db: "ok", latexmk: "missing" });
  });
});
