import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type { Application } from "@/applications/schema";
import type { Bank } from "@/bank/schema";
import type { Plan } from "@/billing/plan";
import type { UsageKind } from "@/billing/usage-types";
import type { AdSessionStatus, CreditKind } from "@/credits/types";
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

/** One row per Claude call, costed at list prices. Feeds the free-usage daily budget and the admin page. */
export const usageEvents = pgTable(
  "usage_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Kept when the account is deleted: Anthropic billed the call, so the budget and the history must still count it.
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    kind: text("kind").$type<UsageKind>().notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    costGbp: numeric("cost_gbp", { precision: 10, scale: 6, mode: "number" }).notNull(),
    /** Whether the call was paid for by free credits, so counts against the daily budget. */
    free: boolean("free").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("usage_events_created_at_idx").on(t.createdAt),
    index("usage_events_user_id_created_at_idx").on(t.userId, t.createdAt),
    // Must list USAGE_KINDS (src/billing/usage-types.ts); changing either needs a migration.
    check("usage_events_kind_check", sql`${t.kind} in ('tailor', 'chat', 'seed')`),
  ],
);

/** Operator switches that must survive a restart, one row per key (e.g. `free_paused`). */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

/**
 * Append-only credits ledger: every change to `user_plans.credits` writes one row here in the same transaction,
 * so the balance always equals the sum of an account's rows.
 */
export const creditEvents = pgTable(
  "credit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Kept, anonymised, when the account is deleted: the audit of credits granted for ads must survive it.
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    kind: text("kind").$type<CreditKind>().notNull(),
    /** Signed: positive for credits earned or refunded, negative for credits spent. */
    amount: integer("amount").notNull(),
    /** The ad session, application or charge the row is about. */
    ref: text("ref"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("credit_events_user_id_created_at_idx").on(t.userId, t.createdAt),
    // Must list CREDIT_KINDS (src/credits/types.ts); changing either needs a migration.
    check("credit_events_kind_check", sql`${t.kind} in ('ad', 'signup', 'tailor', 'chat', 'admin', 'refund')`),
  ],
);

/** One row per rewarded ad attempt. The daily caps count the granted rows per account and per IP. */
export const adSessions = pgTable(
  "ad_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Set null rather than cascade, so deleting an account and signing up again does not reset the per-IP cap.
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    // Blanked ('') once older than the per-IP cap needs (AD_IP_RETENTION_MS in src/credits/service.ts).
    ip: text("ip").notNull(),
    provider: text("provider").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true }),
    status: text("status").$type<AdSessionStatus>().notNull().default("started"),
    rejectReason: text("reject_reason"),
    /** The ad network's id for a server-side verified reward; unique so a replayed callback cannot grant twice. */
    transactionId: text("transaction_id").unique(),
  },
  (t) => [
    index("ad_sessions_user_id_started_at_idx").on(t.userId, t.startedAt),
    index("ad_sessions_ip_started_at_idx").on(t.ip, t.startedAt),
    // Finds the rows whose IP is still to be blanked without scanning the ones already done.
    index("ad_sessions_ip_retained_idx").on(t.startedAt).where(sql`${t.ip} <> ''`),
    // Must list AD_SESSION_STATUSES (src/credits/types.ts); changing either needs a migration.
    check("ad_sessions_status_check", sql`${t.status} in ('started', 'granted', 'rejected')`),
  ],
);
