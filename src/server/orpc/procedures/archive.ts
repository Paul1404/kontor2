import { createHash } from "node:crypto";
import { ORPCError } from "@orpc/server";
import { and, asc, desc, eq, ilike, sql } from "drizzle-orm";
import * as v from "valibot";
import { ingestArchive } from "~/server/archive/ingest-archive";
import { analyzeDump } from "~/server/archive/sql-analyzer";
import type { DB } from "~/server/db/client";
import { escapeLike } from "~/server/db/like";
import {
  type LinearArchiveVersion,
  linearArchiveColumnsTable,
  linearArchiveRowsTable,
  linearArchiveTablesTable,
  linearArchiveVersionsTable,
} from "~/server/db/schema/linear-archive";
import { createProgressReporter, readImportProgress } from "~/server/importer/progress";
import { adminProc, vorstandProc } from "~/server/orpc/base";

const MAX_BYTES = 50 * 1024 * 1024;

/** Optional selector shared by every read procedure; omitting both = latest. */
const VersionSelector = {
  versionId: v.optional(v.string()),
  version: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
};

/**
 * Resolve a concrete archive version from an explicit id, an explicit version
 * number, or (when neither is given) the highest version = latest.
 */
async function resolveVersion(
  db: DB,
  input: { versionId?: string; version?: number },
): Promise<LinearArchiveVersion> {
  if (input.versionId) {
    const [row] = await db
      .select()
      .from(linearArchiveVersionsTable)
      .where(eq(linearArchiveVersionsTable.id, input.versionId))
      .limit(1);
    if (!row) throw new ORPCError("NOT_FOUND", { message: "Archiv-Version nicht gefunden." });
    return row;
  }
  if (input.version != null) {
    const [row] = await db
      .select()
      .from(linearArchiveVersionsTable)
      .where(eq(linearArchiveVersionsTable.version, input.version))
      .limit(1);
    if (!row) throw new ORPCError("NOT_FOUND", { message: "Archiv-Version nicht gefunden." });
    return row;
  }
  const [row] = await db
    .select()
    .from(linearArchiveVersionsTable)
    .orderBy(desc(linearArchiveVersionsTable.version))
    .limit(1);
  if (!row) {
    throw new ORPCError("NOT_FOUND", { message: "Noch kein SQL-Archiv vorhanden." });
  }
  return row;
}

async function loadTable(db: DB, versionId: string, tableName: string) {
  const [table] = await db
    .select()
    .from(linearArchiveTablesTable)
    .where(
      and(
        eq(linearArchiveTablesTable.versionId, versionId),
        eq(linearArchiveTablesTable.tableName, tableName),
      ),
    )
    .limit(1);
  if (!table) {
    throw new ORPCError("NOT_FOUND", { message: `Tabelle „${tableName}“ nicht im Archiv.` });
  }
  return table;
}

