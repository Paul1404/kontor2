import { eq, isNull } from "drizzle-orm";
import type postgres from "postgres";
import { runWithTenantKeyring } from "~/server/crypto/tenant-crypto";
import { runDataQualitySnapshot } from "~/server/data-quality/snapshot";
import { type DB, db, dbForTenant, sql, sqlForTenant } from "~/server/db/client";
import { membersTable } from "~/server/db/schema/members";
import { memberSnapshotsTable, snapshotRunsTable } from "~/server/db/schema/snapshots";
import { reconcileMemberStatuses } from "~/server/domain/member-status-reconcile";
import { logger } from "~/server/lib/logger";
import { takeMemberSnapshot } from "~/server/snapshots/snapshot";
import { loadTenants } from "~/server/tenants/load";
import { primaryTenant } from "~/server/tenants/resolve";

type TenantHandle = { key: string; handle: DB; conn: postgres.Sql };

/**
 * Resolve a DB + raw-sql handle for every tenant. The primary Verein uses the
 * process DATABASE_URL pool (db()/sql()); every other Verein gets its own pool,
 * mirroring the auth layer. The nightly run iterates these so all Vereine get
 * snapshots and status reconcile, not just the primary.
 */
async function tenantHandles(): Promise<TenantHandle[]> {
  const tenants = await loadTenants();
  const primaryKey = primaryTenant().key;
  return tenants.map((t) => {
    const isPrimary = t.key === primaryKey;
    return {
      key: t.key,
      handle: isPrimary ? db() : dbForTenant(t.databaseUrl),
      conn: isPrimary ? sql() : sqlForTenant(t.databaseUrl),
    };
  });
}

// Postgres advisory-lock key. Picked at random; just needs to be the same
// integer across replicas so only one process can hold it concurrently.
const ADVISORY_LOCK_KEY = 7_421_001;

const BATCH_SIZE = 50;

let scheduledTimeout: NodeJS.Timeout | null = null;

