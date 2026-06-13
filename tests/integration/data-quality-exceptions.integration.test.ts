import { call } from "@orpc/server";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Session } from "~/server/auth/auth";
import { db } from "~/server/db/client";
import { dataQualityExceptionsTable } from "~/server/db/schema/data-quality-exceptions";
import { membersTable } from "~/server/db/schema/members";
import type { AppContext } from "~/server/orpc/context";
import { appRouter } from "~/server/orpc/router";

/**
 * A Vorstand can mark a data-quality finding as "geprüft" so it disappears from
 * the active list, the count and the export, while staying auditable and
 * reversible. Exercised end-to-end through the procedures.
 *
 * Runs only against the throwaway test database (bun run test:int).
 */
const onTestDb = process.env.DATABASE_URL?.includes("svuwv_test") ?? false;
const MARKER = `DQExc-${Date.now()}`;
const CATEGORY = "aktiv_ohne_vertrag" as const;

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
    requestId: "dq-exc-test",
  };
}

// Extracted so its return type does not depend on the loop's `cursor` local,
// which would otherwise make the page inference circular (TS7022).
function fetchPage(cursor: string | null) {
  return call(
    appRouter.dataQuality.list,
    { category: CATEGORY, cursor },
    { context: authedContext() },
  );
}

/** Walk every page of a category's drill-down and collect the member ids. */
async function listAllIds(): Promise<Set<string>> {
  const ids = new Set<string>();
  let cursor: string | null = null;
  do {
    const page = await fetchPage(cursor);
    for (const it of page.items) ids.add(it.id);
    cursor = page.nextCursor;
  } while (cursor);
  return ids;
}

describe.skipIf(!onTestDb)("data-quality exceptions (integration)", () => {
  let memberId = "";

  beforeAll(async () => {
    const [maxRow] = await db()
      .select({ max: sql<number>`coalesce(max(${membersTable.adrNr}), 0)::int` })
      .from(membersTable);
    const adr = (maxRow?.max ?? 0) + 1;
    // An active member with member_no but no contract matches `aktiv_ohne_vertrag`.
    const [m] = await db()
      .insert(membersTable)
      .values({ adrNr: adr, nachname: MARKER, vorname: "Ohne Vertrag", memberNo: `${MARKER}-M` })
      .returning({ id: membersTable.id });
    if (!m) throw new Error("seed failed");
    memberId = m.id;
  });

  afterAll(async () => {
    await db()
      .delete(dataQualityExceptionsTable)
      .where(eq(dataQualityExceptionsTable.memberId, memberId));
    await db().delete(membersTable).where(eq(membersTable.id, memberId));
  });

  it("hides an acknowledged finding from the list and surfaces it under Geprüft", async () => {
    // Before: the member shows up in the active drill-down.
    expect(await listAllIds()).toContain(memberId);

    await call(
      appRouter.dataQuality.acknowledge,
      { category: CATEGORY, memberId, reason: "zahlt über Familie" },
      { context: authedContext() },
    );

    // After: gone from the active list, present in the Geprüft list with reason.
    expect(await listAllIds()).not.toContain(memberId);
    const ack = await call(
      appRouter.dataQuality.acknowledged,
      { category: CATEGORY },
      { context: authedContext() },
    );
    const entry = ack.items.find((i) => i.id === memberId);
    expect(entry).toBeTruthy();
    expect(entry?.reason).toBe("zahlt über Familie");
  });

  it("re-opens the finding when the exception is withdrawn", async () => {
    await call(
      appRouter.dataQuality.unacknowledge,
      { category: CATEGORY, memberId },
      { context: authedContext() },
    );
    expect(await listAllIds()).toContain(memberId);
    const ack = await call(
      appRouter.dataQuality.acknowledged,
      { category: CATEGORY },
      { context: authedContext() },
    );
    expect(ack.items.find((i) => i.id === memberId)).toBeFalsy();
  });
});
