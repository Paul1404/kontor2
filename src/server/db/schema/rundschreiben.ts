import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { membersTable } from "~/server/db/schema/members";

/**
 * Rundschreiben: a bulk email sent to a member segment from the
 * Kommunikationszentrale. One header row per send, plus one recipient row per
 * addressee with its delivery outcome. The segment filter is stored as a
 * snapshot so the history shows who the run targeted even after the member base
 * changes.
 */

export const rundschreibenRecipientStatusEnum = pgEnum("rundschreiben_recipient_status", [
  "sent",
  "failed",
]);

/** Snapshot of the segment filter used for a send, for the history view. */
export type RundschreibenFilter = {
  status: string;
  abteilungId: string | null;
  includeExited: boolean;
};

export const rundschreibenTable = pgTable(
  "rundschreiben",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    filter: jsonb("filter").$type<RundschreibenFilter>(),
    /** Recipients that matched the segment and had an email address. */
    recipientCount: integer("recipient_count").notNull().default(0),
    sentCount: integer("sent_count").notNull().default(0),
    failedCount: integer("failed_count").notNull().default(0),
    createdBy: text("created_by"),
    createdByEmail: text("created_by_email"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("rundschreiben_created_idx").on(t.createdAt)],
);

export const rundschreibenRecipientsTable = pgTable(
  "rundschreiben_recipients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    rundschreibenId: uuid("rundschreiben_id")
      .notNull()
      .references(() => rundschreibenTable.id, { onDelete: "cascade" }),
    // Keep the row if the member is later deleted; the log is a historical record.
    memberId: uuid("member_id").references(() => membersTable.id, { onDelete: "set null" }),
    email: text("email").notNull(),
    name: text("name"),
    status: rundschreibenRecipientStatusEnum("status").notNull(),
    error: text("error"),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("rundschreiben_recipients_run_idx").on(t.rundschreibenId)],
);

export type Rundschreiben = typeof rundschreibenTable.$inferSelect;
export type RundschreibenRecipient = typeof rundschreibenRecipientsTable.$inferSelect;
