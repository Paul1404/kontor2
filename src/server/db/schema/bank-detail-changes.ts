import {
  boolean,
  date,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { attachmentsTable } from "~/server/db/schema/attachments";
import { auditLogTable } from "~/server/db/schema/audit";
import { users } from "~/server/db/schema/auth";
import { membersTable } from "~/server/db/schema/members";

/**
 * Append-only receipt for a bank-details change. Full account data deliberately
 * stays out of this table: the encrypted member row is the current source of
 * truth, while snapshots cover point-in-time restoration.
 */
export const memberBankDetailChangesTable = pgTable(
  "member_bank_detail_changes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => membersTable.id, { onDelete: "cascade" }),
    evidenceAttachmentId: uuid("evidence_attachment_id")
      .notNull()
      .references(() => attachmentsTable.id, { onDelete: "restrict" }),
    requestedAt: date("requested_at").notNull(),
    appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
    appliedBy: text("applied_by").references(() => users.id, { onDelete: "set null" }),
    appliedByEmail: text("applied_by_email"),
    auditId: uuid("audit_id").references(() => auditLogTable.id, { onDelete: "set null" }),
    previousIbanLast4: text("previous_iban_last4"),
    newIbanLast4: text("new_iban_last4").notNull(),
    accountHolderChanged: boolean("account_holder_changed").notNull(),
    debitSuspended: boolean("debit_suspended").notNull(),
    note: text("note"),
  },
  (t) => [
    uniqueIndex("member_bank_detail_changes_evidence_uk").on(t.evidenceAttachmentId),
    index("member_bank_detail_changes_member_applied_idx").on(t.memberId, t.appliedAt),
  ],
);

export type MemberBankDetailChange = typeof memberBankDetailChangesTable.$inferSelect;
