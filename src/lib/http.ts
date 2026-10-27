import { ZodError } from "zod";
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
    console.error(err);
    const message = err instanceof Error ? err.message : "Unexpected error";
    return Response.json({ error: message }, { status: 500 });
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

export function requireProfile(request: Request): string {
  const slug = new URL(request.url).searchParams.get("profile");
  if (!slug) throw new AppError("Missing ?profile= query parameter", 400);
  return slug;
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
