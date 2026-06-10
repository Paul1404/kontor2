import { call } from "@orpc/server";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Session } from "~/server/auth/auth";
import { runDataQualitySnapshot } from "~/server/data-quality/snapshot";
import { db } from "~/server/db/client";
import { dataQualitySnapshotsTable } from "~/server/db/schema/data-quality-snapshots";
import { membersTable } from "~/server/db/schema/members";
import { memberTasksTable } from "~/server/db/schema/tasks";
import type { AppContext } from "~/server/orpc/context";
import { appRouter } from "~/server/orpc/router";

/**
 * Issue #81: the nightly data-quality snapshot writes a per-rule count for the
 * day and opens an Aufgabe on each member affected by an error-severity rule,
 * idempotently. The trend is then queryable.
 *
 * Runs only against the throwaway test database (bun run test:int).
 */
const onTestDb = process.env.DATABASE_URL?.includes("svuwv_test") ?? false;
const MARKER = `DQSnap-${Date.now()}`;
const KOLLISION_TITLE = "Datenqualität: Mitgliedsnummer doppelt vergeben";

function authedContext(): AppContext {
  const session = {
    session: { id: "test", userId: "test" },
    user: { id: "test", email: "test@test.local", role: "vorstand" },
  } as unknown as Session;
  return { db: db(), session, headers: new Headers(), requestId: "dq-snap-test" };
}

describe.skipIf(!onTestDb)("data-quality nightly snapshot (integration)", () => {
  const memberIds: string[] = [];
  const today = new Date().toISOString().slice(0, 10);

  beforeAll(async () => {
    const [maxRow] = await db()
      .select({ max: sql<number>`coalesce(max(${membersTable.adrNr}), 0)::int` })
      .from(membersTable);
    let adr = (maxRow?.max ?? 0) + 1;
    // Two non-deleted records with the same Mitgliedsnummer => the error-severity
    // rule `mitgliedsnummer_kollision` flags both.
    for (const v of ["a", "b"]) {
      const [m] = await db()
        .insert(membersTable)
        .values({ adrNr: adr++, nachname: MARKER, vorname: v, mitgliedsnummer: `${MARKER}-COLL` })
        .returning({ id: membersTable.id });
      if (m) memberIds.push(m.id);
    }
  });

  afterAll(async () => {
    for (const id of memberIds) {
      await db().delete(membersTable).where(eq(membersTable.id, id));
    }
  });

  const openKollisionTasks = async (memberId: string): Promise<number> => {
    const rows = await db()
      .select({ id: memberTasksTable.id })
      .from(memberTasksTable)
      .where(
        and(
          eq(memberTasksTable.memberId, memberId),
          eq(memberTasksTable.title, KOLLISION_TITLE),
          eq(memberTasksTable.status, "open"),
        ),
      );
    return rows.length;
  };

  it("writes a per-rule snapshot row and opens one task per affected member", async () => {
    const res = await runDataQualitySnapshot(db());
    expect(res.date).toBe(today);
    expect(res.tasksCreated).toBeGreaterThanOrEqual(2);

    const [snap] = await db()
      .select({ count: dataQualitySnapshotsTable.count })
      .from(dataQualitySnapshotsTable)
      .where(
        and(
          eq(dataQualitySnapshotsTable.snapshotDate, today),
          eq(dataQualitySnapshotsTable.ruleId, "mitgliedsnummer_kollision"),
        ),
      );
    expect(snap).toBeDefined();
    expect(snap?.count ?? 0).toBeGreaterThanOrEqual(2);

    for (const id of memberIds) {
      expect(await openKollisionTasks(id)).toBe(1);
    }
  });

  it("is idempotent: a re-run does not duplicate the task or the snapshot row", async () => {
    await runDataQualitySnapshot(db());
    for (const id of memberIds) {
      expect(await openKollisionTasks(id)).toBe(1);
    }
    const rows = await db()
      .select({ id: dataQualitySnapshotsTable.id })
      .from(dataQualitySnapshotsTable)
      .where(
        and(
          eq(dataQualitySnapshotsTable.snapshotDate, today),
          eq(dataQualitySnapshotsTable.ruleId, "mitgliedsnummer_kollision"),
        ),
      );
    expect(rows.length).toBe(1);
  });

  it("exposes the trend via dashboard.insights", async () => {
    const insights = (await call(appRouter.dashboard.insights, undefined, {
      context: authedContext(),
    })) as { datenqualitaetVerlauf: { date: string; total: number }[] };
    expect(Array.isArray(insights.datenqualitaetVerlauf)).toBe(true);
  });
});
