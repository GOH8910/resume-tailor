import { z } from "zod";

const Schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  NEXT_PHASE: z.string().optional(),
  DATABASE_URL: z.string().optional(),
  BETTER_AUTH_SECRET: z.string().min(32).optional(),
  BETTER_AUTH_URL: z.url().default("http://localhost:3000"),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("Resume Tailor <signin@localhost>"),
  ANTHROPIC_API_KEY: z.string().optional(),
});

export type Env = z.infer<typeof Schema>;

/** Parses the environment; in production (but not during `next build`) the secrets must be present. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const parsed = Schema.parse(source);
  if (parsed.NODE_ENV === "production" && parsed.NEXT_PHASE !== "phase-production-build") {
    for (const key of ["DATABASE_URL", "BETTER_AUTH_SECRET", "RESEND_API_KEY", "ANTHROPIC_API_KEY"] as const) {
      if (!parsed[key]) throw new Error(`${key} must be set in production`);
    }
  }
  return parsed;
}

export const env = parseEnv(process.env);
