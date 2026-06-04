import { index, integer, jsonb, numeric, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "~/server/db/schema/auth";

/**
 * History of generated Kulanz letters (Zahlungserinnerung with a goodwill
 * Sonderkündigung offer). Each row is one batch run: the combined PDF holds one
 * letter per recipient and is stored in S3, so the Forderungen page can list
 * and re-download past runs. The recipient list is a denormalized snapshot
 * frozen at generation time; the letters must not change if a member is later
 * edited.
 */
export type KulanzRecipientSnapshot = {
  memberId: string;
  name: string;
  mitgliedsnummer: string;
  openSum: string;
};

export const kulanzLettersTable = pgTable(
  "kulanz_letters",
  {
    id: text("id").primaryKey(),
    /** Letter date (ISO yyyy-mm-dd). */
    runDate: text("run_date").notNull(),
    /** Payment / Kündigungs deadline (ISO yyyy-mm-dd). */
    deadlineDate: text("deadline_date").notNull(),
    recipientCount: integer("recipient_count").notNull(),
    totalOpen: numeric("total_open", { precision: 19, scale: 2 }).notNull(),
    recipients: jsonb("recipients").$type<KulanzRecipientSnapshot[]>().notNull().default([]),
    s3Key: text("s3_key").notNull(),
    filename: text("filename").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [index("kulanz_letters_created_idx").on(t.createdAt)],
);

export type KulanzLetter = typeof kulanzLettersTable.$inferSelect;
