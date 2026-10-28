import path from "node:path";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { Pool } from "pg";
import { dataRoot } from "@/lib/data-root";
import { type Connection, type Db, runMigrations } from "./migrate";
import * as schema from "./schema";

// Next dev re-evaluates modules on hot reload; the pool/PGlite instance must survive that.
const cache = globalThis as unknown as { __resumeDb?: { connection: Connection; ready: Promise<void> } };

function connect(): Connection {
  const url = process.env.DATABASE_URL;
  if (url) return { kind: "pg", db: drizzlePg({ client: new Pool({ connectionString: url, max: 5 }), schema }) };
  return { kind: "pglite", db: drizzlePglite({ connection: { dataDir: path.join(dataRoot(), "pglite") }, schema }) };
}

function init() {
  if (!cache.__resumeDb) {
    const connection = connect();
    const ready = process.env.MIGRATE_ON_START === "0" ? Promise.resolve() : runMigrations(connection);
    cache.__resumeDb = { connection, ready };
  }
  return cache.__resumeDb;
}

/** The process-wide database, migrated before it is handed out. */
export async function getDb(): Promise<Db> {
  const { connection, ready } = init();
  await ready;
  return connection.db;
}

/** For code that needs the instance synchronously (the auth adapter); migrations may still be running. */
export function getDbSync(): Db {
  return init().connection.db;
}
