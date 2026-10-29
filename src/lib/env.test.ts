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

  it("requires COMPILE_ROOT when LATEX_RUN_AS is set", () => {
    expect(() => parseEnv(production({ LATEX_RUN_AS: "tex" }))).toThrow(
      "COMPILE_ROOT must be set when LATEX_RUN_AS is set",
    );
  });

  it("checks the LATEX_RUN_AS and COMPILE_ROOT pairing outside production too", () => {
    expect(() => parseEnv({ LATEX_RUN_AS: "tex" })).toThrow("COMPILE_ROOT must be set when LATEX_RUN_AS is set");
  });

  it("accepts LATEX_RUN_AS together with COMPILE_ROOT", () => {
    const env = parseEnv(production({ LATEX_RUN_AS: "tex", COMPILE_ROOT: "/var/lib/compile" }));
    expect(env.LATEX_RUN_AS).toBe("tex");
    expect(env.COMPILE_ROOT).toBe("/var/lib/compile");
  });

  it("accepts COMPILE_ROOT on its own", () => {
    expect(() => parseEnv(production({ COMPILE_ROOT: "/var/lib/compile" }))).not.toThrow();
  });

  it("takes LATEX_RUN_AS as a user-name prefix, refusing anything that could not start a user name", () => {
    expect(() => parseEnv({ LATEX_RUN_AS: "tex", COMPILE_ROOT: "/c" })).not.toThrow();
    for (const bad of ["Tex", "1tex", "tex user", "tex;id", "../tex"]) {
      expect(() => parseEnv({ LATEX_RUN_AS: bad, COMPILE_ROOT: "/c" })).toThrow("LATEX_RUN_AS must be a user-name prefix");
    }
    expect(parseEnv({ LATEX_RUN_AS: "" }).LATEX_RUN_AS).toBeUndefined();
  });

  it("reads COMPILE_CONCURRENCY as a whole number of at least 1, default 2", () => {
    expect(parseEnv({}).COMPILE_CONCURRENCY).toBe(2);
    expect(parseEnv({ COMPILE_CONCURRENCY: "" }).COMPILE_CONCURRENCY).toBe(2);
    expect(parseEnv({ COMPILE_CONCURRENCY: "3" }).COMPILE_CONCURRENCY).toBe(3);
    for (const bad of ["0", "-1", "1.5", "abc"]) expect(() => parseEnv({ COMPILE_CONCURRENCY: bad })).toThrow();
  });

  it("parses SIGNUP_EMAILS into a lowercased, trimmed set", () => {
    const env = parseEnv({ SIGNUP_EMAILS: " Ada@Example.com, bob@example.com ,," });
    expect(env.signupEmails).toEqual(new Set(["ada@example.com", "bob@example.com"]));
  });
});

