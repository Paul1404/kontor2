import { jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/**
 * Idempotency keys for MCP write tools (issue #83). A retried `create_*` call
 * that carries the same `(scope, key)` returns the first call's stored result
 * instead of creating a second row. The unique index reserves the key so a
 * concurrent retry cannot slip through.
 */
export const idempotencyKeysTable = pgTable(
  "idempotency_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The tool/operation namespace, e.g. "create_member". */
    scope: text("scope").notNull(),
    /** Client-supplied key, unique within a scope. */
    key: text("key").notNull(),
    /** The first call's JSON result, written once the operation completes. */
    result: jsonb("result"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("idempotency_scope_key_uk").on(t.scope, t.key)],
);

export type IdempotencyKey = typeof idempotencyKeysTable.$inferSelect;