export const archiveRouter = {
  /** Live progress for an in-flight archive upload (same Redis channel as the
   *  importer), polled by the upload UI. */
  progress: adminProc
    .input(v.object({ token: v.pipe(v.string(), v.minLength(1)) }))
    .handler(async ({ context, input }) => {
      return (
        (await readImportProgress(context.tenant.key, input.token)) ?? {
          phase: "",
          processed: 0,
          total: 0,
          percent: 0,
          done: false,
          startedAt: 0,
          updatedAt: 0,
        }
      );
    }),

  /**
   * Upload a Linear SQL dump into the isolated, versioned archive. This does
   * NOT import into live tables -- it parses the whole dump generically and
   * stores it as a new, searchable version.
   */
  upload: adminProc
    .input(
      v.object({
        filename: v.string(),
        contentBase64: v.pipe(v.string(), v.minLength(1)),
        notes: v.optional(v.nullable(v.pipe(v.string(), v.maxLength(2000)))),
        progressToken: v.optional(v.string()),
      }),
    )
    .handler(async ({ context, input }) => {
      const reporter = createProgressReporter(context.tenant.key, input.progressToken);
      const buf = Buffer.from(input.contentBase64, "base64");
      if (buf.length === 0) {
        throw new ORPCError("BAD_REQUEST", { message: "Leere Datei." });
      }
      if (buf.length > MAX_BYTES) {
        throw new ORPCError("PAYLOAD_TOO_LARGE", {
          message: `Datei zu groß. Maximum: ${MAX_BYTES / 1024 / 1024} MB.`,
        });
      }
      const text = buf.toString("utf8");
      if (!/CREATE TABLE|INSERT INTO/i.test(text)) {
        throw new ORPCError("BAD_REQUEST", { message: "Keine SQL-Befehle erkannt." });
      }
      const sha256 = createHash("sha256").update(buf).digest("hex");

      reporter.report({ phase: "Analysieren", processed: 0, total: 0 });
      const analyzed = analyzeDump(text);
      if (analyzed.tables.length === 0) {
        await reporter.finish({ error: "Keine Tabellen im Dump gefunden." });
        throw new ORPCError("BAD_REQUEST", { message: "Keine Tabellen im Dump gefunden." });
      }

      const [dupe] = await context.db
        .select({ version: linearArchiveVersionsTable.version })
        .from(linearArchiveVersionsTable)
        .where(eq(linearArchiveVersionsTable.sha256, sha256))
        .orderBy(desc(linearArchiveVersionsTable.version))
        .limit(1);

      try {
        const result = await ingestArchive(context.db, {
          filename: input.filename,
          fileSizeBytes: buf.length,
          sha256,
          notes: input.notes ?? null,
          createdBy: context.session!.user.id,
          createdByEmail: context.session!.user.email,
          analyzed,
          onProgress: reporter.report,
        });
        await reporter.finish();
        return { ...result, sha256, duplicateOfVersion: dupe?.version ?? null };
      } catch (err) {
        await reporter.finish({ error: (err as Error).message });
        throw err;
      }
    }),

  /** All archive versions, newest first; the highest version is the latest. */
  listVersions: vorstandProc.handler(async ({ context }) => {
    const rows = await context.db
      .select()
      .from(linearArchiveVersionsTable)
      .orderBy(desc(linearArchiveVersionsTable.version));
    const latest = rows[0]?.version ?? null;
    return {
      latestVersion: latest,
      versions: rows.map((r) => ({
        id: r.id,
        version: r.version,
        isLatest: r.version === latest,
        filename: r.filename,
        fileSizeBytes: r.fileSizeBytes,
        sha256: r.sha256,
        status: r.status,
        tableCount: r.tableCount,
        rowCount: r.rowCount,
        notes: r.notes,
        createdAt: r.createdAt,
        createdByEmail: r.createdByEmail,
        errorCount: r.errors?.length ?? 0,
      })),
    };
  }),

  /** Permanently delete one archive version and all its tables/rows. */
  deleteVersion: adminProc
    .input(v.object({ versionId: v.string() }))
    .handler(async ({ context, input }) => {
      const deleted = await context.db
        .delete(linearArchiveVersionsTable)
        .where(eq(linearArchiveVersionsTable.id, input.versionId))
        .returning({ version: linearArchiveVersionsTable.version });
      if (deleted.length === 0) {
        throw new ORPCError("NOT_FOUND", { message: "Archiv-Version nicht gefunden." });
      }
      return { deletedVersion: deleted[0]!.version };
    }),

  /** Tables of one version with row/column counts -- the entry point to browse. */
  overview: vorstandProc
    .input(v.object({ ...VersionSelector }))
    .handler(async ({ context, input }) => {
      const version = await resolveVersion(context.db, input);
      const tables = await context.db
        .select({
          tableName: linearArchiveTablesTable.tableName,
          columnCount: linearArchiveTablesTable.columnCount,
          rowCount: linearArchiveTablesTable.rowCount,
          primaryKey: linearArchiveTablesTable.primaryKey,
        })
        .from(linearArchiveTablesTable)
        .where(eq(linearArchiveTablesTable.versionId, version.id))
        .orderBy(asc(linearArchiveTablesTable.tableName));
      return {
        version: {
          id: version.id,
          version: version.version,
          filename: version.filename,
          status: version.status,
          tableCount: version.tableCount,
          rowCount: version.rowCount,
          createdAt: version.createdAt,
          createdByEmail: version.createdByEmail,
        },
        tables,
      };
    }),

  /** Reverse-engineered schema of one table: columns, types and value stats. */
  describeTable: adminProc
    .input(v.object({ ...VersionSelector, tableName: v.pipe(v.string(), v.minLength(1)) }))
    .handler(async ({ context, input }) => {
      const version = await resolveVersion(context.db, input);
      const table = await loadTable(context.db, version.id, input.tableName);
      const columns = await context.db
        .select()
        .from(linearArchiveColumnsTable)
        .where(eq(linearArchiveColumnsTable.tableId, table.id))
        .orderBy(asc(linearArchiveColumnsTable.ordinal));
      return {
        version: version.version,
        tableName: table.tableName,
        createSql: table.createSql,
        rowCount: table.rowCount,
        primaryKey: table.primaryKey,
        columns: columns.map((c) => ({
          ordinal: c.ordinal,
          name: c.name,
          dataType: c.dataType,
          baseType: c.baseType,
          nullable: c.nullable,
          defaultValue: c.defaultValue,
          isPrimaryKey: c.isPrimaryKey,
          isIndexed: c.isIndexed,
          nullCount: c.nullCount,
          distinctCount: c.distinctCount,
          distinctCapped: c.distinctCapped,
          minText: c.minText,
          maxText: c.maxText,
          sampleValues: c.sampleValues,
        })),
      };
    }),

  /** Paginated rows of one table, optionally filtered by a free-text query. */
  tableRows: adminProc
    .input(
      v.object({
        ...VersionSelector,
        tableName: v.pipe(v.string(), v.minLength(1)),
        q: v.optional(v.nullable(v.string())),
        page: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1)), 1),
        pageSize: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(200)), 50),
      }),
    )
    .handler(async ({ context, input }) => {
      const version = await resolveVersion(context.db, input);
      const table = await loadTable(context.db, version.id, input.tableName);
      const q = input.q?.trim();
      const where = q
        ? and(
            eq(linearArchiveRowsTable.tableId, table.id),
            ilike(linearArchiveRowsTable.searchText, `%${escapeLike(q.toLowerCase())}%`),
          )
        : eq(linearArchiveRowsTable.tableId, table.id);

      const totalRows = await context.db
        .select({ total: sql<number>`count(*)::int` })
        .from(linearArchiveRowsTable)
        .where(where);
      const total = totalRows[0]?.total ?? 0;

      const rows = await context.db
        .select({ rowIndex: linearArchiveRowsTable.rowIndex, data: linearArchiveRowsTable.data })
        .from(linearArchiveRowsTable)
        .where(where)
        .orderBy(asc(linearArchiveRowsTable.rowIndex))
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize);

      return {
        version: version.version,
        tableName: table.tableName,
        page: input.page,
        pageSize: input.pageSize,
        total,
        rows,
      };
    }),

  /** Free-text search across every table of a version (matches on any value). */
  search: adminProc
    .input(
      v.object({
        ...VersionSelector,
        q: v.pipe(v.string(), v.trim(), v.minLength(1)),
        tableName: v.optional(v.nullable(v.string())),
        limit: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(200)), 50),
      }),
    )
    .handler(async ({ context, input }) => {
      const version = await resolveVersion(context.db, input);
      const pattern = `%${escapeLike(input.q.toLowerCase())}%`;
      const conds = [
        eq(linearArchiveRowsTable.versionId, version.id),
        ilike(linearArchiveRowsTable.searchText, pattern),
      ];
      if (input.tableName) conds.push(eq(linearArchiveRowsTable.tableName, input.tableName));

      const totalRows = await context.db
        .select({ total: sql<number>`count(*)::int` })
        .from(linearArchiveRowsTable)
        .where(and(...conds));
      const total = totalRows[0]?.total ?? 0;

      const rows = await context.db
        .select({
          tableName: linearArchiveRowsTable.tableName,
          rowIndex: linearArchiveRowsTable.rowIndex,
          data: linearArchiveRowsTable.data,
        })
        .from(linearArchiveRowsTable)
        .where(and(...conds))
        .orderBy(asc(linearArchiveRowsTable.tableName), asc(linearArchiveRowsTable.rowIndex))
        .limit(input.limit);

      return { version: version.version, query: input.q, total, rows };
    }),

  /** Value frequency of one column (group-by), great for reverse-engineering
   *  codes and enum-like fields. */
  columnValues: adminProc
    .input(
      v.object({
        ...VersionSelector,
        tableName: v.pipe(v.string(), v.minLength(1)),
        column: v.pipe(v.string(), v.minLength(1)),
        limit: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(200)), 50),
      }),
    )
    .handler(async ({ context, input }) => {
      const version = await resolveVersion(context.db, input);
      const table = await loadTable(context.db, version.id, input.tableName);
      const valueExpr = sql<string | null>`${linearArchiveRowsTable.data} ->> ${input.column}`;
      const rows = await context.db
        .select({ value: valueExpr, count: sql<number>`count(*)::int` })
        .from(linearArchiveRowsTable)
        .where(eq(linearArchiveRowsTable.tableId, table.id))
        .groupBy(valueExpr)
        .orderBy(desc(sql`count(*)`))
        .limit(input.limit);
      return {
        version: version.version,
        tableName: table.tableName,
        column: input.column,
        values: rows.map((r) => ({ value: r.value, count: r.count })),
      };
    }),

  /** Inferred relationships: columns whose name appears in more than one table
   *  (e.g. AdrNr), plus each table's primary key. */
  relationships: vorstandProc
    .input(v.object({ ...VersionSelector }))
    .handler(async ({ context, input }) => {
      const version = await resolveVersion(context.db, input);
      const cols = await context.db
        .select({
          tableName: linearArchiveColumnsTable.tableName,
          name: linearArchiveColumnsTable.name,
          dataType: linearArchiveColumnsTable.dataType,
          isPrimaryKey: linearArchiveColumnsTable.isPrimaryKey,
        })
        .from(linearArchiveColumnsTable)
        .where(eq(linearArchiveColumnsTable.versionId, version.id));

      const byName = new Map<
        string,
        Array<{ tableName: string; dataType: string | null; isPrimaryKey: boolean }>
      >();
      for (const c of cols) {
        const list = byName.get(c.name) ?? [];
        list.push({ tableName: c.tableName, dataType: c.dataType, isPrimaryKey: c.isPrimaryKey });
        byName.set(c.name, list);
      }
      const sharedColumns = [...byName.entries()]
        .filter(([, tables]) => tables.length > 1)
        .map(([name, tables]) => ({ name, tableCount: tables.length, tables }))
        .sort((a, b) => b.tableCount - a.tableCount || a.name.localeCompare(b.name));

      const pkTables = await context.db
        .select({
          tableName: linearArchiveTablesTable.tableName,
          primaryKey: linearArchiveTablesTable.primaryKey,
        })
        .from(linearArchiveTablesTable)
        .where(eq(linearArchiveTablesTable.versionId, version.id))
        .orderBy(asc(linearArchiveTablesTable.tableName));

      return {
        version: version.version,
        sharedColumns,
        primaryKeys: pkTables.filter((t) => t.primaryKey.length > 0),
      };
    }),

  /** Schema diff between two versions: added/removed tables and columns. */
  schemaDiff: vorstandProc
    .input(
      v.object({
        fromVersion: v.pipe(v.number(), v.integer(), v.minValue(1)),
        toVersion: v.pipe(v.number(), v.integer(), v.minValue(1)),
      }),
    )
    .handler(async ({ context, input }) => {
      const from = await resolveVersion(context.db, { version: input.fromVersion });
      const to = await resolveVersion(context.db, { version: input.toVersion });

      const load = async (versionId: string) => {
        const cols = await context.db
          .select({
            tableName: linearArchiveColumnsTable.tableName,
            name: linearArchiveColumnsTable.name,
            dataType: linearArchiveColumnsTable.dataType,
          })
          .from(linearArchiveColumnsTable)
          .where(eq(linearArchiveColumnsTable.versionId, versionId));
        const map = new Map<string, Map<string, string | null>>();
        for (const c of cols) {
          const t = map.get(c.tableName) ?? new Map<string, string | null>();
          t.set(c.name, c.dataType);
          map.set(c.tableName, t);
        }
        return map;
      };

      const fromMap = await load(from.id);
      const toMap = await load(to.id);

      const addedTables = [...toMap.keys()].filter((t) => !fromMap.has(t)).sort();
      const removedTables = [...fromMap.keys()].filter((t) => !toMap.has(t)).sort();
      const changedTables: Array<{
        tableName: string;
        addedColumns: string[];
        removedColumns: string[];
        typeChanged: Array<{ name: string; from: string | null; to: string | null }>;
      }> = [];

      for (const [tableName, toCols] of toMap) {
        const fromCols = fromMap.get(tableName);
        if (!fromCols) continue;
        const addedColumns = [...toCols.keys()].filter((c) => !fromCols.has(c)).sort();
        const removedColumns = [...fromCols.keys()].filter((c) => !toCols.has(c)).sort();
        const typeChanged: Array<{ name: string; from: string | null; to: string | null }> = [];
        for (const [name, toType] of toCols) {
          const fromType = fromCols.get(name);
          if (fromCols.has(name) && fromType !== toType) {
            typeChanged.push({ name, from: fromType ?? null, to: toType });
          }
        }
        if (addedColumns.length || removedColumns.length || typeChanged.length) {
          changedTables.push({ tableName, addedColumns, removedColumns, typeChanged });
        }
      }
      changedTables.sort((a, b) => a.tableName.localeCompare(b.tableName));

      return {
        fromVersion: from.version,
        toVersion: to.version,
        addedTables,
        removedTables,
        changedTables,
      };
    }),
};
