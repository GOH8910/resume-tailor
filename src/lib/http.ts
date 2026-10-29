import { isIPv4, isIPv6 } from "node:net";
import { ZodError } from "zod";
import { type Plan, signupPlan } from "@/billing/plan";
import { getAuth } from "./auth";
import { plans } from "./deps";
import { env } from "./env";
import { AppError } from "./errors";

/** Run a handler and turn thrown errors into JSON responses. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AppError) {
      if (err.status >= 500) console.error(err);
      const retryAfter = retryAfterOf(err.details);
      const headers = retryAfter === undefined ? undefined : { "Retry-After": String(retryAfter) };
      return Response.json({ error: err.message, details: err.details ?? null }, { status: err.status, headers });
    }
    if (err instanceof ZodError) {
      return Response.json({ error: "Invalid request body", details: err.issues }, { status: 400 });
    }
    // Driver errors carry SQL, bound params and hostnames in their message: log the cause, tell the client nothing.
    console.error(err instanceof Error && err.cause ? err.cause : err);
    return Response.json({ error: "Something went wrong" }, { status: 500 });
  }
}

function retryAfterOf(details: unknown): number | undefined {
  const value = (details as { retryAfter?: unknown } | null | undefined)?.retryAfter;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.ceil(value) : undefined;
}

export const MAX_BODY_BYTES = 1_000_000;

const tooLarge = (maxBytes: number) => new AppError("Request body too large", 413, { maxBytes });

/**
 * The JSON body, read up to `maxBytes`: a larger one is refused with a 413 as soon as the count passes the
 * limit, whatever content-length claims. A malformed or empty body is the client's mistake, so it is a 400.
 */
export async function readJson(request: Request, maxBytes = MAX_BODY_BYTES): Promise<unknown> {
  if (Number(request.headers.get("content-length")) > maxBytes) throw tooLarge(maxBytes);
  const text = await readText(request, maxBytes);
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError("Request body must be valid JSON", 400);
  }
}

async function readText(request: Request, maxBytes: number): Promise<string> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw tooLarge(maxBytes);
    }
    chunks.push(value);
  }
  // TextDecoder drops a leading byte-order mark, as request.json() did.
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/**
 * The client's address for per-IP caps, bucketed by ipKey. Fly's proxy sets fly-client-ip; the first
 * x-forwarded-for entry is whatever the client sent, so it only stands in where no such proxy runs (local and
 * other hosts).
 */
export function clientIp(request: Request): string {
  const fly = request.headers.get("fly-client-ip")?.trim();
  if (fly) return ipKey(fly);
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded ? ipKey(forwarded) : "unknown";
}

/**
 * The key a per-IP cap counts against. One subscriber usually gets a whole IPv6 /64 and can pick any address in
 * it, so IPv6 addresses count by their first four hextets (`2001:db8:1:2::/64`); IPv4 addresses count as they are,
 * as do IPv4-mapped IPv6 ones. Anything that is not an address is returned unchanged.
 */
export function ipKey(ip: string): string {
  if (isIPv4(ip)) return ip;
  // A zone id ("%eth0") only names the local interface.
  const address = ip.split("%")[0];
  if (!isIPv6(address)) return ip;
  const hextets = expandIPv6(address);
  if (hextets.slice(0, 5).every((h) => h === 0) && hextets[5] === 0xffff) {
    return [hextets[6] >> 8, hextets[6] & 0xff, hextets[7] >> 8, hextets[7] & 0xff].join(".");
  }
  return `${hextets
    .slice(0, 4)
    .map((h) => h.toString(16))
    .join(":")}::/64`;
}

/** The eight 16-bit groups of a valid IPv6 address (isIPv6 has checked it), including an embedded IPv4 tail. */
function expandIPv6(address: string): number[] {
  const groups = (part: string): number[] =>
    part === ""
      ? []
      : part.split(":").flatMap((group) => {
          if (!group.includes(".")) return [Number.parseInt(group, 16)];
          const [a, b, c, d] = group.split(".").map(Number);
          return [(a << 8) | b, (c << 8) | d];
        });
  const [head, tail] = address.split("::");
  if (tail === undefined) return groups(head);
  const left = groups(head);
  const right = groups(tail);
  return [...left, ...Array<number>(8 - left.length - right.length).fill(0), ...right];
}

export type CurrentUser = { id: string; email: string; name: string; plan: Plan };

/** The signed-in user and their plan for an API request, or a 401. */
export async function requireUser(request: Request): Promise<CurrentUser> {
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session) throw new AppError("Sign in to continue", 401);
  const { id, email, name } = session.user;
  // An account from before plans existed gets the plan it would have been given at sign-up.
  const { plan } = await plans.get(id, signupPlan(email, env.adminEmails));
  return { id, email, name, plan };
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
