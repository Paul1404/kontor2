import { boolean, index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "~/server/db/schema/auth";
import { membersTable } from "~/server/db/schema/members";

/**
 * History of generated Austrittsbestätigungen (cancellation confirmation
 * letters). Each row records a snapshot of who the letter was for and the S3
 * key of the rendered PDF, so the member page can list and re-download past
 * letters. The snapshot is denormalized on purpose: the letter is a document
 * frozen at a point in time and must not change if the member is later edited.
 */
export type CancellationFamilyMember = {
  vorname: string;
  nachname: string;
  geburtsdatum?: string | null;
  mitgliedsnummer?: string | null;
};

export const cancellationLettersTable = pgTable(
  "cancellation_letters",
  {
    id: text("id").primaryKey(),
    /** The member the letter was generated for. Null if the member is later purged. */
    memberId: text("member_id").references(() => membersTable.id, { onDelete: "set null" }),
    /** Display name snapshot, e.g. "Mustermann, Erika" or "... (Familie)". */
    displayName: text("display_name").notNull(),
    austrittDatum: text("austritt_datum").notNull(),
    mitgliedsnummer: text("mitgliedsnummer"),
    abteilung: text("abteilung"),
    isFamily: boolean("is_family").notNull().default(false),
    /** Additional members on a family letter, frozen at generation time. */
    familienmitglieder: jsonb("familienmitglieder")
      .$type<CancellationFamilyMember[]>()
      .notNull()
      .default([]),
    /** True when the recipient differs from the member (parent/payer). */
    empfaengerAbweichend: boolean("empfaenger_abweichend").notNull().default(false),
    s3Key: text("s3_key").notNull(),
    filename: text("filename").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [index("cancellation_letters_member_idx").on(t.memberId)],
);

export type CancellationLetter = typeof cancellationLettersTable.$inferSelect;
