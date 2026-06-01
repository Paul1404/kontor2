import { eq, isNull } from "drizzle-orm";
import { db, sql } from "~/server/db/client";
import { membersTable } from "~/server/db/schema/members";
import { memberSnapshotsTable, snapshotRunsTable } from "~/server/db/schema/snapshots";
import { logger } from "~/server/lib/logger";
import { takeMemberSnapshot } from "~/server/snapshots/snapshot";

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

export async function runNightlySnapshot(
  opts: { actorEmail?: string; notes?: string; trigger?: "nightly" | "manual" | "pre_import" } = {},
): Promise<{
  runId: string | null;
  memberCount: number;
  skippedCount: number;
  bytesTotal: number;
  acquiredLock: boolean;
}> {
  const trigger = opts.trigger ?? "nightly";
  const handle = db();

  // Session-level advisory locks live on a specific backend connection, so
  // they must be acquired and released on the SAME connection. With a pooled
  // client the unlock would otherwise run on a different connection (no-op),
  // leaking the lock and blocking every future run. Reserve one connection
  // for the whole run and release the lock on it explicitly.
  const lock = await sql().reserve();
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

    return { runId: run.id, memberCount, skippedCount, bytesTotal, acquiredLock: true };
  } finally {
    await lock`select pg_advisory_unlock(${ADVISORY_LOCK_KEY}::bigint)`;
    lock.release();
  }
}

export function startSnapshotScheduler(): void {
  if (process.env.SNAPSHOT_CRON_DISABLED === "1") {
    logger.info("snapshot scheduler disabled", { reason: "SNAPSHOT_CRON_DISABLED=1" });
    return;
  }
  if (scheduledTimeout) return; // already started

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
