import { sql } from "drizzle-orm";
import {
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { membersTable } from "~/server/db/schema/members";

/**
 * Recorded honors (Ehrungen) awarded to a member. Two kinds:
 *
 *   - `vereinsjubilaeum`: a membership anniversary (25, 40, 50 ... years). The
 *     candidates are computed from `eintritt` in the Ehrungen report; recording
 *     one here marks it as actually awarded, so the report can show open vs
 *     done and never honor the same milestone twice.
 *   - `sonderehrung`: an ad-hoc honor (Ehrenmitglied, Goldene Ehrennadel ...)
 *     not tied to a fixed anniversary, recorded straight on the member page.
 *
 * Each row optionally carries a generated Ehrungsurkunde (certificate) stored in
 * S3, referenced by a document number like "EU-2025-0007".
 */
export const ehrungKindEnum = pgEnum("ehrung_kind", ["vereinsjubilaeum", "sonderehrung"]);

export const ehrungenTable = pgTable(
  "ehrungen",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => membersTable.id, { onDelete: "cascade" }),
    kind: ehrungKindEnum("kind").notNull(),
    /** Years of membership for a Vereinsjubiläum (25, 40, ...); null for Sonderehrungen. */
    jubilaeumJahre: integer("jubilaeum_jahre"),
    /** Honor title shown on lists and the certificate, e.g. "25 Jahre Mitgliedschaft". */
    titel: text("titel").notNull(),
    /** Date the honor was awarded / handed over (ISO yyyy-mm-dd). */
    verliehenAm: date("verliehen_am").notNull(),
    /** Honor year for grouping and the report cross-reference (the Jubiläums- or award year). */
    jahr: integer("jahr").notNull(),
    notiz: text("notiz"),
    /** Allocated when an Ehrungsurkunde is generated, e.g. "EU-2025-0007". */
    urkundeDocRef: text("urkunde_doc_ref"),
    urkundeS3Key: text("urkunde_s3_key"),
    urkundeFilename: text("urkunde_filename"),
    urkundeErstelltAm: timestamp("urkunde_erstellt_am", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by"),
    createdByEmail: text("created_by_email"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("ehrungen_member_idx").on(t.memberId),
    index("ehrungen_jahr_idx").on(t.jahr),
    // A member earns each Vereinsjubiläum at most once: block double-honoring
    // the same anniversary while leaving soft-deleted rows out of the way.
    uniqueIndex("ehrungen_member_jubilaeum_uk")
      .on(t.memberId, t.jubilaeumJahre)
      .where(sql`${t.jubilaeumJahre} is not null and ${t.deletedAt} is null`),
  ],
);

export type Ehrung = typeof ehrungenTable.$inferSelect;
