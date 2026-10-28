// Runs once at server boot, before the first request. Better Auth queries through getDbSync(),
// which does not migrate, so the schema has to be in place before any route is hit.
export async function registerNode() {
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  try {
    await import("@/lib/env");
  } catch (err) {
    // A misconfigured release must fail its deploy, not serve errors: unlike a database outage it will not recover.
    console.error("[env] invalid configuration, refusing to start", err);
    return process.exit(1);
  }

  const { getDb } = await import("@/db/client");
  try {
    await getDb();
  } catch (err) {
    // If register throws, Next answers 500 forever; getDb() retries on its next call instead.
    console.error("[db] migration at boot failed, will retry on first use", err);
  }
}
