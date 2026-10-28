import path from "node:path";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import type { Connection } from "./types";

export const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");

export async function runMigrations(connection: Connection): Promise<void> {
  if (connection.kind === "pg") await migratePg(connection.db, { migrationsFolder: MIGRATIONS_FOLDER });
  else await migratePglite(connection.db, { migrationsFolder: MIGRATIONS_FOLDER });
}
