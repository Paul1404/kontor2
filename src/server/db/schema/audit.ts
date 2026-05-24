import { index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "~/server/db/schema/auth";

export const auditActionEnum = pgEnum("audit_action", ["create", "update", "delete", "restore"]);

export const auditSourceEnum = pgEnum("audit_source", ["ui", "import", "svums_push", "system"]);

export const auditLogTable = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    actorId: text("actor_id").references(() => users.id, { onDelete: "set null" }),
    actorEmail: text("actor_email"),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    action: auditActionEnum("action").notNull(),
    source: auditSourceEnum("source").notNull().default("ui"),
    changes: jsonb("changes")
      .$type<Record<string, { before: unknown; after: unknown }>>()
      .notNull(),
    requestId: text("request_id"),
  },
  (t) => [
    index("audit_entity_idx").on(t.entityType, t.entityId, t.createdAt),
    index("audit_created_idx").on(t.createdAt),
  ],
);

export type AuditEntry = typeof auditLogTable.$inferSelect;
export type NewAuditEntry = typeof auditLogTable.$inferInsert;
