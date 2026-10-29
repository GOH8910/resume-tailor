import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.hoisted(() => vi.fn());
const signOut = vi.hoisted(() => vi.fn());
const plans = vi.hoisted(() => ({ get: vi.fn() }));
const deleteAccount = vi.hoisted(() => vi.fn());
const db = vi.hoisted(() => ({ name: "the database" }));
vi.mock("@/lib/auth", () => ({ getAuth: () => ({ api: { getSession, signOut } }) }));
vi.mock("@/lib/deps", () => ({ plans }));
vi.mock("@/db/client", () => ({ getDb: async () => db }));
vi.mock("@/account/delete", () => ({ deleteAccount }));

import { POST } from "./route";

const ADA = { user: { id: "u1", email: "ada@example.com", name: "Ada" }, session: { id: "s1" } };
const EXPIRED = [
  "better-auth.session_token=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax",
  "better-auth.session_data=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax",
];

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
  const headers = new Headers();
  for (const cookie of EXPIRED) headers.append("Set-Cookie", cookie);
  signOut.mockResolvedValue({ headers, response: { success: true } });
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
    expect(signOut).not.toHaveBeenCalled();
  });

  it("deletes the signed-in account, matching the email without regard to case or spaces", async () => {
    const res = await deleteAs({ email: "  Ada@Example.COM " });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true });
    expect(deleteAccount).toHaveBeenCalledExactlyOnceWith(db, "u1");
  });

  it("clears the session cookies in the same response, through Better Auth's sign-out", async () => {
    const res = await deleteAs({ email: "ada@example.com" });

    expect(res.headers.getSetCookie()).toEqual(EXPIRED);
    const [{ headers, returnHeaders }] = signOut.mock.calls[0];
    expect(returnHeaders).toBe(true);
    expect(headers.get("cookie")).toBe("better-auth.session_token=abc");
    // The account is deleted first: a failed deletion leaves the user signed in to try again.
    expect(deleteAccount.mock.invocationCallOrder[0]).toBeLessThan(signOut.mock.invocationCallOrder[0]);
  });

  it("still answers 200 when the cookies cannot be cleared, since the account and its sessions are gone", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    signOut.mockRejectedValueOnce(new Error("boom"));

    const res = await deleteAs({ email: "ada@example.com" });

    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie()).toEqual([]);
    expect(log).toHaveBeenCalledOnce();
    expect(JSON.stringify(log.mock.calls)).not.toContain("ada@example.com");
  });

  it("answers a failed deletion with a 500 and leaves the session alone", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    deleteAccount.mockRejectedValueOnce(new Error("deadlock detected"));

    const res = await deleteAs({ email: "ada@example.com" });

    expect(res.status).toBe(500);
    expect(signOut).not.toHaveBeenCalled();
  });
});
