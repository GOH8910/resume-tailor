import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { runMigrations } from "./migrate";
import * as schema from "./schema";

/** A fresh in-memory Postgres with the migrations applied. ~100 ms per call. */
export async function createTestDb() {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  await runMigrations({ kind: "pglite", db });
  return { db, close: () => client.close() };
}
