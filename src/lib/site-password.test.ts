import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { describe, expect, it, vi } from "vitest";
import { passwordMatches, sitePassword } from "./site-password";

const BASE = "http://localhost:3000";

function createTestAuth(password: string | undefined, onCreate = vi.fn()) {
  const db = { user: [], session: [], account: [], verification: [] };
  const auth = betterAuth({
    baseURL: BASE,
    secret: "test-secret-test-secret-test-secret-0123",
    database: memoryAdapter(db),
    plugins: [sitePassword(password)],
    databaseHooks: { user: { create: { after: onCreate } } },
  });
  return { auth, db };
}

const signIn = (auth: ReturnType<typeof createTestAuth>["auth"], email: string, password: string) =>
  auth.handler(
    new Request(`${BASE}/api/auth/sign-in/site-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: BASE },
      body: JSON.stringify({ email, password }),
    }),
  );

describe("passwordMatches", () => {
  it("matches only the exact password", () => {
    expect(passwordMatches("hunter2", "hunter2")).toBe(true);
    expect(passwordMatches("hunter", "hunter2")).toBe(false);
    expect(passwordMatches("", "hunter2")).toBe(false);
  });
});

describe("sitePassword", () => {
  it("creates an account on first sign-in and sets a session cookie", async () => {
    const onCreate = vi.fn();
    const { auth, db } = createTestAuth("hunter2", onCreate);
    const res = await signIn(auth, "Ada@Example.com", "hunter2");
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("better-auth.session_token=");
    expect(db.user).toHaveLength(1);
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ email: "ada@example.com" }), expect.anything());
  });

  it("signs an existing account back in without creating another", async () => {
    const { auth, db } = createTestAuth("hunter2");
    await signIn(auth, "ada@example.com", "hunter2");
    expect((await signIn(auth, "ada@example.com", "hunter2")).status).toBe(200);
    expect(db.user).toHaveLength(1);
    expect(db.session).toHaveLength(2);
  });

  it("refuses a wrong password and creates nothing", async () => {
    const { auth, db } = createTestAuth("hunter2");
    const res = await signIn(auth, "ada@example.com", "wrong");
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("WRONG_PASSWORD");
    expect(db.user).toHaveLength(0);
  });

  it("refuses every sign-in when no password is configured", async () => {
    const { auth } = createTestAuth(undefined);
    expect((await signIn(auth, "ada@example.com", "")).status).toBe(401);
  });
});
