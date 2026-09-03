import {
  boolean,
  date,
  index,
  integer,
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
 * Append-only receipt for a recorded Kündigung. The member row holds the
 * current Austrittsdatum; this table holds the paper trail behind it: when the
 * written Austrittserklärung arrived, which scan proves it, which
 * Austrittstermin the statute produced from that date, and whether an operator
 * deviated from it.
 *
 * Rows survive a Reaktivierung on purpose. A withdrawn cancellation is history,
 * not a mistake to erase, so `revokedAt` marks it instead of a delete.
 */
export const memberCancellationsTable = pgTable(
  "member_cancellations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => membersTable.id, { onDelete: "cascade" }),
    /** Scan of the written Austrittserklärung (Schriftform, § 3 Abs. 1). */
    evidenceAttachmentId: uuid("evidence_attachment_id")
      .notNull()
      .references(() => attachmentsTable.id, { onDelete: "restrict" }),
    /** Day the written notice reached the club. The Frist counts from here. */
    noticeReceivedOn: date("notice_received_on").notNull(),
    /** Austrittstermin actually stamped on the member. */
    effectiveDate: date("effective_date").notNull(),
    /** Austrittstermin the statute rule produced from `noticeReceivedOn`. */
    computedEffectiveDate: date("computed_effective_date").notNull(),
    /** Rule snapshot, so a later settings change does not rewrite history. */
    dateMode: text("date_mode").notNull(),
    noticeDays: integer("notice_days").notNull(),
    statuteReference: text("statute_reference"),
    /** True when `effectiveDate` deviates from `computedEffectiveDate`. */
    overridden: boolean("overridden").notNull().default(false),
    overrideReason: text("override_reason"),
    sepaRevoked: boolean("sepa_revoked").notNull(),
    closedAbteilungen: integer("closed_abteilungen").notNull().default(0),
    closedVertraege: integer("closed_vertraege").notNull().default(0),
    revokedSepaMandate: integer("revoked_sepa_mandate").notNull().default(0),
    note: text("note"),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
    recordedBy: text("recorded_by").references(() => users.id, { onDelete: "set null" }),
    recordedByEmail: text("recorded_by_email"),
    auditId: uuid("audit_id").references(() => auditLogTable.id, { onDelete: "set null" }),
    /** Set when the Austritt was later reversed via Reaktivierung. */
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("member_cancellations_evidence_uk").on(t.evidenceAttachmentId),
    index("member_cancellations_member_recorded_idx").on(t.memberId, t.recordedAt),
  ],
);

export type MemberCancellation = typeof memberCancellationsTable.$inferSelect;
