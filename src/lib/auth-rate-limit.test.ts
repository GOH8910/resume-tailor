import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { magicLink } from "better-auth/plugins";
import { describe, expect, it } from "vitest";
import { signInRateRules } from "./auth-rate-limit";

describe("signInRateRules", () => {
  it("allows 5 magic-link requests and 20 verifications per IP per hour", () => {
    expect(signInRateRules()).toEqual({
      "/sign-in/magic-link": { window: 3600, max: 5 },
      "/magic-link/verify": { window: 3600, max: 20 },
    });
  });

  // Proves the option shape against the installed Better Auth: a 6th request from one IP within the hour is refused.
  it("makes Better Auth refuse the 6th magic-link request from one IP", async () => {
    const auth = betterAuth({
      baseURL: "http://localhost:3000",
      secret: "test-secret-test-secret-test-secret-0123",
      database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
      advanced: { ipAddress: { ipAddressHeaders: ["fly-client-ip"] } },
      rateLimit: { enabled: true, customRules: signInRateRules() },
      plugins: [magicLink({ sendMagicLink: async () => {} })],
    });
    const request = (ip: string) =>
      auth.handler(
        new Request("http://localhost:3000/api/auth/sign-in/magic-link", {
          method: "POST",
          headers: { "Content-Type": "application/json", "fly-client-ip": ip, Origin: "http://localhost:3000" },
          body: JSON.stringify({ email: "ada@example.com" }),
        }),
      );
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await request("203.0.113.1")).status);
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
    expect((await request("203.0.113.2")).status).toBe(200);
  });
});
