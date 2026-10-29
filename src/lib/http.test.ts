import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "./errors";
import { clientIp, handle, requireUser } from "./http";

// The real instance opens the database; these tests only need getSession.
const getSession = vi.hoisted(() => vi.fn());
const plans = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("./auth", () => ({ getAuth: () => ({ api: { getSession } }) }));
vi.mock("./deps", () => ({ plans }));
vi.mock("./env", () => ({ env: { adminEmails: new Set(["ed@example.com"]) } }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("handle", () => {
  it("answers an unexpected error with a generic 500 that leaks nothing", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = new Error("Failed query: insert into banks ... params: secret");
    const res = await handle(async () => {
      throw err;
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "Something went wrong" });
    expect(JSON.stringify(body)).not.toContain("secret");
    expect(log).toHaveBeenCalledWith(err);
  });

  it("logs the underlying cause of a wrapped error", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const cause = new Error("connect ECONNREFUSED");
    await handle(async () => {
      throw new Error("Failed query: select 1", { cause });
    });
    expect(log).toHaveBeenCalledWith(cause);
  });

  it("passes an AppError's message and status through", async () => {
    const res = await handle(async () => {
      throw new AppError("Application not found", 404);
    });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Application not found");
  });
});

describe("requireUser", () => {
  const request = () => new Request("http://localhost/api/bank", { headers: { cookie: "session=abc" } });

  const session = (email: string) => ({
    user: { id: "u1", email, name: "Ada", image: null },
    session: { id: "s1" },
  });

  it("rejects a request without a session with a 401, reading no plan", async () => {
    getSession.mockResolvedValueOnce(null);
    await expect(requireUser(request())).rejects.toMatchObject({ status: 401, message: "Sign in to continue" });
    expect(plans.get).not.toHaveBeenCalled();
  });

  it("returns the signed-in user and their plan, passing the request headers to Better Auth", async () => {
    getSession.mockResolvedValueOnce(session("ada@example.com"));
    plans.get.mockResolvedValueOnce({ plan: "unlimited", credits: 4 });
    const req = request();
    await expect(requireUser(req)).resolves.toEqual({ id: "u1", email: "ada@example.com", name: "Ada", plan: "unlimited" });
    expect(getSession).toHaveBeenLastCalledWith({ headers: req.headers });
  });

  it("creates a missing plan as free for an ordinary account", async () => {
    getSession.mockResolvedValueOnce(session("ada@example.com"));
    plans.get.mockResolvedValueOnce({ plan: "free", credits: 0 });
    await requireUser(request());
    expect(plans.get).toHaveBeenLastCalledWith("u1", "free");
  });

  it("creates a missing plan as unlimited for an admin account", async () => {
    getSession.mockResolvedValueOnce(session("Ed@Example.com"));
    plans.get.mockResolvedValueOnce({ plan: "unlimited", credits: 0 });
    await requireUser(request());
    expect(plans.get).toHaveBeenLastCalledWith("u1", "unlimited");
  });
});

describe("clientIp", () => {
  const from = (headers: Record<string, string>) => clientIp(new Request("http://localhost/api/ads/start", { headers }));

  it("prefers the address Fly's proxy saw", () => {
    expect(from({ "fly-client-ip": "203.0.113.1", "x-forwarded-for": "198.51.100.7" })).toBe("203.0.113.1");
  });

  it("falls back to the first x-forwarded-for entry", () => {
    expect(from({ "x-forwarded-for": " 198.51.100.7 , 10.0.0.1" })).toBe("198.51.100.7");
  });

  it("is 'unknown' without either header", () => {
    expect(from({})).toBe("unknown");
    expect(from({ "fly-client-ip": " ", "x-forwarded-for": "" })).toBe("unknown");
  });
});
