import { sql } from "drizzle-orm";
import type { DB } from "~/server/db/client";
import { dataQualitySnapshotsTable } from "~/server/db/schema/data-quality-snapshots";
import { activeWhere, dataQualityCounts } from "~/server/orpc/procedures/data-quality";

/**
 * Nightly data-quality snapshot (issue #81).
 *
 *  1. Persist a per-rule count for the day, so the dashboard can show a
 *     "Datenqualität über Zeit" trend and a bad import shows up as a spike.
 *  2. For every `error`-severity rule, open an Aufgabe on each affected member
 *     that does not already have one (deduped by the per-rule task title).
 *
 * Both steps are idempotent: the snapshot upserts on (snapshot_date, rule_id),
 * and the task insert skips members that already carry an open task for the
 * rule. Called from the nightly scheduler while it holds the advisory lock, so
 * only one replica ever runs it.
 */
const TASK_ACTOR_EMAIL = "system:datenqualitaet";

function taskTitle(label: string): string {
  return `Datenqualität: ${label}`;
}

export async function runDataQualitySnapshot(
  db: DB,
  opts: { date?: string; createErrorTasks?: boolean } = {},
): Promise<{ date: string; total: number; tasksCreated: number }> {
  const date = opts.date ?? new Date().toISOString().slice(0, 10);
  const createErrorTasks = opts.createErrorTasks ?? true;

  const counts = await dataQualityCounts(db);

  if (counts.length > 0) {
    await db
      .insert(dataQualitySnapshotsTable)
      .values(
        counts.map((c) => ({
          snapshotDate: date,
          ruleId: c.id,
          severity: c.severity,
          count: c.count,
        })),
      )
      .onConflictDoUpdate({
        target: [dataQualitySnapshotsTable.snapshotDate, dataQualitySnapshotsTable.ruleId],
        set: { count: sql`excluded.count`, severity: sql`excluded.severity` },
      });
  }

  let tasksCreated = 0;
  if (createErrorTasks) {
    for (const c of counts) {
      if (c.severity !== "error" || c.count === 0) continue;
      const title = taskTitle(c.label);
      const notes = c.description;
      // `members` is intentionally NOT aliased: the rule WHERE clauses reference
      // `members.id`/bare columns, which would break under an alias. The clause
      // carries no user input (composed from the fixed registry). `activeWhere`
      // also drops members whose finding was marked "geprüft".
      const res = await db.execute(sql`
        insert into member_tasks (member_id, title, notes, created_by_email)
        select members.id, ${title}, ${notes}, ${TASK_ACTOR_EMAIL}
        from members
        where ${sql.raw(activeWhere(c.id))}
          and not exists (
            select 1 from member_tasks t
            where t.member_id = members.id and t.title = ${title} and t.status = 'open'
          )
        returning id
      `);
      tasksCreated += (res as unknown as unknown[]).length;
    }
  }

  const total = counts.reduce((sum, c) => sum + c.count, 0);
  return { date, total, tasksCreated };
}
