import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "./errors";
import { handle, requireUser } from "./http";

// The real instance opens the database; these tests only need getSession.
const getSession = vi.hoisted(() => vi.fn());
vi.mock("./auth", () => ({ getAuth: () => ({ api: { getSession } }) }));

afterEach(() => vi.restoreAllMocks());

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

  it("rejects a request without a session with a 401", async () => {
    getSession.mockResolvedValueOnce(null);
    await expect(requireUser(request())).rejects.toMatchObject({ status: 401, message: "Sign in to continue" });
  });

  it("returns the signed-in user, passing the request headers to Better Auth", async () => {
    getSession.mockResolvedValueOnce({
      user: { id: "u1", email: "ada@example.com", name: "Ada", image: null },
      session: { id: "s1" },
    });
    const req = request();
    await expect(requireUser(req)).resolves.toEqual({ id: "u1", email: "ada@example.com", name: "Ada" });
    expect(getSession).toHaveBeenLastCalledWith({ headers: req.headers });
  });
});
