import { call } from "@orpc/server";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Session } from "~/server/auth/auth";
import { db } from "~/server/db/client";
import { users } from "~/server/db/schema/auth";
import { contractsTable } from "~/server/db/schema/contracts";
import { membersTable } from "~/server/db/schema/members";
import type { AppContext } from "~/server/orpc/context";
import { appRouter } from "~/server/orpc/router";

/**
 * Inline-Korrektur eines Vertrags aus dem Datenqualitäts-Befund: Betrag setzen
 * und die fälschlich gesetzte Lastschrift-Markierung entfernen (beitragsfrei).
 *
 * Runs only against the throwaway test database (bun run test:int).
 */
const onTestDb = process.env.DATABASE_URL?.includes("svuwv_test") ?? false;
const MARKER = `QuickFix-${Date.now()}`;
// quickFix writes an audit_log row, whose actor_id has an FK to users -- so the
// acting user must really exist (seeded in beforeAll).
const ACTOR_ID = `${MARKER}-actor`;

function authedContext(): AppContext {
  const session = {
    session: { id: "test", userId: ACTOR_ID },
    user: { id: ACTOR_ID, email: "quickfix-actor@test.local", role: "vorstand" },
  } as unknown as Session;
  return {
    db: db(),
    session,
    headers: new Headers(),
    tenant: { key: "svu", databaseUrl: "" },
    requestId: "quickfix-test",
  };
}

describe.skipIf(!onTestDb)("contracts.quickFix (integration)", () => {
  let contractId = "";
  let memberId = "";
  let adr = 0;

  beforeAll(async () => {
    await db()
      .insert(users)
      .values({
        id: ACTOR_ID,
        name: "QuickFix Integration",
        email: "quickfix-actor@test.local",
        emailVerified: true,
        role: "vorstand",
      })
      .onConflictDoNothing();

    const [maxRow] = await db()
      .select({ max: sql<number>`coalesce(max(${membersTable.adrNr}), 0)::int` })
      .from(membersTable);
    adr = (maxRow?.max ?? 0) + 1;
    const [m] = await db()
      .insert(membersTable)
      .values({ adrNr: adr, nachname: MARKER, vorname: "Fix", memberNo: `${MARKER}-M` })
      .returning({ id: membersTable.id });
    if (!m) throw new Error("seed failed");
    memberId = m.id;
    // A 0-EUR contract wrongly flagged as direct debit -- the noise case.
    const [c] = await db()
      .insert(contractsTable)
      .values({
        memberId,
        adrNr: adr,
        vertragNr: `${MARKER}-V`,
        art: 1,
        betrag: "0",
        isDirectDebit: true,
      })
      .returning({ id: contractsTable.id });
    if (!c) throw new Error("seed failed");
    contractId = c.id;
  });

  afterAll(async () => {
    await db().delete(contractsTable).where(eq(contractsTable.memberId, memberId));
    await db().delete(membersTable).where(eq(membersTable.id, memberId));
    await db().delete(users).where(eq(users.id, ACTOR_ID));
  });

  it("sets the Betrag and clears the Lastschrift flag", async () => {
    await call(
      appRouter.contracts.quickFix,
      { id: contractId, betrag: "60" },
      { context: authedContext() },
    );
    await call(
      appRouter.contracts.quickFix,
      { id: contractId, isDirectDebit: false },
      { context: authedContext() },
    );

    const [row] = await db()
      .select({ betrag: contractsTable.betrag, isDirectDebit: contractsTable.isDirectDebit })
      .from(contractsTable)
      .where(eq(contractsTable.id, contractId));
    expect(Number(row?.betrag)).toBe(60);
    expect(row?.isDirectDebit).toBe(false);
  });
});
