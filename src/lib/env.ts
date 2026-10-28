import { z } from "zod";

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
});

type Source = Record<string, string | undefined>;

export type Env = z.infer<typeof Schema> & {
  EMAIL_TRANSPORT: "resend" | "file";
  /** Who may create an account (lowercased); empty means sign-up is open. */
  signupEmails: Set<string>;
};

/** Parses the environment; in production (but not during `next build`) it must be complete and explicit. */
export function parseEnv(source: Source): Env {
  const parsed = Schema.parse(source);
  const isProduction = parsed.NODE_ENV === "production";
  const env: Env = {
    ...parsed,
    EMAIL_TRANSPORT: parsed.EMAIL_TRANSPORT ?? (isProduction ? "resend" : "file"),
    signupEmails: parseEmailList(parsed.SIGNUP_EMAILS),
  };
  if (Boolean(env.GOOGLE_CLIENT_ID) !== Boolean(env.GOOGLE_CLIENT_SECRET)) {
    throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set together");
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
}

function parseEmailList(value: string | undefined): Set<string> {
  const emails = (value ?? "").split(",").map((email) => email.trim().toLowerCase());
  return new Set(emails.filter(Boolean));
}

export const env = parseEnv(process.env);
