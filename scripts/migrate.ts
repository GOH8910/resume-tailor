/**
 * Apply database migrations (DATABASE_URL, or the local PGlite under data/pglite when unset).
 *   npm run db:migrate
 */
import { getDb } from "@/db/client";

async function main() {
  await getDb();
  console.log("migrations applied");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
