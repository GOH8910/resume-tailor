import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

const SECRET = "x".repeat(32);

/** A complete production environment; each test removes or overrides what it is about. */
function production(overrides: Record<string, string | undefined> = {}) {
  return {
    NODE_ENV: "production",
    DATABASE_URL: "postgres://localhost/db",
    BETTER_AUTH_SECRET: SECRET,
    BETTER_AUTH_URL: "https://resume.example.com",
    EMAIL_FROM: "Resume Tailor <signin@example.com>",
    RESEND_API_KEY: "re_123",
    ANTHROPIC_API_KEY: "sk-ant-123",
    ...overrides,
  };
}

describe("parseEnv", () => {
  it("accepts a complete production environment", () => {
    const env = parseEnv(production());
    expect(env.DATABASE_URL).toBe("postgres://localhost/db");
    expect(env.EMAIL_TRANSPORT).toBe("resend");
  });

  it.each(["DATABASE_URL", "BETTER_AUTH_SECRET", "RESEND_API_KEY", "ANTHROPIC_API_KEY"])(
    "requires %s in production",
    (key) => {
      expect(() => parseEnv(production({ [key]: undefined }))).toThrow(`${key} must be set in production`);
    },
  );

  it.each(["BETTER_AUTH_URL", "EMAIL_FROM"])("does not let %s fall back to its default in production", (key) => {
    expect(() => parseEnv(production({ [key]: undefined }))).toThrow(`${key} must be set in production`);
  });

  it("requires an https BETTER_AUTH_URL in production", () => {
    expect(() => parseEnv(production({ BETTER_AUTH_URL: "http://resume.example.com" }))).toThrow(
      "BETTER_AUTH_URL must start with https://",
    );
  });

  it("does not require secrets while `next build` runs", () => {
    expect(() => parseEnv({ NODE_ENV: "production", NEXT_PHASE: "phase-production-build" })).not.toThrow();
  });

  it("falls back to defaults in development", () => {
    const env = parseEnv({});
    expect(env.NODE_ENV).toBe("development");
    expect(env.BETTER_AUTH_URL).toBe("http://localhost:3000");
    expect(env.EMAIL_FROM).toBe("Resume Tailor <signin@localhost>");
    expect(env.EMAIL_TRANSPORT).toBe("file");
    expect(env.BETTER_AUTH_SECRET).toBeUndefined();
    expect(env.signupEmails.size).toBe(0);
  });

  it("rejects a BETTER_AUTH_SECRET shorter than 32 characters", () => {
    expect(() => parseEnv({ BETTER_AUTH_SECRET: "0123456789" })).toThrow();
  });

  it.each([
    ["GOOGLE_CLIENT_ID", { GOOGLE_CLIENT_ID: "id" }],
    ["GOOGLE_CLIENT_SECRET", { GOOGLE_CLIENT_SECRET: "secret" }],
  ])("rejects %s without its pair", (_, google) => {
    expect(() => parseEnv(google)).toThrow("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set together");
  });

  it("accepts both Google credentials together", () => {
    const env = parseEnv({ GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret" });
    expect(env.GOOGLE_CLIENT_ID).toBe("id");
  });

  it("rejects an unknown EMAIL_TRANSPORT", () => {
    expect(() => parseEnv({ EMAIL_TRANSPORT: "smtp" })).toThrow();
  });

  it("allows the file transport in production for a local http smoke test, without a Resend key", () => {
    const env = parseEnv(
      production({ EMAIL_TRANSPORT: "file", BETTER_AUTH_URL: "http://localhost:3000", RESEND_API_KEY: undefined }),
    );
    expect(env.EMAIL_TRANSPORT).toBe("file");
  });

  it("refuses the file transport on a public https production URL", () => {
    expect(() => parseEnv(production({ EMAIL_TRANSPORT: "file" }))).toThrow(
      "EMAIL_TRANSPORT=file is only allowed in production with an http:// BETTER_AUTH_URL",
    );
  });

  it("parses SIGNUP_EMAILS into a lowercased, trimmed set", () => {
    const env = parseEnv({ SIGNUP_EMAILS: " Ada@Example.com, bob@example.com ,," });
    expect(env.signupEmails).toEqual(new Set(["ada@example.com", "bob@example.com"]));
  });
});
