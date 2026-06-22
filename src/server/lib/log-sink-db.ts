/**
 * Buffered Postgres sink for the application log.
 *
 * The console is the source of truth; this sink is a best-effort mirror that
 * backs the in-app "Systemprotokoll" viewer. Design constraints:
 *
 * - Never block or throw into the caller. `write` only appends to an in-memory
 *   buffer; the actual INSERT happens later, off the request path.
 * - Never recurse. The sink talks to the database directly (not through oRPC),
 *   and on failure it writes to `console.error` -- never back through the
 *   logger, which would re-enqueue the failure forever.
 * - Bounded memory. If flushing falls behind, the oldest buffered records are
 *   dropped (and counted) rather than growing without limit.
 * - Self-trimming. A retention window and a row cap are enforced on a timer so
 *   the table can't grow unbounded between deploys.
 *
 * Registration is lazy and idempotent (`registerDbLogSink`), mirroring how the
 * snapshot scheduler is started from the oRPC context.
 */

import { hostname } from "node:os";
import { lt, sql } from "drizzle-orm";
import { type DB, db, dbForTenant } from "~/server/db/client";
import { appLogTable } from "~/server/db/schema/app-log";
import { type LogLevel, type LogRecord, type LogSink, registerSink } from "~/server/lib/logger";
import { findTenantByKey, listTenants, type Tenant } from "~/server/tenants/registry";
import { primaryTenant } from "~/server/tenants/resolve";

const HOST = hostname();

/** How many buffered records to flush per INSERT. */
const FLUSH_BATCH = 500;
/** Flush whenever the buffer reaches this size, ahead of the timer. */
const FLUSH_TRIGGER = 100;
/** Idle flush cadence. */
const FLUSH_INTERVAL_MS = 2_000;
/** Hard cap on buffered records; oldest are dropped past this. */
const MAX_BUFFER = 10_000;
/** How often to enforce retention (delete old rows / trim to the row cap). */
const PRUNE_INTERVAL_MS = 5 * 60_000;

export type LogSinkConfig = {
  enabled: boolean;
  level: LogLevel;
  retentionDays: number;
  maxRows: number;
};

function envInt(name: string, fallback: number, min: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= min ? n : fallback;
}

function envLevel(): LogLevel {
  const raw = (process.env.LOG_DB_LEVEL ?? "").toLowerCase();
  return raw === "warn" || raw === "error" ? raw : "info";
}

/** Resolve the sink's configuration from the environment. */
export function logSinkConfig(): LogSinkConfig {
  return {
    enabled: process.env.LOG_DB_DISABLED !== "1" && process.env.NODE_ENV !== "test",
    level: envLevel(),
    retentionDays: envInt("LOG_DB_RETENTION_DAYS", 14, 1),
    maxRows: envInt("LOG_DB_MAX_ROWS", 100_000, 1_000),
  };
}

const buffer: LogRecord[] = [];
let dropped = 0;
let flushing = false;
let flushTimer: ReturnType<typeof setInterval> | undefined;
let pruneTimer: ReturnType<typeof setInterval> | undefined;
let registered = false;

/**
 * Records produced by the act of viewing the log itself. Persisting them would
 * make the viewer's own polling the loudest thing in the table, so we drop
 * them from the DB sink (they still hit the console).
 */
function isSelfNoise(record: LogRecord): boolean {
  const proc = record.fields.proc;
  return typeof proc === "string" && proc.startsWith("logs.");
}

function tenantKeyForRecord(record: LogRecord): string | null {
  const tenant = record.fields.tenant;
  return typeof tenant === "string" && tenant.trim() !== "" ? tenant : null;
}

function tenantForLogRecord(record: LogRecord): Tenant {
  const primary = primaryTenant();
  const key = tenantKeyForRecord(record);
  if (key === primary.key) return primary;
  if (key) return findTenantByKey(key) ?? primary;
  return primary;
}

function dbForLogTenant(tenant: Tenant): DB {
  return tenant.key === primaryTenant().key ? db() : dbForTenant(tenant.databaseUrl);
}

function toRow(record: LogRecord) {
  const { requestId, proc, actorEmail, ...rest } = record.fields;
  return {
    createdAt: record.time,
    level: record.level,
    message: record.message,
    requestId: typeof requestId === "string" ? requestId : null,
    proc: typeof proc === "string" ? proc : null,
    actorEmail: typeof actorEmail === "string" ? actorEmail : null,
    fields: rest,
    pid: process.pid,
    hostname: HOST,
  };
}

