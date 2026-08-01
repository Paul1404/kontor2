import { bigint, index, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "~/server/db/schema/auth";
import { membersTable } from "~/server/db/schema/members";

export const attachmentKindEnum = pgEnum("attachment_kind", ["general", "bank_details_change"]);

export const attachmentsTable = pgTable(
  "attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => membersTable.id, { onDelete: "cascade" }),
    kind: attachmentKindEnum("kind").notNull().default("general"),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    s3Key: text("s3_key").notNull().unique(),
    uploadedBy: text("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("attachments_member_idx").on(t.memberId)],
);

export type Attachment = typeof attachmentsTable.$inferSelect;

/**
 * Server-issued one-time upload tickets. We persist the exact (memberId,
 * key, mimeType, sizeBytes, requestedBy) when issuing the upload ticket so finalize
 * doesn't have to trust client-supplied identifiers (which would otherwise
 * let a vorstand register an attachment for a different memberId, or
 * lie about the byte count).
 */
export const pendingUploadsTable = pgTable(
  "pending_uploads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => membersTable.id, { onDelete: "cascade" }),
    kind: attachmentKindEnum("kind").notNull().default("general"),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    s3Key: text("s3_key").notNull(),
    requestedBy: text("requested_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("pending_uploads_member_idx").on(t.memberId)],
);

export type PendingUpload = typeof pendingUploadsTable.$inferSelect;
