import { ZodError } from "zod";
import { getAuth } from "./auth";
import { AppError } from "./errors";

/** Run a handler and turn thrown errors into JSON responses. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AppError) {
      if (err.status >= 500) console.error(err);
      return Response.json({ error: err.message, details: err.details ?? null }, { status: err.status });
    }
    if (err instanceof ZodError) {
      return Response.json({ error: "Invalid request body", details: err.issues }, { status: 400 });
    }
    // Driver errors carry SQL, bound params and hostnames in their message: log the cause, tell the client nothing.
    console.error(err instanceof Error && err.cause ? err.cause : err);
    return Response.json({ error: "Something went wrong" }, { status: 500 });
  }
}

/** A malformed or empty body is the client's mistake, so it is a 400, not a server error. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new AppError("Request body must be valid JSON", 400);
  }
}

export type CurrentUser = { id: string; email: string; name: string };

/** The signed-in user for an API request, or a 401. */
export async function requireUser(request: Request): Promise<CurrentUser> {
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session) throw new AppError("Sign in to continue", 401);
  return { id: session.user.id, email: session.user.email, name: session.user.name };
}

export function pdfResponse(pdf: Buffer, pages: number, filename: string): Response {
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "X-Page-Count": String(pages),
      "Cache-Control": "no-store",
    },
  });
}
