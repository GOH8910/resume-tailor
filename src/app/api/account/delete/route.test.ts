import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.hoisted(() => vi.fn());
const authContext = vi.hoisted(() => ({ current: Promise.resolve({}) as Promise<unknown> }));
const jar = vi.hoisted(() => ({ set: vi.fn() }));
const plans = vi.hoisted(() => ({ get: vi.fn() }));
const deleteAccount = vi.hoisted(() => vi.fn());
const db = vi.hoisted(() => ({ name: "the database" }));
vi.mock("@/lib/auth", () => ({
  getAuth: () => ({
    api: { getSession },
    get $context() {
      return authContext.current;
    },
  }),
}));
vi.mock("next/headers", () => ({ cookies: async () => jar }));
vi.mock("@/lib/deps", () => ({ plans }));
vi.mock("@/db/client", () => ({ getDb: async () => db }));
vi.mock("@/account/delete", () => ({ deleteAccount }));

import { POST } from "./route";

const ADA = { user: { id: "u1", email: "ada@example.com", name: "Ada" }, session: { id: "s1" } };
const attributes = { path: "/", secure: true, httpOnly: true, sameSite: "Lax" as const };
const AUTH_COOKIES = {
  sessionToken: { name: "__Secure-better-auth.session_token", attributes },
  sessionData: { name: "__Secure-better-auth.session_data", attributes },
  accountData: { name: "__Secure-better-auth.account_data", attributes },
  dontRememberToken: { name: "__Secure-better-auth.dont_remember", attributes: { ...attributes, domain: "example.com" } },
};

function deleteAs(body: unknown, session: unknown = ADA) {
  getSession.mockResolvedValueOnce(session);
  return POST(
    new Request("http://localhost/api/account/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: "better-auth.session_token=abc" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  plans.get.mockResolvedValue({ plan: "free", credits: 0 });
  authContext.current = Promise.resolve({ authCookies: AUTH_COOKIES });
});
afterEach(() => vi.restoreAllMocks());

describe("POST /api/account/delete", () => {
  it("answers 401 without a session", async () => {
    const res = await deleteAs({ email: "ada@example.com" }, null);
    expect(res.status).toBe(401);
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it("refuses with a 400 unless the email typed is the account's", async () => {
    const res = await deleteAs({ email: "bob@example.com" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("The email you typed is not this account's");
    expect((await deleteAs({})).status).toBe(400);
    expect((await deleteAs({ email: 42 })).status).toBe(400);
    expect(deleteAccount).not.toHaveBeenCalled();
    expect(jar.set).not.toHaveBeenCalled();
  });

  it("deletes the signed-in account, matching the email without regard to case or spaces", async () => {
    const res = await deleteAs({ email: "  Ada@Example.COM " });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true });
    expect(deleteAccount).toHaveBeenCalledExactlyOnceWith(db, "u1");
  });

  it("expires the session cookies in Next's cookie store, with an Expires date in the past", async () => {
    await deleteAs({ email: "ada@example.com" });

    const expired = { maxAge: 0, expires: new Date(0), path: "/", secure: true, httpOnly: true, sameSite: "lax" };
    expect(jar.set.mock.calls).toEqual([
      ["__Secure-better-auth.session_token", "", expired],
      ["__Secure-better-auth.session_data", "", expired],
      ["__Secure-better-auth.dont_remember", "", { ...expired, domain: "example.com" }],
    ]);
    // The account is deleted first: a failed deletion leaves the user signed in to try again.
    expect(deleteAccount.mock.invocationCallOrder[0]).toBeLessThan(jar.set.mock.invocationCallOrder[0]);
  });

  it("still answers 200 when the cookies cannot be cleared, since the account and its sessions are gone", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    authContext.current = Promise.reject(new Error("boom"));

    const res = await deleteAs({ email: "ada@example.com" });

    expect(res.status).toBe(200);
    expect(jar.set).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledOnce();
    expect(JSON.stringify(log.mock.calls)).not.toContain("ada@example.com");
  });

  it("answers a failed deletion with a 500 and leaves the session alone", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    deleteAccount.mockRejectedValueOnce(new Error("deadlock detected"));

    const res = await deleteAs({ email: "ada@example.com" });

    expect(res.status).toBe(500);
    expect(jar.set).not.toHaveBeenCalled();
  });
});
