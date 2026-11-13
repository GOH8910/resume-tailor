import { createHash, timingSafeEqual } from "node:crypto";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import * as z from "zod";

/** Compares hashes so the comparison takes the same time whatever the guess's length. */
export function passwordMatches(guess: string, expected: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(guess), digest(expected));
}

/**
 * Sign-in with one password shared by everyone: whoever knows it signs in as any email they type, and a new email
 * gets a new account. There is no proof the email is theirs, so anyone with the password can open anyone's account.
 * Chosen on purpose for a small private group, to avoid needing a verified email domain.
 */
export function sitePassword(password: string | undefined) {
  return {
    id: "site-password",
    endpoints: {
      signInSitePassword: createAuthEndpoint(
        "/sign-in/site-password",
        { method: "POST", body: z.object({ email: z.email(), password: z.string() }) },
        async (ctx) => {
          if (!password || !passwordMatches(ctx.body.password, password)) {
            throw new APIError("UNAUTHORIZED", { code: "WRONG_PASSWORD", message: "Wrong password" });
          }
          const email = ctx.body.email.toLowerCase();
          const adapter = ctx.context.internalAdapter;
          // createUser runs the user.create database hooks, so a new account gets its bank, plan and credits.
          const user =
            (await adapter.findUserByEmail(email))?.user ??
            (await adapter.createUser({ email, emailVerified: true, name: "" }, { method: "site-password" }));
          const session = await adapter.createSession(user.id);
          await setSessionCookie(ctx, { session, user });
          return ctx.json({ ok: true });
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}
