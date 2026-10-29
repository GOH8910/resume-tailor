// Runs once at server boot, before the first request. Better Auth queries through getDbSync(),
// which does not migrate, so the schema has to be in place before any route is hit.
const MIGRATION_RETRY_MS = 30_000;

export async function registerNode() {
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  let env: (typeof import("@/lib/env"))["env"];
  try {
    ({ env } = await import("@/lib/env"));
  } catch (err) {
    // A misconfigured release must fail its deploy, not serve errors: unlike a database outage it will not recover.
    console.error("[env] invalid configuration, refusing to start", err);
    return process.exit(1);
  }
  // Not fatal: an unpriced model is still costed, at the most expensive price.
  const { warnUnpricedModels } = await import("@/billing/costs");
  warnUnpricedModels([env.FREE_MODEL, env.UNLIMITED_MODEL]);

  const { getDb } = await import("@/db/client");
  try {
    await getDb();
  } catch (err) {
    // If register throws, Next answers 500 forever. Keep serving, and keep migrating in the background: otherwise a
    // fresh database that was briefly unreachable at boot stays unmigrated until some route happens to call getDb().
    console.error(`[db] migration at boot failed, retrying every ${MIGRATION_RETRY_MS / 1000} s`, err);
    retryMigration(getDb);
  }
}

function retryMigration(getDb: () => Promise<unknown>): void {
  setTimeout(async () => {
    try {
      await getDb();
      console.info("[db] migration succeeded on retry");
    } catch (err) {
      console.error(`[db] migration retry failed, next attempt in ${MIGRATION_RETRY_MS / 1000} s`, err);
      retryMigration(getDb);
    }
  }, MIGRATION_RETRY_MS);
}
