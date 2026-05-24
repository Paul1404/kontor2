import { bigint, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { membersTable } from "~/server/db/schema/members";
import { users } from "~/server/db/schema/auth";

export const attachmentsTable = pgTable(
  "attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => membersTable.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    s3Key: text("s3_key").notNull().unique(),
    uploadedBy: text("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("attachments_member_idx").on(t.memberId)],
);

export type Attachment = typeof attachmentsTable.$inferSelect;
