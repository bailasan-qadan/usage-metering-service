import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const plans = pgTable(
  "plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: varchar("kind", { length: 10 }).$type<"account" | "user">().notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    monthlyAllowance: bigint("monthly_allowance", { mode: "number" }).notNull(),
    maxPerRequest: integer("max_per_request").notNull(),
    // NULL means a predefined (read-only) plan
    ownerAccountId: uuid("owner_account_id").references(
      (): AnyPgColumn => accounts.id,
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check("plans_kind_check", sql`${t.kind} IN ('account', 'user')`),
    check("plans_monthly_allowance_check", sql`${t.monthlyAllowance} >= 0`),
    check("plans_max_per_request_check", sql`${t.maxPerRequest} > 0`),
  ],
);

export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 200 }).notNull(),
  planId: uuid("plan_id")
    .notNull()
    .references(() => plans.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accounts.id),
  keyHash: varchar("key_hash", { length: 128 }).notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    externalId: varchar("external_id", { length: 200 }).notNull(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique("users_account_external_unique").on(t.accountId, t.externalId)],
);

export const accountUsage = pgTable(
  "account_usage",
  {
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    month: date("month", { mode: "string" }).notNull(),
    unitsUsed: bigint("units_used", { mode: "number" }).notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.accountId, t.month] }),
    check("account_usage_units_check", sql`${t.unitsUsed} >= 0`),
  ],
);

export const userUsage = pgTable(
  "user_usage",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    month: date("month", { mode: "string" }).notNull(),
    unitsUsed: bigint("units_used", { mode: "number" }).notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.month] }),
    check("user_usage_units_check", sql`${t.unitsUsed} >= 0`),
  ],
);

export const consumptionRequests = pgTable(
  "consumption_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    requestId: varchar("request_id", { length: 200 }).notNull(),
    units: integer("units").notNull(),
    month: date("month", { mode: "string" }).notNull(),
    accepted: boolean("accepted").notNull(),
    rejectedLevel: varchar("rejected_level", { length: 10 }).$type<"account" | "user">(),
    rejectedRule: varchar("rejected_rule", { length: 30 }).$type<"monthly_allowance" | "max_per_request">(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("consumption_account_request_unique").on(t.accountId, t.requestId),
    index("consumption_account_created_idx").on(t.accountId, t.createdAt),
    check("consumption_units_check", sql`${t.units} > 0`),
    check(
      "consumption_decision_check",
      sql`(${t.accepted} AND ${t.rejectedLevel} IS NULL AND ${t.rejectedRule} IS NULL)
        OR (NOT ${t.accepted}
          AND ${t.rejectedLevel} IN ('account', 'user')
          AND ${t.rejectedRule} IN ('monthly_allowance', 'max_per_request'))`,
    ),
  ],
);
