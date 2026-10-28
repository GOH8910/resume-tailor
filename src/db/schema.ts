import { customType, integer, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import type { Application } from "@/applications/schema";
import type { Bank } from "@/bank/schema";
import { user } from "./auth-schema";

export * from "./auth-schema";

/** Postgres bytea as a Node Buffer; drizzle has no first-class bytea in this version. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const banks = pgTable("banks", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  data: jsonb("data").$type<Bank>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const applications = pgTable(
  "applications",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    data: jsonb("data").$type<Application>().notNull(),
    pdf: bytea("pdf"),
    pdfPages: integer("pdf_pages"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.id] })],
);
