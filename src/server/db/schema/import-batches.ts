import { bigint, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "~/server/db/schema/auth";

export const importSourceEnum = pgEnum("import_source", ["sql_upload", "svums_push"]);

export const importBatchesTable = pgTable("import_batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  source: importSourceEnum("source").notNull(),
  filename: text("filename"),
  fileSizeBytes: bigint("file_size_bytes", { mode: "number" }),
  membersWritten: integer("members_written").notNull().default(0),
  contractsWritten: integer("contracts_written").notNull().default(0),
  feeTypesWritten: integer("fee_types_written").notNull().default(0),
  sepaWritten: integer("sepa_written").notNull().default(0),
  parsedTables: text("parsed_tables").array(),
  skippedTables: text("skipped_tables").array(),
  errors: jsonb("errors").$type<Array<{ table: string; message: string }>>(),
  startedBy: text("started_by").references(() => users.id, { onDelete: "set null" }),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export type ImportBatch = typeof importBatchesTable.$inferSelect;
