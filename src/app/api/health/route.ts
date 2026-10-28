import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { checkLatexmk, type LatexmkStatus } from "@/latex/latexmk-check";

// GET handlers are not cached by default in this Next config; this states the intent explicitly.
export const dynamic = "force-dynamic";

// Fly's check times out at 5 s; answering within 4 s leaves room for the response itself.
const DB_TIMEOUT_MS = 4_000;

class TimeoutError extends Error {
  name = "TimeoutError";
}

let lastLatexmk: LatexmkStatus = "ok";

/**
 * Public health check: 200 when everything checked is fine, 503 otherwise.
 * By default it is shallow (the process answers and latexmk runs): Fly probes every 30 s, and a query each
 * time would keep a scale-to-zero database awake around the clock. `?deep=1` also queries the database.
 */
export async function GET(request: Request) {
  const deep = new URL(request.url).searchParams.get("deep") === "1";
  const [db, latexmk] = await Promise.all([deep ? checkDb() : undefined, checkLatexmkLogged()]);
  const ok = (db === undefined || db === "ok") && latexmk === "ok";
  const body = db === undefined ? { ok, latexmk } : { ok, db, latexmk };
  return Response.json(body, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}

/** Logs only when latexmk's status changes, so a failing check shows up once instead of every 30 s. */
async function checkLatexmkLogged(): Promise<LatexmkStatus> {
  const status = await checkLatexmk();
  if (status !== lastLatexmk) {
    if (status === "ok") console.info("[health] latexmk check is ok again");
    else console.error(`[health] latexmk check failing: ${status}`);
    lastLatexmk = status;
  }
  return status;
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