async function flush(): Promise<void> {
  if (flushing || buffer.length === 0) return;
  flushing = true;
  try {
    while (buffer.length > 0) {
      const batch = buffer.splice(0, FLUSH_BATCH);
      if (dropped > 0) {
        // Surface the loss once per flush, straight to the console so we don't
        // recurse through the logger. Then reset the counter.
        console.error(`[log-sink-db] dropped ${dropped} buffered log records (buffer full)`);
        dropped = 0;
      }
      const groups = new Map<string, { tenant: Tenant; records: LogRecord[] }>();
      for (const record of batch) {
        const tenant = tenantForLogRecord(record);
        const existing = groups.get(tenant.key);
        if (existing) existing.records.push(record);
        else groups.set(tenant.key, { tenant, records: [record] });
      }
      for (const { tenant, records } of groups.values()) {
        try {
          await dbForLogTenant(tenant).insert(appLogTable).values(records.map(toRow));
        } catch (err) {
          // The rows are gone; re-queuing risks an unbounded crash loop if the
          // table itself is the problem. Report once, drop the group, move on.
          console.error(
            `[log-sink-db] failed to persist ${records.length} log records for tenant ${tenant.key}:`,
            err instanceof Error ? err.message : String(err),
          );
        }
      }
    }
  } finally {
    flushing = false;
  }
}

async function prune(): Promise<void> {
  const { retentionDays, maxRows } = logSinkConfig();
  const tenants = (() => {
    try {
      return listTenants();
    } catch (err) {
      console.error(
        "[log-sink-db] tenant list failed during retention prune; falling back to primary tenant:",
        err instanceof Error ? err.message : String(err),
      );
      return [primaryTenant()];
    }
  })();
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  for (const tenant of tenants) {
    const tenantDb = dbForLogTenant(tenant);
    try {
      await tenantDb.delete(appLogTable).where(lt(appLogTable.createdAt, cutoff));
      // Enforce the absolute row cap regardless of age: keep the newest `maxRows`.
      await tenantDb.execute(sql`
        delete from ${appLogTable}
        where ${appLogTable.id} in (
          select id from ${appLogTable}
          order by ${appLogTable.createdAt} desc
          offset ${maxRows}
        )
      `);
    } catch (err) {
      console.error(
        `[log-sink-db] retention prune failed for tenant ${tenant.key}:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}

const dbSink: LogSink = {
  name: "postgres",
  get minLevel() {
    return logSinkConfig().level;
  },
  write(record) {
    if (isSelfNoise(record)) return;
    buffer.push(record);
    if (buffer.length > MAX_BUFFER) {
      // Drop the oldest to stay bounded. The newest records are the ones most
      // worth keeping when something is going wrong fast.
      buffer.splice(0, buffer.length - MAX_BUFFER);
      dropped += 1;
    }
    if (buffer.length >= FLUSH_TRIGGER) void flush();
  },
  async flush() {
    await flush();
  },
};

/**
 * Attach the Postgres log sink and start its flush/prune timers. Idempotent
 * and safe to call on every request; only the first call does anything.
 * No-ops when disabled (LOG_DB_DISABLED=1) or under test.
 */
export function registerDbLogSink(): void {
  if (registered) return;
  registered = true;
  if (!logSinkConfig().enabled) return;

  registerSink(dbSink);

  flushTimer = setInterval(() => void flush(), FLUSH_INTERVAL_MS);
  pruneTimer = setInterval(() => void prune(), PRUNE_INTERVAL_MS);
  // `unref` so these timers never keep the process alive on their own.
  flushTimer.unref?.();
  pruneTimer.unref?.();
  // One prune shortly after boot trims whatever accumulated while we were down.
  setTimeout(() => void prune(), 30_000).unref?.();

  // Best-effort drain on shutdown so the last few records aren't lost.
  const drain = () => {
    void flush();
  };
  process.once("SIGTERM", drain);
  process.once("SIGINT", drain);
  process.once("beforeExit", drain);
}

export const __test = {
  dbForLogTenant,
  tenantForLogRecord,
  tenantKeyForRecord,
};
