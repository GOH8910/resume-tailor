import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins";
import { getDbSync } from "@/db/client";
import * as schema from "@/db/schema";
import { banks } from "./deps";
import { sendMagicLinkEmail } from "./email";
import { env } from "./env";
import { checkMagicLinkLimit } from "./magic-link-limit";

const DEV_SECRET = "dev-only-secret-dev-only-secret-dev-only";

/** Private beta: with SIGNUP_EMAILS set, only those addresses may create an account (Google or magic link). */
export function checkSignupAllowed(email: string, allowed: Set<string>): void {
  if (allowed.size === 0 || allowed.has(email.toLowerCase())) return;
  // The code lets the magic-link verify endpoint redirect with ?error= instead of answering raw JSON.
  throw new APIError("FORBIDDEN", { code: "SIGNUP_INVITE_ONLY", message: "Sign-ups are invite-only right now" });
}

function createAuth() {
  return betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    // No fallback in production: env.ts requires the secret there, and Better Auth's own check backs that up.
    secret: env.NODE_ENV === "production" ? env.BETTER_AUTH_SECRET : (env.BETTER_AUTH_SECRET ?? DEV_SECRET),
    database: drizzleAdapter(getDbSync(), { provider: "pg", schema }),
    // Fly's proxy puts the real client IP in fly-client-ip; the rate limiter keys on it.
    advanced: { ipAddress: { ipAddressHeaders: ["fly-client-ip", "x-forwarded-for"] } },
    socialProviders:
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } }
        : {},
    plugins: [
      magicLink({
        sendMagicLink: ({ email, url }) => {
          checkMagicLinkLimit(email);
          return sendMagicLinkEmail(email, url);
        },
      }),
      // nextCookies() must stay last: it sets cookies for the plugins' server-action calls.
      nextCookies(),
    ],
    databaseHooks: {
      user: {
        create: {
          before: async (user) => checkSignupAllowed(user.email, env.signupEmails),
          after: async (user) => banks.createEmpty(user.id, user.name),
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

let instance: Auth | undefined;

/**
 * The Better Auth instance, built on first use rather than at import. Building it opens the database, and Next
 * imports route modules in short-lived worker processes (`next build` page-data workers, the `next dev`
 * static-paths worker); a second process opening data/pglite corrupts it.
 */
export function getAuth(): Auth {
  instance ??= createAuth();
  return instance;
}
