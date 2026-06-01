import { getTableColumns, sql } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import type { DB } from "~/server/db/client";

/**
 * Rows per multi-row INSERT. Wide tables (members ~50 cols) stay well under
 * Postgres' 65535 bound parameters per statement at this size.
 */
export const DEFAULT_CHUNK_SIZE = 250;

export type ConflictSpec = {
  /** Conflict target column(s). Omit together with `updateKeys: []` for a
   *  constraint-agnostic DO NOTHING. */
  target?: PgColumn | PgColumn[];
  /**
   * TS property names to refresh from the incoming row on conflict, each
   * mapped to its `excluded.<col>`. When omitted, every non-target value key
   * is refreshed (matching the per-row upserts' "last write wins"). An empty
   * array means DO NOTHING.
   */
  updateKeys?: string[];
};

function buildExcludedSet(table: PgTable, keys: string[]): Record<string, unknown> {
  const cols = getTableColumns(table) as Record<string, PgColumn>;
  const set: Record<string, unknown> = {};
  for (const k of keys) {
    const col = cols[k];
    if (!col) continue;
    set[k] = sql`excluded.${sql.identifier(col.name)}`;
  }
  return set;
}

async function runInsert(
  db: DB,
  table: PgTable,
  values: Record<string, unknown>[],
  conflict?: ConflictSpec,
): Promise<void> {
  if (values.length === 0) return;
  const base = db.insert(table).values(values as never);
  if (!conflict) {
    await base;
    return;
  }
  if (conflict.updateKeys && conflict.updateKeys.length === 0) {
    await (conflict.target
      ? base.onConflictDoNothing({ target: conflict.target })
      : base.onConflictDoNothing());
    return;
  }
  if (!conflict.target) {
    throw new Error("onConflictDoUpdate requires a target");
  }
  const cols = getTableColumns(table) as Record<string, PgColumn>;
  const targetCols = Array.isArray(conflict.target) ? conflict.target : [conflict.target];
  const targetNames = new Set(targetCols.map((c) => c.name));
  const keys =
    conflict.updateKeys ??
    Object.keys(values[0] ?? {}).filter((k) => cols[k] && !targetNames.has(cols[k].name));
  await base.onConflictDoUpdate({
    target: conflict.target,
    set: buildExcludedSet(table, keys) as never,
  });
}

/**
 * Generic chunk-with-per-row-fallback orchestrator, decoupled from the DB so
 * it can be unit-tested. A single multi-row write collapses N round-trips into
 * one, but one bad row fails the whole statement; since a failed INSERT is
 * atomic (Postgres writes nothing), we retry the failed chunk row-by-row to
 * isolate and report the offending row without losing its neighbours.
 *
 * Returns the number of rows successfully written.
 */
export async function chunkedWrite<T>(
  rows: T[],
  opts: {
    chunkSize?: number;
    writeChunk: (chunk: T[]) => Promise<void>;
    writeOne: (row: T) => Promise<void>;
    onError: (row: T, error: Error) => void;
    onProgress?: (processed: number) => void;
  },
): Promise<number> {
  const size = opts.chunkSize ?? DEFAULT_CHUNK_SIZE;
  let written = 0;
  let processed = 0;
  for (let i = 0; i < rows.length; i += size) {
    const chunk = rows.slice(i, i + size);
    try {
      await opts.writeChunk(chunk);
      written += chunk.length;
    } catch {
      // One row sank the chunk. Replay row-by-row to pin the culprit; the
      // failed multi-row INSERT left nothing behind, so no partial dupes.
      for (const row of chunk) {
        try {
          await opts.writeOne(row);
          written += 1;
        } catch (e) {
          opts.onError(row, e as Error);
        }
      }
    }
    processed += chunk.length;
    opts.onProgress?.(processed);
  }
  return written;
}

/**
 * Insert `rows` into `table` in chunks, with per-row fallback (see
 * `chunkedWrite`). `conflict` turns the inserts into upserts (or DO NOTHING).
 */
export async function batchInsert(
  db: DB,
  table: PgTable,
  rows: Record<string, unknown>[],
  opts: {
    conflict?: ConflictSpec;
    chunkSize?: number;
    onError: (row: Record<string, unknown>, error: Error) => void;
    onProgress?: (processed: number) => void;
  },
): Promise<number> {
  return chunkedWrite(rows, {
    chunkSize: opts.chunkSize,
    writeChunk: (chunk) => runInsert(db, table, chunk, opts.conflict),
    writeOne: (row) => runInsert(db, table, [row], opts.conflict),
    onError: opts.onError,
    onProgress: opts.onProgress,
  });
}
