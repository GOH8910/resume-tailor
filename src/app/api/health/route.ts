import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { checkLatexmk } from "@/latex/latexmk-check";

// A GET handler that never reads the request could otherwise be prerendered once at build time.
export const dynamic = "force-dynamic";

// Fly's check times out at 5 s; answering within 4 s leaves room for the response itself.
const DB_TIMEOUT_MS = 4_000;

class TimeoutError extends Error {
  name = "TimeoutError";
}

/** Public liveness check for Fly: 200 when the database answers and latexmk runs, 503 otherwise. */
export async function GET() {
  const [db, latexmk] = await Promise.all([checkDb(), checkLatexmk()]);
  const ok = db === "ok" && latexmk === "ok";
  return Response.json({ ok, db, latexmk }, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}

async function checkDb(): Promise<string> {
  try {
    await withTimeout(
      getDb().then((db) => db.execute(sql`select 1`)),
      DB_TIMEOUT_MS,
    );
    return "ok";
  } catch (err) {
    console.error("[health] database check failed", err);
    return `error: ${shortReason(err)}`;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(`no answer within ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** The response is public: driver messages can carry the connection string, codes and class names cannot. */
function shortReason(err: unknown): string {
  if (err instanceof TimeoutError) return "timeout";
  const cause = err instanceof Error && err.cause instanceof Error ? err.cause : err;
  const code = (cause as { code?: unknown } | null)?.code;
  if (typeof code === "string" && /^[A-Za-z0-9_]{1,40}$/.test(code)) return code;
  return cause instanceof Error ? cause.name : "unknown";
}
