import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins";
import { getDbSync } from "@/db/client";
import * as schema from "@/db/schema";
import { banks } from "./deps";
import { sendMagicLinkEmail } from "./email";
import { env } from "./env";

function createAuth() {
  return betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    // env.ts refuses to start production without BETTER_AUTH_SECRET, so this fallback only reaches dev and tests.
    secret: env.BETTER_AUTH_SECRET ?? "dev-only-secret-dev-only-secret-dev-only",
    database: drizzleAdapter(getDbSync(), { provider: "pg", schema }),
    socialProviders:
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } }
        : {},
    // nextCookies() must stay last: it sets cookies for the plugins' server-action calls.
    plugins: [magicLink({ sendMagicLink: ({ email, url }) => sendMagicLinkEmail(email, url) }), nextCookies()],
    databaseHooks: {
      user: { create: { after: async (user) => banks.createEmpty(user.id, user.name) } },
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
