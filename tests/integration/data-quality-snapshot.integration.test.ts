import { call } from "@orpc/server";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Session } from "~/server/auth/auth";
import { runDataQualitySnapshot } from "~/server/data-quality/snapshot";
import { db } from "~/server/db/client";
import { contractsTable } from "~/server/db/schema/contracts";
import { dataQualitySnapshotsTable } from "~/server/db/schema/data-quality-snapshots";
import { membersTable } from "~/server/db/schema/members";
import { sepaMandatesTable } from "~/server/db/schema/sepa";
import { memberTasksTable } from "~/server/db/schema/tasks";
import type { AppContext } from "~/server/orpc/context";
import { appRouter } from "~/server/orpc/router";

/**
 * Issue #81: the nightly data-quality snapshot writes a per-rule count for the
 * day and opens an Aufgabe on each member affected by an error-severity rule,
 * idempotently. The trend is then queryable.
 *
 * The error rule exercised here is `mandat_abgelaufen` (active Lastschrift
 * contract + an expired active SEPA mandate). `mitgliedsnummer_kollision` — the
 * other error rule — cannot be set up since migration 0048 forbids the state.
 *
 * Runs only against the throwaway test database (bun run test:int).
 */
const onTestDb = process.env.DATABASE_URL?.includes("svuwv_test") ?? false;
const MARKER = `DQSnap-${Date.now()}`;
const MANDAT_TITLE = "Datenqualität: SEPA-Mandat abgelaufen";
const RULE_ID = "mandat_abgelaufen";

function authedContext(): AppContext {
  const session = {
    session: { id: "test", userId: "test" },
    user: { id: "test", email: "test@test.local", role: "vorstand" },
  } as unknown as Session;
  return {
    db: db(),
    session,
    headers: new Headers(),
    tenant: { key: "svu", databaseUrl: "" },
    requestId: "dq-snap-test",
  };
}

describe.skipIf(!onTestDb)("data-quality nightly snapshot (integration)", () => {
  const memberIds: string[] = [];
  const today = new Date().toISOString().slice(0, 10);

  beforeAll(async () => {
    const [maxRow] = await db()
      .select({ max: sql<number>`coalesce(max(${membersTable.adrNr}), 0)::int` })
      .from(membersTable);
    const adr = (maxRow?.max ?? 0) + 1;
    const past = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);

    // Live member with an active direct-debit contract and an expired, still
    // "Aktiv" SEPA mandate => the error-severity `mandat_abgelaufen` rule flags
    // it, so the snapshot must open a task on it.
    const [m] = await db()
      .insert(membersTable)
      .values({ adrNr: adr, nachname: MARKER, vorname: "Expired", memberNo: `${MARKER}-M` })
      .returning({ id: membersTable.id });
    if (!m) throw new Error("seed failed");
    memberIds.push(m.id);
    await db()
      .insert(contractsTable)
      .values({
        memberId: m.id,
        adrNr: adr,
        vertragNr: `${MARKER}-V`,
        art: 1,
        isDirectDebit: true,
        // Positiver Betrag: 0-EUR-Verträge lösen die Mandat-Regeln bewusst
        // nicht mehr aus.
        betrag: "60",
      });
    await db()
      .insert(sepaMandatesTable)
      .values({
        memberId: m.id,
        adrNr: adr,
        mandatsNr: `${MARKER}-MAN`,
        status: "Aktiv",
        isDeleted: false,
        gultigBis: past,
      });
  });

  afterAll(async () => {
    for (const id of memberIds) {
      await db().delete(membersTable).where(eq(membersTable.id, id));
    }
  });

  const openMandatTasks = async (memberId: string): Promise<number> => {
    const rows = await db()
      .select({ id: memberTasksTable.id })
      .from(memberTasksTable)
      .where(
        and(
          eq(memberTasksTable.memberId, memberId),
          eq(memberTasksTable.title, MANDAT_TITLE),
          eq(memberTasksTable.status, "open"),
        ),
      );
    return rows.length;
  };

  it("writes a per-rule snapshot row and opens one task per affected member", async () => {
    const res = await runDataQualitySnapshot(db());
    expect(res.date).toBe(today);
    expect(res.tasksCreated).toBeGreaterThanOrEqual(1);

    const [snap] = await db()
      .select({ count: dataQualitySnapshotsTable.count })
      .from(dataQualitySnapshotsTable)
      .where(
        and(
          eq(dataQualitySnapshotsTable.snapshotDate, today),
          eq(dataQualitySnapshotsTable.ruleId, RULE_ID),
        ),
      );
    expect(snap).toBeDefined();
    expect(snap?.count ?? 0).toBeGreaterThanOrEqual(1);

    for (const id of memberIds) {
      expect(await openMandatTasks(id)).toBe(1);
    }
  });

  it("is idempotent: a re-run does not duplicate the task or the snapshot row", async () => {
    await runDataQualitySnapshot(db());
    for (const id of memberIds) {
      expect(await openMandatTasks(id)).toBe(1);
    }
    const rows = await db()
      .select({ id: dataQualitySnapshotsTable.id })
      .from(dataQualitySnapshotsTable)
      .where(
        and(
          eq(dataQualitySnapshotsTable.snapshotDate, today),
          eq(dataQualitySnapshotsTable.ruleId, RULE_ID),
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
