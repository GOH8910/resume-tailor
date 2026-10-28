import { mkdirSync } from "node:fs";
import path from "node:path";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { Pool } from "pg";
import { dataRoot } from "@/lib/data-root";
import { runMigrations } from "./migrate";
import * as schema from "./schema";
import type { Connection, Db } from "./types";

type Entry = { connection: Connection; ready?: Promise<void> };

// Next dev re-evaluates modules on hot reload; the pool/PGlite instance must survive that.
const cache = globalThis as unknown as { __resumeDb?: Entry };

function connectPg(url: string): Connection {
  const pool = new Pool({ connectionString: url, max: 5, connectionTimeoutMillis: 10_000 });
  // Without a listener, an error on an idle client crashes the process.
  pool.on("error", (err) => console.error("[db] idle client error", err));
  return { kind: "pg", db: drizzlePg({ client: pool, schema }) };
}

function connectPglite(): Connection {
  const dataDir = path.join(dataRoot(), "pglite");
  // PGlite only creates the last path segment.
  mkdirSync(dataDir, { recursive: true });
  return { kind: "pglite", db: drizzlePglite({ connection: { dataDir }, schema }) };
}

function init(): Entry {
  const url = process.env.DATABASE_URL;
  cache.__resumeDb ??= { connection: url ? connectPg(url) : connectPglite() };
  return cache.__resumeDb;
}

/** The process-wide database, migrated before it is handed out. A failed migration is retried on the next call. */
export async function getDb(): Promise<Db> {
  const entry = init();
  entry.ready ??= runMigrations(entry.connection).catch((err) => {
    entry.ready = undefined;
    throw err;
  });
  await entry.ready;
  return entry.connection.db;
}

/** For code that needs the instance synchronously (the auth adapter). Does not migrate: boot does that, see instrumentation.ts. */
export function getDbSync(): Db {
  return init().connection.db;
}
