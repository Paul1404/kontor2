import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { importBatchesTable } from "~/server/db/schema/import-batches";
import { membersTable } from "~/server/db/schema/members";

/**
 * Verbatim provenance of every imported Linear row, kept as jsonb. This is what
 * lets the working `members` schema drop Linear's legacy columns without losing
 * data: the complete original row stays here for audit, DSGVO Auskunft, and
 * re-derivation of any field we did not promote to a clean column.
 *
 * Written by the importer on every run (one row per source record). Cascades on
 * member delete so a hard erasure removes the raw copy too.
 */
export const memberSourceRecordsTable = pgTable(
  "member_source_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => membersTable.id, { onDelete: "cascade" }),
    /** Linear `AdrNr`, kept denormalized so provenance is findable by key. */
    adrNr: integer("adr_nr").notNull(),
    importBatchId: uuid("import_batch_id").references(() => importBatchesTable.id, {
      onDelete: "set null",
    }),
    /** Linear source table the row came from (e.g. "adresse"). */
    sourceTable: text("source_table").notNull().default("adresse"),
    /** The complete original row, exactly as parsed from the Linear dump. */
    raw: jsonb("raw").$type<Record<string, unknown>>().notNull(),
    importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One current verbatim record per member and source table. The importer
    // upserts on this key on every run, so re-imports refresh the row in place
    // instead of accumulating a copy each time. Change history lives in the
    // audit log, not here.
    uniqueIndex("member_source_records_member_source_uk").on(t.memberId, t.sourceTable),
    index("member_source_records_adr_nr_idx").on(t.adrNr),
  ],
);

export type MemberSourceRecord = typeof memberSourceRecordsTable.$inferSelect;
export type NewMemberSourceRecord = typeof memberSourceRecordsTable.$inferInsert;
