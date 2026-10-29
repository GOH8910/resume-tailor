import { cookies } from "next/headers";
import { z } from "zod";
import { deleteAccount } from "@/account/delete";
import { getDb } from "@/db/client";
import { getAuth } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { handle, readJson, requireUser } from "@/lib/http";

const Body = z.object({ email: z.string().max(320) });
const MAX_BODY_BYTES = 4_096;

/** Deletes the signed-in account once the user has typed its email, and signs this browser out. */
export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser(request);
    const { email } = Body.parse(await readJson(request, MAX_BODY_BYTES));
    if (email.trim().toLowerCase() !== user.email.toLowerCase()) {
      throw new AppError("The email you typed is not this account's", 400);
    }
    await deleteAccount(await getDb(), user.id);
    await expireSessionCookies();
    return Response.json({ deleted: true });
  });
}

type SameSite = "strict" | "lax" | "none";

/**
 * Drops the session cookies from this browser (the sessions themselves went with the account), using Better Auth's
 * cookie names and attributes. They are set through Next's cookie store, which also holds any cookie Better Auth set
 * earlier in this request (a refreshed session) and writes the response's Set-Cookie headers from it, so these replace
 * those. Expires is in 1970 as well as Max-Age=0: a cookie that passes through the store with a Max-Age it does not
 * understand would otherwise stay in the browser, empty.
 */
async function expireSessionCookies(): Promise<void> {
  try {
    const { authCookies } = await getAuth().$context;
    const jar = await cookies();
    for (const { name, attributes } of [authCookies.sessionToken, authCookies.sessionData, authCookies.dontRememberToken]) {
      jar.set(name, "", {
        path: attributes.path,
        domain: attributes.domain,
        secure: attributes.secure,
        httpOnly: attributes.httpOnly,
        sameSite: attributes.sameSite?.toLowerCase() as SameSite | undefined,
        maxAge: 0,
        expires: new Date(0),
      });
    }
  } catch (err) {
    // A cookie left behind names a session that no longer exists: the next request is simply signed out.
    console.error("[account] deleted an account but could not clear its session cookies", err);
  }
}