describe("parseEnv: modes, plans and credits", () => {
  it("resolves APP_MODE to hosted in production and selfhost elsewhere", () => {
    expect(parseEnv(production()).appMode).toBe("hosted");
    expect(parseEnv({}).appMode).toBe("selfhost");
    expect(parseEnv({ NODE_ENV: "test" }).appMode).toBe("selfhost");
  });

  it("honours an explicit APP_MODE", () => {
    expect(parseEnv(production({ APP_MODE: "selfhost" })).appMode).toBe("selfhost");
    expect(parseEnv({ APP_MODE: "hosted" }).appMode).toBe("hosted");
  });

  it("rejects an unknown APP_MODE", () => {
    expect(() => parseEnv({ APP_MODE: "saas" })).toThrow();
  });

  it("parses ADMIN_EMAILS into a lowercased, trimmed set", () => {
    expect(parseEnv({ ADMIN_EMAILS: " Ed@Example.com, ,ops@example.com" }).adminEmails).toEqual(
      new Set(["ed@example.com", "ops@example.com"]),
    );
    expect(parseEnv({}).adminEmails.size).toBe(0);
  });

  it("defaults the ad provider to none", () => {
    expect(parseEnv({ APP_MODE: "hosted" }).adProvider).toBe("none");
  });

  it("keeps the configured ad provider in hosted mode", () => {
    expect(parseEnv({ APP_MODE: "hosted", AD_PROVIDER: "test" }).adProvider).toBe("test");
    const google = parseEnv(production({ AD_PROVIDER: "google", AD_UNIT_PATH: "/123/rewarded" }));
    expect(google.adProvider).toBe("google");
    expect(google.AD_UNIT_PATH).toBe("/123/rewarded");
  });

  it("forces the ad provider to none in selfhost mode", () => {
    expect(parseEnv({ APP_MODE: "selfhost", AD_PROVIDER: "test" }).adProvider).toBe("none");
    expect(parseEnv(production({ APP_MODE: "selfhost", AD_PROVIDER: "google" })).adProvider).toBe("none");
  });

  it("rejects an unknown AD_PROVIDER", () => {
    expect(() => parseEnv({ AD_PROVIDER: "adsense" })).toThrow();
  });

  it("refuses the test ad provider in production", () => {
    expect(() => parseEnv(production({ AD_PROVIDER: "test" }))).toThrow("AD_PROVIDER=test is not allowed in production");
  });

  it("requires AD_UNIT_PATH for the Google ad provider in hosted production", () => {
    expect(() => parseEnv(production({ AD_PROVIDER: "google" }))).toThrow(
      "AD_UNIT_PATH must be set when AD_PROVIDER=google",
    );
  });

  it("does not require AD_UNIT_PATH while `next build` runs", () => {
    expect(() =>
      parseEnv({ NODE_ENV: "production", NEXT_PHASE: "phase-production-build", AD_PROVIDER: "google" }),
    ).not.toThrow();
  });

  it.each([
    ["1", true],
    ["true", true],
    ["0", false],
    ["false", false],
    ["", false],
    [undefined, false],
  ])("reads AD_SSV_ENABLED=%j as %s", (value, expected) => {
    expect(parseEnv({ AD_SSV_ENABLED: value }).AD_SSV_ENABLED).toBe(expected);
  });

  it("rejects an AD_SSV_ENABLED that is not a recognised boolean", () => {
    expect(() => parseEnv({ AD_SSV_ENABLED: "yes please" })).toThrow();
  });

  it("defaults the SSV keys URL to Google's published verifier keys, and reads a blank one as unset", () => {
    const google = "https://www.gstatic.com/admob/reward/verifier-keys.json";
    expect(parseEnv({}).AD_SSV_KEYS_URL).toBe(google);
    expect(parseEnv({ AD_SSV_KEYS_URL: " " }).AD_SSV_KEYS_URL).toBe(google);
    expect(parseEnv({ AD_SSV_KEYS_URL: "https://keys.example/k.json" }).AD_SSV_KEYS_URL).toBe("https://keys.example/k.json");
  });

  // Whoever controls the key list can sign their own reward callbacks.
  it.each(["http://keys.example/k.json", "not a url"])("rejects AD_SSV_KEYS_URL=%s", (value) => {
    expect(() => parseEnv({ AD_SSV_KEYS_URL: value })).toThrow();
  });

  it("falls back to the documented credit, limit, budget and model defaults", () => {
    const env = parseEnv({});
    expect(env).toMatchObject({
      FREE_MODEL: "claude-haiku-5-5",
      UNLIMITED_MODEL: "claude-sonnet-5-5",
      CREDITS_PER_TAILOR: 2,
      CREDITS_PER_CHAT_MESSAGE: 1,
      AD_CREDITS_PER_ACCOUNT_PER_DAY: 10,
      AD_CREDITS_PER_IP_PER_DAY: 30,
      AD_MIN_WATCH_SECONDS: 7,
      SIGNUP_GRANT_CREDITS: 0,
      FREE_DAILY_BUDGET_GBP: 2,
      USD_TO_GBP: 0.78,
      AD_SSV_ENABLED: false,
    });
  });

  it("reads numeric settings from strings", () => {
    const env = parseEnv({
      CREDITS_PER_TAILOR: "3",
      CREDITS_PER_CHAT_MESSAGE: "0",
      AD_CREDITS_PER_ACCOUNT_PER_DAY: "5",
      AD_CREDITS_PER_IP_PER_DAY: "12",
      AD_MIN_WATCH_SECONDS: "7.5",
      SIGNUP_GRANT_CREDITS: "4",
      FREE_DAILY_BUDGET_GBP: "1.5",
      USD_TO_GBP: "0.8",
    });
    expect(env).toMatchObject({
      CREDITS_PER_TAILOR: 3,
      CREDITS_PER_CHAT_MESSAGE: 0,
      AD_CREDITS_PER_ACCOUNT_PER_DAY: 5,
      AD_CREDITS_PER_IP_PER_DAY: 12,
      AD_MIN_WATCH_SECONDS: 7.5,
      SIGNUP_GRANT_CREDITS: 4,
      FREE_DAILY_BUDGET_GBP: 1.5,
      USD_TO_GBP: 0.8,
    });
  });

  it.each([
    ["CREDITS_PER_TAILOR", "-1"],
    ["CREDITS_PER_TAILOR", "1.5"],
    ["SIGNUP_GRANT_CREDITS", "two"],
    ["AD_MIN_WATCH_SECONDS", "-3"],
    ["FREE_DAILY_BUDGET_GBP", "-0.01"],
    ["USD_TO_GBP", "0"],
  ])("rejects %s=%s", (key, value) => {
    expect(() => parseEnv({ [key]: value })).toThrow();
  });

  it("accepts other model ids for the free and unlimited plans", () => {
    const env = parseEnv({ FREE_MODEL: "claude-sonnet-5-5", UNLIMITED_MODEL: "claude-opus-5-5" });
    expect(env.FREE_MODEL).toBe("claude-sonnet-5-5");
    expect(env.UNLIMITED_MODEL).toBe("claude-opus-5-5");
  });

  it.each([
    ["CREDITS_PER_TAILOR", 2],
    ["CREDITS_PER_CHAT_MESSAGE", 1],
    ["AD_CREDITS_PER_ACCOUNT_PER_DAY", 10],
    ["AD_CREDITS_PER_IP_PER_DAY", 30],
    ["AD_MIN_WATCH_SECONDS", 7],
    ["SIGNUP_GRANT_CREDITS", 0],
    ["FREE_DAILY_BUDGET_GBP", 2],
    ["USD_TO_GBP", 0.78],
  ])("reads a blank %s as unset, falling back to %s rather than 0", (key, fallback) => {
    expect(parseEnv({ [key]: "" })).toMatchObject({ [key]: fallback });
    expect(parseEnv({ [key]: "  " })).toMatchObject({ [key]: fallback });
  });

  it.each(["FREE_MODEL", "UNLIMITED_MODEL"])("rejects a blank %s", (key) => {
    expect(() => parseEnv({ [key]: "" })).toThrow();
    expect(() => parseEnv({ [key]: "   " })).toThrow();
  });

  it("trims the model ids", () => {
    expect(parseEnv({ FREE_MODEL: " claude-haiku-5-5 " }).FREE_MODEL).toBe("claude-haiku-5-5");
  });
});

describe("parseEnv: privacy contact", () => {
  it("defaults the privacy contact to the address in EMAIL_FROM", () => {
    expect(parseEnv({ EMAIL_FROM: "Resume Tailor <signin@example.com>" }).privacyContactEmail).toBe("signin@example.com");
    expect(parseEnv({ EMAIL_FROM: "signin@example.com" }).privacyContactEmail).toBe("signin@example.com");
    expect(parseEnv({}).privacyContactEmail).toBe("signin@localhost");
  });

  it("uses PRIVACY_CONTACT_EMAIL when set, and reads a blank one as unset", () => {
    const from = { EMAIL_FROM: "Resume Tailor <signin@example.com>" };
    expect(parseEnv({ ...from, PRIVACY_CONTACT_EMAIL: "privacy@example.com" }).privacyContactEmail).toBe("privacy@example.com");
    expect(parseEnv({ ...from, PRIVACY_CONTACT_EMAIL: " " }).privacyContactEmail).toBe("signin@example.com");
  });

  it("rejects a PRIVACY_CONTACT_EMAIL that is not an email address", () => {
    expect(() => parseEnv({ PRIVACY_CONTACT_EMAIL: "Privacy <privacy@example.com>" })).toThrow();
  });
});
