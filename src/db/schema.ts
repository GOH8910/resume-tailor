import { sql } from "drizzle-orm";
import { check, customType, integer, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import type { Application } from "@/applications/schema";
import type { Bank } from "@/bank/schema";
import type { Plan } from "@/billing/plan";
import { user } from "./auth-schema";

export * from "./auth-schema";

/**
 * Postgres bytea as a Node Buffer; drizzle has no first-class bytea in this version.
 * `pg` already returns a Buffer, PGlite returns a plain Uint8Array.
 */
const bytea = customType<{ data: Buffer; driverData: Uint8Array }>({
  dataType() {
    return "bytea";
  },
  fromDriver(value) {
    return Buffer.isBuffer(value) ? value : Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  },
});

export const banks = pgTable("banks", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  data: jsonb("data").$type<Bank>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
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
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.id] })],
);

/** One row per account: its plan and cached credit balance. */
export const userPlans = pgTable(
  "user_plans",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    plan: text("plan").$type<Plan>().notNull().default("free"),
    credits: integer("credits").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  // Keeps the Plan type honest for rows written outside the app (a manual upgrade in psql), and makes an
  // overdrawing charge fail in the database rather than leave a negative balance.
  (t) => [
    check("user_plans_plan_check", sql`${t.plan} in ('free', 'unlimited')`),
    check("user_plans_credits_check", sql`${t.credits} >= 0`),
  ],
);
