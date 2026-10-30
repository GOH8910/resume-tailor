import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { magicLink } from "better-auth/plugins";
import { afterEach, describe, expect, it, vi } from "vitest";
import { signInRateRules } from "./auth-rate-limit";

const BASE = "http://localhost:3000";

/** A Better Auth instance shaped like ours, with rate limiting on (it is off outside production by default). */
function createTestAuth() {
  return betterAuth({
    baseURL: BASE,
    secret: "test-secret-test-secret-test-secret-0123",
    database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
    advanced: { ipAddress: { ipAddressHeaders: ["fly-client-ip"] } },
    rateLimit: { enabled: true, customRules: signInRateRules() },
    plugins: [magicLink({ sendMagicLink: async () => {} })],
  });
}

type TestAuth = ReturnType<typeof createTestAuth>;

const requestLink = (auth: TestAuth, ip: string) =>
  auth.handler(
    new Request(`${BASE}/api/auth/sign-in/magic-link`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "fly-client-ip": ip, Origin: BASE },
      body: JSON.stringify({ email: "ada@example.com" }),
    }),
  );

const openLink = (auth: TestAuth, ip: string) =>
  auth.handler(new Request(`${BASE}/api/auth/magic-link/verify?token=not-a-real-token`, { headers: { "fly-client-ip": ip } }));

afterEach(() => {
  vi.useRealTimers();
});

describe("signInRateRules", () => {
  it("allows 5 magic-link requests and 20 verifications per IP per hour", () => {
    expect(signInRateRules()).toEqual({
      "/sign-in/magic-link": { window: 3600, max: 5 },
      "/magic-link/verify": { window: 3600, max: 20 },
    });
  });

  // The magic-link plugin's own rule is 5 a minute: a 6th request 61 s later passes under it, and fails under ours.
  it("makes Better Auth refuse a 6th magic-link request from one IP within the hour, not just the minute", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-29T12:00:00Z"));
    const auth = createTestAuth();
    for (let i = 0; i < 5; i++) expect((await requestLink(auth, "203.0.113.1")).status).toBe(200);
    vi.setSystemTime(new Date("2026-10-29T12:01:01Z"));
    expect((await requestLink(auth, "203.0.113.1")).status).toBe(429);
    expect((await requestLink(auth, "203.0.113.2")).status).toBe(200);
  });

  // Under the plugin's rule the 6th would already be refused.
  it("lets one IP open 20 sign-in links an hour, then refuses", async () => {
    const auth = createTestAuth();
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) statuses.push((await openLink(auth, "203.0.113.3")).status);
    expect(statuses.slice(0, 20).every((status) => status !== 429)).toBe(true);
    expect(statuses[20]).toBe(429);
  });
});
