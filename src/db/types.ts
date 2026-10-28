import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import type * as schema from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export type Connection =
  | { kind: "pg"; db: NodePgDatabase<typeof schema> }
  | { kind: "pglite"; db: PgliteDatabase<typeof schema> };
