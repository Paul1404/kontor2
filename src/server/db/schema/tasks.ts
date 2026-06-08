import { date, index, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { membersTable } from "~/server/db/schema/members";

/**
 * Wiedervorlagen: lightweight follow-up tasks attached to a member ("IBAN
 * nachfordern", "Austritt bestätigen"). They surface on the member page and in
 * a cross-member worklist sorted by due date, so nothing falls through the
 * cracks. Deliberately simple: a title, optional note and due date, and an
 * open/done status -- not a full ticketing system.
 */

export const memberTaskStatusEnum = pgEnum("member_task_status", ["open", "done"]);

export const memberTasksTable = pgTable(
  "member_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => membersTable.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    notes: text("notes"),
    /** Optional due date (ISO yyyy-mm-dd). Drives the worklist ordering. */
    dueDate: date("due_date"),
    status: memberTaskStatusEnum("status").notNull().default("open"),
    createdBy: text("created_by"),
    createdByEmail: text("created_by_email"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedByEmail: text("completed_by_email"),
  },
  (t) => [
    index("member_tasks_member_idx").on(t.memberId),
    index("member_tasks_status_due_idx").on(t.status, t.dueDate),
  ],
);

export type MemberTask = typeof memberTasksTable.$inferSelect;