function nextRunAt(now: Date = new Date()): Date {
  // Run at 02:30 local time (Europe/Berlin in production). Using the local
  // process TZ is intentional — Railway runs UTC; admins can override via
  // the TZ env var if a different local time is desired.
  const next = new Date(now);
  next.setHours(2, 30, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next;
}

type SnapshotResult = {
  runId: string | null;
  memberCount: number;
  skippedCount: number;
  bytesTotal: number;
  acquiredLock: boolean;
};

type SnapshotOpts = {
  actorEmail?: string;
  notes?: string;
  trigger?: "nightly" | "manual" | "pre_import";
};

/**
 * Run the member snapshot for ALL tenants, aggregating the totals. Each tenant
 * runs against its own database under its own advisory lock (locks are
 * per-database, so the same key never collides across tenants).
 */
export async function runNightlySnapshot(opts: SnapshotOpts = {}): Promise<SnapshotResult> {
  const totals: SnapshotResult = {
    runId: null,
    memberCount: 0,
    skippedCount: 0,
    bytesTotal: 0,
    acquiredLock: false,
  };
  for (const t of await tenantHandles()) {
    try {
      const r = await runWithTenantKeyring(t.key, () => runTenantSnapshot(t.handle, t.conn, opts));
      totals.acquiredLock = totals.acquiredLock || r.acquiredLock;
      totals.memberCount += r.memberCount;
      totals.skippedCount += r.skippedCount;
      totals.bytesTotal += r.bytesTotal;
      if (r.runId) totals.runId = r.runId;
    } catch (err) {
      logger.error("tenant snapshot failed", {
        tenant: t.key,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return totals;
}

async function runTenantSnapshot(
  handle: DB,
  conn: postgres.Sql,
  opts: SnapshotOpts = {},
): Promise<SnapshotResult> {
  const trigger = opts.trigger ?? "nightly";

  // Session-level advisory locks live on a specific backend connection, so
  // they must be acquired and released on the SAME connection. With a pooled
  // client the unlock would otherwise run on a different connection (no-op),
  // leaking the lock and blocking every future run. Reserve one connection
  // for the whole run and release the lock on it explicitly.
  const lock = await conn.reserve();
  const acquired = await lock`select pg_try_advisory_lock(${ADVISORY_LOCK_KEY}::bigint) as ok`;
  const ok = Boolean((acquired as unknown as Array<{ ok: boolean }>)[0]?.ok);
  if (!ok) {
    lock.release();
    return { runId: null, memberCount: 0, skippedCount: 0, bytesTotal: 0, acquiredLock: false };
  }

  try {
    const [run] = await handle
      .insert(snapshotRunsTable)
      .values({
        trigger,
        actorEmail: opts.actorEmail ?? null,
        notes: opts.notes ?? null,
      })
      .returning({ id: snapshotRunsTable.id });
    if (!run) {
      return { runId: null, memberCount: 0, skippedCount: 0, bytesTotal: 0, acquiredLock: true };
    }

    const members = await handle
      .select({ id: membersTable.id })
      .from(membersTable)
      .where(isNull(membersTable.deletedAt));

    let memberCount = 0;
    let skippedCount = 0;
    let bytesTotal = 0;

    for (let i = 0; i < members.length; i += BATCH_SIZE) {
      const slice = members.slice(i, i + BATCH_SIZE);
      await Promise.all(
        slice.map(async (m) => {
          const result = await handle.transaction(async (tx) => {
            return takeMemberSnapshot(tx, m.id, {
              trigger,
              runId: run.id,
              skipIfUnchanged: true,
              actorEmail: opts.actorEmail ?? null,
            });
          });
          if (result.skipped) {
            skippedCount += 1;
          } else if (result.snapshotId) {
            memberCount += 1;
          }
        }),
      );
    }

    // Tally bytes for the run footer. Cheap aggregate; if it grows large
    // we can switch to a streaming count.
    const sizeRows = await handle
      .select({ byteSize: memberSnapshotsTable.byteSize })
      .from(memberSnapshotsTable)
      .where(eq(memberSnapshotsTable.runId, run.id));
    bytesTotal = sizeRows.reduce((sum, r) => sum + (r.byteSize ?? 0), 0);

    await handle
      .update(snapshotRunsTable)
      .set({ finishedAt: new Date(), memberCount, bytesTotal })
      .where(eq(snapshotRunsTable.id, run.id));

    // Data-quality snapshot + error->task wiring (issue #81). Runs under the
    // same advisory lock so only one replica writes it. Best-effort: a failure
    // here must not fail the member-snapshot run.
    try {
      const dq = await runDataQualitySnapshot(handle);
      logger.info("data quality snapshot", {
        date: dq.date,
        total: dq.total,
        tasksCreated: dq.tasksCreated,
      });
    } catch (err) {
      logger.error("data quality snapshot failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return { runId: run.id, memberCount, skippedCount, bytesTotal, acquiredLock: true };
  } finally {
    await lock`select pg_advisory_unlock(${ADVISORY_LOCK_KEY}::bigint)`;
    lock.release();
  }
}

/**
 * Reconcile member status to the calendar (flip scheduled exits/deaths that
 * have come due). Logged once, swallowing errors so a hiccup never blocks the
 * snapshot run that follows it.
 */
async function runStatusReconcile(): Promise<void> {
  for (const t of await tenantHandles()) {
    try {
      const { exited, deceased } = await runWithTenantKeyring(t.key, () =>
        reconcileMemberStatuses(t.handle),
      );
      if (exited > 0 || deceased > 0) {
        logger.info("member status reconciled", { tenant: t.key, exited, deceased });
      }
    } catch (err) {
      logger.error("member status reconcile failed", {
        tenant: t.key,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

export function startSnapshotScheduler(): void {
  if (process.env.SNAPSHOT_CRON_DISABLED === "1") {
    logger.info("snapshot scheduler disabled", { reason: "SNAPSHOT_CRON_DISABLED=1" });
    return;
  }
  if (scheduledTimeout) return; // already started

  // Catch any exits/deaths whose date passed while the process was down, so the
  // stored status is correct without waiting for the 02:30 run.
  void runStatusReconcile();

  function schedule() {
    const next = nextRunAt();
    const delayMs = next.getTime() - Date.now();
    logger.info("nightly snapshot scheduled", {
      at: next.toISOString(),
      inMinutes: Math.round(delayMs / 60000),
    });
    scheduledTimeout = setTimeout(async () => {
      scheduledTimeout = null;
      try {
        await runStatusReconcile();
        const result = await runNightlySnapshot({ actorEmail: "system:scheduler" });
        if (result.acquiredLock) {
          logger.info("nightly snapshot run", {
            runId: result.runId ?? "noop",
            created: result.memberCount,
            unchanged: result.skippedCount,
            kb: Math.round(result.bytesTotal / 1024),
          });
        } else {
          logger.info("nightly snapshot skipped", { reason: "another replica holds the lock" });
        }
      } catch (err) {
        logger.error("nightly snapshot failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        schedule();
      }
    }, delayMs);
    // Don't keep the event loop alive purely for this timer.
    scheduledTimeout.unref?.();
  }
  schedule();
}

/**
 * Cancel the pending nightly-snapshot timer, if any. Called on graceful
 * shutdown so a run can't fire against a pool that's being torn down. Safe to
 * call when the scheduler was never started.
 */
export function stopSnapshotScheduler(): void {
  if (scheduledTimeout) {
    clearTimeout(scheduledTimeout);
    scheduledTimeout = null;
  }
}
