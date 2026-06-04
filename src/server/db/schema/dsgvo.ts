import {
  bigint,
  boolean,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "~/server/db/schema/auth";
import { membersTable } from "~/server/db/schema/members";

/**
 * DSGVO request type. Mirrors the four named rights from Art. 15 / 16 / 17 /
 * 18 / 21 GDPR (Auskunft, Berichtigung, Löschung, Einschränkung, Widerspruch).
 */
export const dsgvoRequestTypeEnum = pgEnum("dsgvo_request_type", [
  "auskunft",
  "berichtigung",
  "loeschung",
  "einschraenkung",
  "widerspruch",
]);

export const dsgvoRequestStatusEnum = pgEnum("dsgvo_request_status", [
  "open",
  "in_progress",
  "completed",
  "rejected",
]);

/**
 * One row per inbound data-subject request. Doubles as the audit-of-the-audit
 * the Datenschutzbeauftragter needs at any time. `memberId` is nullable so a
 * future "anonymous DSGVO inbox" can persist requests before they are matched
 * to a known member.
 */
export const dsgvoRequestsTable = pgTable(
  "dsgvo_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memberId: uuid("member_id").references(() => membersTable.id, { onDelete: "set null" }),
    type: dsgvoRequestTypeEnum("type").notNull(),
    status: dsgvoRequestStatusEnum("status").notNull().default("open"),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    requestedBy: text("requested_by").references(() => users.id, { onDelete: "set null" }),
    requestedByEmail: text("requested_by_email"),
    /** Required deadline. DSGVO Art. 12 (3): 1 month, extendable by 2 months. */
    deadline: timestamp("deadline", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedBy: text("completed_by").references(() => users.id, { onDelete: "set null" }),
    notes: text("notes"),
    /** Unique, printed reference for the Auskunft document, e.g. "DS-2026-0042". */
    docRef: text("doc_ref"),
    deliverableSha256: text("deliverable_sha256"),
    deliverableSizeBytes: bigint("deliverable_size_bytes", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("dsgvo_requests_member_idx").on(t.memberId),
    index("dsgvo_requests_status_idx").on(t.status, t.requestedAt),
    index("dsgvo_requests_requested_idx").on(t.requestedAt),
    uniqueIndex("dsgvo_requests_doc_ref_idx").on(t.docRef),
  ],
);

/**
 * Consent type. Modelled as an enum so we can render checkbox UI without
 * relying on free text. New types can be added in a follow-up migration.
 */
export const consentTypeEnum = pgEnum("dsgvo_consent_type", [
  "datenverarbeitung",
  "foto_name",
  "newsletter",
  "vereinszeitung",
]);

/**
 * Append-only consent log. Latest row per `(memberId, consentType)` is the
 * current state. Revocation is just a new row with `granted = false`.
 * `evidence` is a free-text description (e.g. "Unterschrift Beitrittsformular
 * vom 12.03.2024", "E-Mail vom 04.06.2026").
 */
export const dsgvoConsentLogTable = pgTable(
  "dsgvo_consent_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => membersTable.id, { onDelete: "cascade" }),
    consentType: consentTypeEnum("consent_type").notNull(),
    granted: boolean("granted").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
    recordedBy: text("recorded_by").references(() => users.id, { onDelete: "set null" }),
    recordedByEmail: text("recorded_by_email"),
    evidence: text("evidence"),
  },
  (t) => [
    index("dsgvo_consent_member_type_idx").on(t.memberId, t.consentType, t.recordedAt),
    index("dsgvo_consent_recorded_idx").on(t.recordedAt),
  ],
);

export type DsgvoRequest = typeof dsgvoRequestsTable.$inferSelect;
export type NewDsgvoRequest = typeof dsgvoRequestsTable.$inferInsert;
export type DsgvoConsentLogEntry = typeof dsgvoConsentLogTable.$inferSelect;
export type NewDsgvoConsentLogEntry = typeof dsgvoConsentLogTable.$inferInsert;
export type DsgvoRequestType = (typeof dsgvoRequestTypeEnum.enumValues)[number];
export type DsgvoRequestStatus = (typeof dsgvoRequestStatusEnum.enumValues)[number];
export type DsgvoConsentType = (typeof consentTypeEnum.enumValues)[number];
