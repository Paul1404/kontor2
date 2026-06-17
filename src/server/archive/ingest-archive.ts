import { sql } from "drizzle-orm";
import {
  type AnalyzedDump,
  buildSearchText,
  rowToObject,
  summarizeColumn,
} from "~/server/archive/sql-analyzer";
import type { DB } from "~/server/db/client";
import {
  linearArchiveColumnsTable,
  linearArchiveRowsTable,
  linearArchiveTablesTable,
  linearArchiveVersionsTable,
} from "~/server/db/schema/linear-archive";
import { batchInsert } from "~/server/importer/batch";

export type ArchiveIngestInput = {
  filename: string;
  fileSizeBytes: number;
  sha256: string;
  notes?: string | null;
  createdBy?: string | null;
  createdByEmail?: string | null;
  analyzed: AnalyzedDump;
  onProgress?: (p: { phase: string; processed: number; total: number }) => void;
};

export type ArchiveIngestResult = {
  versionId: string;
  version: number;
  tableCount: number;
  rowCount: number;
  tables: Array<{ tableName: string; columnCount: number; rowCount: number }>;
  errors: Array<{ table: string; message: string }>;
};

/**
 * Ingest a fully-analyzed dump as a new archive version. The version number is
 * `max(existing) + 1`, so the newest upload is always the latest. Live tables
 * are never touched; everything lands in the `linear_archive_*` tables.
 */
export async function ingestArchive(
  db: DB,
  input: ArchiveIngestInput,
): Promise<ArchiveIngestResult> {
  const { analyzed } = input;
  const totalRows = analyzed.tables.reduce((sum, t) => sum + t.rows.length, 0);
  const errors: Array<{ table: string; message: string }> = [];

  const maxRows = await db
    .select({ maxVersion: sql<number | null>`max(${linearArchiveVersionsTable.version})` })
    .from(linearArchiveVersionsTable);
  const version = (maxRows[0]?.maxVersion ?? 0) + 1;

  const [versionRow] = await db
    .insert(linearArchiveVersionsTable)
    .values({
      version,
      filename: input.filename,
      fileSizeBytes: input.fileSizeBytes,
      sha256: input.sha256,
      status: "parsing",
      tableCount: analyzed.tables.length,
      rowCount: totalRows,
      notes: input.notes ?? null,
      createdBy: input.createdBy ?? null,
      createdByEmail: input.createdByEmail ?? null,
    })
    .returning({ id: linearArchiveVersionsTable.id });
  const versionId = versionRow!.id;

  const tableSummaries: Array<{ tableName: string; columnCount: number; rowCount: number }> = [];
  let processed = 0;

  try {
    for (const table of analyzed.tables) {
      const [tableRow] = await db
        .insert(linearArchiveTablesTable)
        .values({
          versionId,
          tableName: table.name,
          createSql: table.createSql,
          columnCount: table.columns.length,
          rowCount: table.rows.length,
          primaryKey: table.primaryKey,
        })
        .returning({ id: linearArchiveTablesTable.id });
      const tableId = tableRow!.id;

      if (table.columns.length > 0) {
        const columnValues = table.columns.map((col, idx) => {
          const stats = summarizeColumn(table.rows, idx);
          return {
            tableId,
            versionId,
            tableName: table.name,
            ordinal: idx,
            name: col.name,
            dataType: col.dataType,
            baseType: col.baseType,
            nullable: col.nullable,
            defaultValue: col.defaultValue,
            isPrimaryKey: col.isPrimaryKey,
            isIndexed: col.isIndexed,
            nullCount: stats.nullCount,
            distinctCount: stats.distinctCount,
            distinctCapped: stats.distinctCapped,
            minText: stats.minText,
            maxText: stats.maxText,
            sampleValues: stats.sampleValues,
          };
        });
        await batchInsert(db, linearArchiveColumnsTable, columnValues, {
          onError: (_row, err) => errors.push({ table: table.name, message: err.message }),
        });
      }

      if (table.rows.length > 0) {
        const rowValues = table.rows.map((row, idx) => ({
          versionId,
          tableId,
          tableName: table.name,
          rowIndex: idx,
          data: rowToObject(table.columns, row),
          searchText: buildSearchText(row),
        }));
        await batchInsert(db, linearArchiveRowsTable, rowValues, {
          onError: (_row, err) => errors.push({ table: table.name, message: err.message }),
          onProgress: (chunkProcessed) => {
            input.onProgress?.({
              phase: table.name,
              processed: processed + chunkProcessed,
              total: totalRows,
            });
          },
        });
        processed += table.rows.length;
      }

      tableSummaries.push({
        tableName: table.name,
        columnCount: table.columns.length,
        rowCount: table.rows.length,
      });
    }

    await db
      .update(linearArchiveVersionsTable)
      .set({ status: "ready", errors: errors.length > 0 ? errors.slice(0, 200) : null })
      .where(sql`${linearArchiveVersionsTable.id} = ${versionId}`);
  } catch (err) {
    await db
      .update(linearArchiveVersionsTable)
      .set({ status: "failed", errors: [{ table: "*", message: (err as Error).message }] })
      .where(sql`${linearArchiveVersionsTable.id} = ${versionId}`);
    throw err;
  }

  return {
    versionId,
    version,
    tableCount: analyzed.tables.length,
    rowCount: totalRows,
    tables: tableSummaries,
    errors,
  };
}
