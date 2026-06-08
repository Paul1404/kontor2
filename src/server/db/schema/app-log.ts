import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Persisted application log. The console remains the primary transport (Railway
 * ingests stdout); this table is a queryable mirror that powers the in-app
 * "Systemprotokoll" viewer so an operator can see recent activity and errors
 * without shell access to the deploy logs.
 *
 * Rows are written in batches by a buffered sink (`log-sink-db.ts`), capped by
 * a retention window and a maximum row count, both env-configurable. A few
 * common attributes (`requestId`, `proc`, `actorEmail`) are promoted to their
 * own columns for cheap filtering; everything else stays in `fields`.
 */
export const logLevelEnum = pgEnum("log_level", ["info", "warn", "error"]);

export const appLogTable = pgTable(
  "app_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // The emit time, not the insert time -- the sink buffers, so insertedAt
    // would scramble ordering under load. Indexed for the default feed.
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    level: logLevelEnum("level").notNull(),
    message: text("message").notNull(),
    /** Correlates rows from one request (`x-request-id`). */
    requestId: text("request_id"),
    /** oRPC procedure path for `rpc.*` records, e.g. `members.update`. */
    proc: text("proc"),
    /** Acting user when known. Never the raw secret-bearing fields. */
    actorEmail: text("actor_email"),
    /** Remaining structured fields, already redacted. */
    fields: jsonb("fields").$type<Record<string, unknown>>().notNull().default({}),
    /** Process id and host, so multi-replica deploys stay distinguishable. */
    pid: integer("pid"),
    hostname: text("hostname"),
  },
  (t) => [
    index("app_log_created_idx").on(t.createdAt),
    index("app_log_level_created_idx").on(t.level, t.createdAt),
    index("app_log_request_idx").on(t.requestId),
  ],
);

export type AppLogRow = typeof appLogTable.$inferSelect;
export type NewAppLogRow = typeof appLogTable.$inferInsert;
export type LogLevelDb = (typeof logLevelEnum.enumValues)[number];
