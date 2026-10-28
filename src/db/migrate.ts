import path from "node:path";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import type * as schema from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export type Connection =
  | { kind: "pg"; db: NodePgDatabase<typeof schema> }
  | { kind: "pglite"; db: PgliteDatabase<typeof schema> };

export const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");

export async function runMigrations(connection: Connection): Promise<void> {
  if (connection.kind === "pg") await migratePg(connection.db, { migrationsFolder: MIGRATIONS_FOLDER });
  else await migratePglite(connection.db, { migrationsFolder: MIGRATIONS_FOLDER });
}
