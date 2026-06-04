import { integer, pgTable, primaryKey, text } from "drizzle-orm/pg-core";

/**
 * Central allocator for human-readable document references. One row per
 * (prefix, year); `lastSeq` is bumped atomically to hand out the next number,
 * so every generated document gets a unique reference like "MA-2026-0042"
 * regardless of which document type asks for it. See `~/server/db/doc-ref`.
 */
export const documentSequencesTable = pgTable(
  "document_sequences",
  {
    /** Document type prefix, e.g. "KS" (Kulanz), "MA" (Mahnung), "DS" (DSGVO). */
    prefix: text("prefix").notNull(),
    /** Calendar year the reference belongs to; the sequence resets per year. */
    year: integer("year").notNull(),
    /** Highest number handed out so far for this (prefix, year). */
    lastSeq: integer("last_seq").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.prefix, t.year] })],
);

export type DocumentSequence = typeof documentSequencesTable.$inferSelect;
