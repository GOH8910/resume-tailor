import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

const SECRET = "x".repeat(32);

describe("parseEnv", () => {
  it("requires the secrets in production, naming the missing one", () => {
    expect(() =>
      parseEnv({
        NODE_ENV: "production",
        BETTER_AUTH_SECRET: SECRET,
        RESEND_API_KEY: "re_123",
        ANTHROPIC_API_KEY: "sk-ant-123",
      }),
    ).toThrow("DATABASE_URL must be set in production");
  });

  it("accepts a production environment with every secret present", () => {
    const env = parseEnv({
      NODE_ENV: "production",
      DATABASE_URL: "postgres://localhost/db",
      BETTER_AUTH_SECRET: SECRET,
      RESEND_API_KEY: "re_123",
      ANTHROPIC_API_KEY: "sk-ant-123",
    });
    expect(env.DATABASE_URL).toBe("postgres://localhost/db");
  });

  it("does not require secrets while `next build` runs", () => {
    expect(() => parseEnv({ NODE_ENV: "production", NEXT_PHASE: "phase-production-build" })).not.toThrow();
  });

  it("falls back to defaults in development", () => {
    const env = parseEnv({});
    expect(env.NODE_ENV).toBe("development");
    expect(env.BETTER_AUTH_URL).toBe("http://localhost:3000");
    expect(env.EMAIL_FROM).toBe("Resume Tailor <signin@localhost>");
    expect(env.BETTER_AUTH_SECRET).toBeUndefined();
  });

  it("rejects a BETTER_AUTH_SECRET shorter than 32 characters", () => {
    expect(() => parseEnv({ BETTER_AUTH_SECRET: "0123456789" })).toThrow();
  });
});
