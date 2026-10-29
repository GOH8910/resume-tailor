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
    const response = Response.json({ deleted: true });
    for (const cookie of await expiredSessionCookies(request)) response.headers.append("Set-Cookie", cookie);
    return response;
  });
}

/**
 * The Set-Cookie headers that drop the session cookies from this browser, from Better Auth's own sign-out (which
 * knows their names and attributes). The sessions themselves went with the account.
 */
async function expiredSessionCookies(request: Request): Promise<string[]> {
  try {
    const { headers } = await getAuth().api.signOut({ headers: request.headers, returnHeaders: true });
    return headers.getSetCookie();
  } catch (err) {
    // A cookie left behind names a session that no longer exists: the next request is simply signed out.
    console.error("[account] deleted an account but could not clear its session cookies", err);
    return [];
  }
}
