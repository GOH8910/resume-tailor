// Runs once at server boot, before the first request. Better Auth queries through getDbSync(),
// which does not migrate, so the schema has to be in place before any route is hit.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const { getDb } = await import("@/db/client");
  await getDb();
}
