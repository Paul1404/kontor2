import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "~/server/db/schema/auth";

/**
 * Isolated, versioned archive of raw Linear Webverein SQL dumps.
 *
 * This is deliberately NOT the import path. The importer (src/server/importer)
 * normalises a handful of known tables into the live domain schema. The archive
 * instead ingests the WHOLE dump generically -- every table, every column, with
 * its declared MySQL type -- into a self-contained set of tables so the legacy
 * database can be searched and reverse-engineered without ever touching live
 * member data. Each upload becomes a new version; the highest version number is
 * "latest". Nothing here references the live tables, and dropping a version
 * cascades only within the archive.
 *
 * The dump is legacy personal data (names, addresses, IBANs in plaintext, just
 * as they sit in the .sql file). Like `member_source_records`, archived rows are
 * stored verbatim as JSONB and are only reachable through admin-gated
 * procedures.
 */

export const linearArchiveStatusEnum = pgEnum("linear_archive_status", [
  "parsing",
  "ready",
  "failed",
]);

/** One uploaded dump = one version. Highest `version` is the latest. */
export const linearArchiveVersionsTable = pgTable(
  "linear_archive_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Monotonic, gap-free per tenant; assigned at ingest as max+1. */
    version: integer("version").notNull(),
    filename: text("filename").notNull(),
    fileSizeBytes: bigint("file_size_bytes", { mode: "number" }).notNull(),
    /** SHA-256 of the raw file, surfaced so an identical re-upload is obvious. */
    sha256: text("sha256").notNull(),
    status: linearArchiveStatusEnum("status").notNull().default("parsing"),
    tableCount: integer("table_count").notNull().default(0),
    rowCount: integer("row_count").notNull().default(0),
    /** First-row parse failures, table -> message, capped at ingest. */
    errors: jsonb("errors").$type<Array<{ table: string; message: string }>>(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdByEmail: text("created_by_email"),
  },
  (t) => [
    uniqueIndex("linear_archive_versions_version_uk").on(t.version),
    index("linear_archive_versions_created_idx").on(t.createdAt),
  ],
);

/** One row per table found in a dump version, with its verbatim CREATE TABLE. */
export const linearArchiveTablesTable = pgTable(
  "linear_archive_tables",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    versionId: uuid("version_id")
      .notNull()
      .references(() => linearArchiveVersionsTable.id, { onDelete: "cascade" }),
    tableName: text("table_name").notNull(),
    /** The CREATE TABLE statement exactly as it appeared in the dump. */
    createSql: text("create_sql").notNull(),
    columnCount: integer("column_count").notNull().default(0),
    rowCount: integer("row_count").notNull().default(0),
    /** Ordered column names of the primary key, if the dump declared one. */
    primaryKey: jsonb("primary_key").$type<string[]>().notNull().default([]),
  },
  (t) => [
    uniqueIndex("linear_archive_tables_version_name_uk").on(t.versionId, t.tableName),
    index("linear_archive_tables_version_idx").on(t.versionId),
  ],
);

/** Reverse-engineered column metadata + cheap per-column value statistics. */
export const linearArchiveColumnsTable = pgTable(
  "linear_archive_columns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tableId: uuid("table_id")
      .notNull()
      .references(() => linearArchiveTablesTable.id, { onDelete: "cascade" }),
    versionId: uuid("version_id")
      .notNull()
      .references(() => linearArchiveVersionsTable.id, { onDelete: "cascade" }),
    tableName: text("table_name").notNull(),
    ordinal: integer("ordinal").notNull(),
    name: text("name").notNull(),
    /** Declared MySQL type verbatim, e.g. "varchar(20)" or "bit(1)". */
    dataType: text("data_type"),
    /** Normalised base type, e.g. "varchar", "int", "bit", "datetime". */
    baseType: text("base_type"),
    nullable: boolean("nullable").notNull().default(true),
    defaultValue: text("default_value"),
    isPrimaryKey: boolean("is_primary_key").notNull().default(false),
    isIndexed: boolean("is_indexed").notNull().default(false),
    nullCount: integer("null_count").notNull().default(0),
    distinctCount: integer("distinct_count").notNull().default(0),
    /** True when the distinct count hit the sampling cap (so it is a floor). */
    distinctCapped: boolean("distinct_capped").notNull().default(false),
    minText: text("min_text"),
    maxText: text("max_text"),
    sampleValues: jsonb("sample_values")
      .$type<Array<string | number | boolean | null>>()
      .notNull()
      .default([]),
  },
  (t) => [
    index("linear_archive_columns_table_idx").on(t.tableId, t.ordinal),
    index("linear_archive_columns_version_name_idx").on(t.versionId, t.tableName),
  ],
);

/** Every data row, stored generically as JSONB keyed by column name. */
export const linearArchiveRowsTable = pgTable(
  "linear_archive_rows",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    versionId: uuid("version_id")
      .notNull()
      .references(() => linearArchiveVersionsTable.id, { onDelete: "cascade" }),
    tableId: uuid("table_id")
      .notNull()
      .references(() => linearArchiveTablesTable.id, { onDelete: "cascade" }),
    tableName: text("table_name").notNull(),
    /** Position of the row within its table, as parsed. */
    rowIndex: integer("row_index").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    /** Lowercased concatenation of the row's values for free-text ILIKE search. */
    searchText: text("search_text").notNull().default(""),
  },
  (t) => [
    index("linear_archive_rows_table_idx").on(t.tableId, t.rowIndex),
    index("linear_archive_rows_version_table_idx").on(t.versionId, t.tableName),
  ],
);

export type LinearArchiveVersion = typeof linearArchiveVersionsTable.$inferSelect;
export type LinearArchiveTable = typeof linearArchiveTablesTable.$inferSelect;
export type LinearArchiveColumn = typeof linearArchiveColumnsTable.$inferSelect;
export type LinearArchiveRow = typeof linearArchiveRowsTable.$inferSelect;
