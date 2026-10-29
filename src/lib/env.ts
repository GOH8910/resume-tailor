import { z } from "zod";

// A blank value (`KEY=` in a .env file or a deploy config) means unset; z.coerce.number() would read it as 0.
function blankAsUnset<T extends z.ZodType>(schema: T) {
  return z.preprocess((value) => (typeof value === "string" && value.trim() === "" ? undefined : value), schema);
}

// z.coerce.boolean() would read the string "false" as true.
const flag = z
  .enum(["1", "true", "0", "false", ""])
  .default("")
  .transform((value) => value === "1" || value === "true");

const Schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  NEXT_PHASE: z.string().optional(),
  DATABASE_URL: z.string().optional(),
  BETTER_AUTH_SECRET: z.string().min(32).optional(),
  BETTER_AUTH_URL: z.url().default("http://localhost:3000"),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  EMAIL_TRANSPORT: z.enum(["resend", "file"]).optional(),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("Resume Tailor <signin@localhost>"),
  SIGNUP_EMAILS: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  LATEX_RUN_AS: z.string().optional(),
  COMPILE_ROOT: z.string().optional(),
  APP_MODE: z.enum(["hosted", "selfhost"]).optional(),
  ADMIN_EMAILS: z.string().optional(),
  AD_PROVIDER: z.enum(["none", "test", "google"]).default("none"),
  AD_UNIT_PATH: z.string().optional(),
  AD_SSV_ENABLED: flag,
  AD_SSV_KEYS_URL: blankAsUnset(
    z.url({ protocol: /^https$/ }).default("https://www.gstatic.com/admob/reward/verifier-keys.json"),
  ),
  FREE_MODEL: z.string().trim().min(1).default("claude-haiku-5-5"),
  UNLIMITED_MODEL: z.string().trim().min(1).default("claude-sonnet-5-5"),
  CREDITS_PER_TAILOR: blankAsUnset(z.coerce.number().int().min(0).default(2)),
  CREDITS_PER_CHAT_MESSAGE: blankAsUnset(z.coerce.number().int().min(0).default(1)),
  AD_CREDITS_PER_ACCOUNT_PER_DAY: blankAsUnset(z.coerce.number().int().min(0).default(10)),
  AD_CREDITS_PER_IP_PER_DAY: blankAsUnset(z.coerce.number().int().min(0).default(30)),
  AD_MIN_WATCH_SECONDS: blankAsUnset(z.coerce.number().min(0).default(7)),
  SIGNUP_GRANT_CREDITS: blankAsUnset(z.coerce.number().int().min(0).default(0)),
  FREE_DAILY_BUDGET_GBP: blankAsUnset(z.coerce.number().min(0).default(2)),
  USD_TO_GBP: blankAsUnset(z.coerce.number().positive().default(0.78)),
});

type Source = Record<string, string | undefined>;
type Parsed = z.infer<typeof Schema>;

export type Env = Parsed & {
  EMAIL_TRANSPORT: "resend" | "file";
  /** Who may create an account (lowercased); empty means sign-up is open. */
  signupEmails: Set<string>;
  /** `hosted` runs plans, credits and ads; `selfhost` is a single-operator tool without them. */
  appMode: NonNullable<Parsed["APP_MODE"]>;
  /** Accounts that get the unlimited plan when they sign up (lowercased). */
  adminEmails: Set<string>;
  /** The ad provider in effect: always "none" in selfhost mode. */
  adProvider: Parsed["AD_PROVIDER"];
};

/** Parses the environment; in production (but not during `next build`) it must be complete and explicit. */
export function parseEnv(source: Source): Env {
  const parsed = Schema.parse(source);
  const isProduction = parsed.NODE_ENV === "production";
  const appMode = parsed.APP_MODE ?? (isProduction ? "hosted" : "selfhost");
  const env: Env = {
    ...parsed,
    EMAIL_TRANSPORT: parsed.EMAIL_TRANSPORT ?? (isProduction ? "resend" : "file"),
    signupEmails: parseEmailList(parsed.SIGNUP_EMAILS),
    appMode,
    adminEmails: parseEmailList(parsed.ADMIN_EMAILS),
    adProvider: appMode === "selfhost" ? "none" : parsed.AD_PROVIDER,
  };
  if (Boolean(env.GOOGLE_CLIENT_ID) !== Boolean(env.GOOGLE_CLIENT_SECRET)) {
    throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set together");
  }
  // Without it, compiles happen in the system temp folder, where TeX's output files would not be readable by the server.
  if (env.LATEX_RUN_AS && !env.COMPILE_ROOT) {
    throw new Error(
      "COMPILE_ROOT must be set when LATEX_RUN_AS is set: a folder the server owns, setgid to a group the TeX user is in",
    );
  }
  if (isProduction && env.NEXT_PHASE !== "phase-production-build") checkProduction(source, env);
  return env;
}

// Checked against the raw source, not the parsed values: in production a default would silently point
// sign-in links at localhost or send mail from an unverified address.
function checkProduction(source: Source, env: Env): void {
  const required = ["DATABASE_URL", "BETTER_AUTH_SECRET", "ANTHROPIC_API_KEY", "BETTER_AUTH_URL", "EMAIL_FROM"];
  if (env.EMAIL_TRANSPORT === "resend") required.push("RESEND_API_KEY");
  for (const key of required) {
    if (!source[key]) throw new Error(`${key} must be set in production`);
  }
  if (env.EMAIL_TRANSPORT === "file") {
    // Writing links to disk is only for smoke-testing the production build locally, never a public deployment.
    if (!env.BETTER_AUTH_URL.startsWith("http://")) {
      throw new Error("EMAIL_TRANSPORT=file is only allowed in production with an http:// BETTER_AUTH_URL");
    }
  } else if (!env.BETTER_AUTH_URL.startsWith("https://")) {
    throw new Error("BETTER_AUTH_URL must start with https://");
  }
  // The test provider grants credits for a fake ad, so on a public site it would be free money.
  if (env.AD_PROVIDER === "test") throw new Error("AD_PROVIDER=test is not allowed in production");
  if (env.adProvider === "google" && !env.AD_UNIT_PATH) {
    throw new Error("AD_UNIT_PATH must be set when AD_PROVIDER=google");
  }
}

function parseEmailList(value: string | undefined): Set<string> {
  const emails = (value ?? "").split(",").map((email) => email.trim().toLowerCase());
  return new Set(emails.filter(Boolean));
}

export const env = parseEnv(process.env);
