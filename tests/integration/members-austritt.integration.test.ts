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
 * Regression for the Austritt crash: members.austritt terminated the member's
 * contracts with `gekuendAm: sql\`coalesce(gekuend_am, ${austrittTs})\``, where
 * `austrittTs` was a Date. In a raw SQL fragment the `date` column mapper does
 * not run, so the driver got a Date and threw ERR_INVALID_ARG_TYPE. A unit test
 * never hits this because it does not touch a real database; this integration
 * test runs the actual query and would have caught it.
 *
 * Runs only against the throwaway test database (bun run test:int).
 */
const onTestDb = process.env.DATABASE_URL?.includes("svuwv_test") ?? false;
const MARKER = `AustrittInt-${Date.now()}`;
// austritt writes an audit_log row whose actor_id has an FK to users.
const ACTOR_ID = `${MARKER}-actor`;

function vorstandContext(): AppContext {
  const session = {
    session: { id: "test", userId: ACTOR_ID },
    user: { id: ACTOR_ID, email: "austritt-actor@test.local", role: "vorstand" },
  } as unknown as Session;
  return {
    db: db(),
    session,
    headers: new Headers(),
    tenant: { key: "svu", databaseUrl: "" },
    requestId: "austritt-int-test",
  };
}

describe.skipIf(!onTestDb)("members.austritt (integration)", () => {
  let memberId = "";
  let contractId = "";

  beforeAll(async () => {
    await db()
      .insert(users)
      .values({
        id: ACTOR_ID,
        name: "Austritt Integration",
        email: "austritt-actor@test.local",
        emailVerified: true,
        role: "vorstand",
      })
      .onConflictDoNothing();

    const [maxRow] = await db()
      .select({ max: sql<number>`coalesce(max(${membersTable.adrNr}), 0)::int` })
      .from(membersTable);
    const adrNr = (maxRow?.max ?? 0) + 1;

    const [m] = await db()
      .insert(membersTable)
      .values({
        adrNr,
        nachname: MARKER,
        vorname: "Austritt",
        memberNo: `${MARKER}-M`,
        status: "aktiv",
      })
      .returning({ id: membersTable.id });
    memberId = m?.id ?? "";

    // A contract WITHOUT gekuend_am -- this is what drives the coalesce path.
    const [c] = await db()
      .insert(contractsTable)
      .values({
        memberId,
        adrNr,
        mitglNr: `${MARKER}-M`,
        vertragNr: "1",
        art: 100,
        betrag: "54.00000000",
        isDirectDebit: true,
      } as never)
      .returning({ id: contractsTable.id });
    contractId = c?.id ?? "";
  });

  afterAll(async () => {
    // Cascades to the contract via the member FK.
    if (memberId) await db().delete(membersTable).where(eq(membersTable.id, memberId));
    await db().delete(users).where(eq(users.id, ACTOR_ID));
  });

  it("records the cancellation and terminates the contract without a driver error", async () => {
    const austrittDatum = "2027-12-31";
    const res = await call(
      appRouter.members.austritt,
      { memberId, austrittDatum },
      { context: vorstandContext() },
    );
    expect(res).toBeDefined();

    const [contract] = await db()
      .select()
      .from(contractsTable)
      .where(eq(contractsTable.id, contractId))
      .limit(1);
    // The date columns come back as Date objects; compare the calendar day.
    const day = (v: unknown) =>
      v instanceof Date ? v.toISOString().slice(0, 10) : (v as string | null);
    expect(day(contract?.gekuendZum)).toBe(austrittDatum);
    expect(day(contract?.vertragEnde)).toBe(austrittDatum);
    // The coalesce set the notice date (was null) instead of throwing.
    expect(contract?.gekuendAm).toBeTruthy();

    const [member] = await db()
      .select()
      .from(membersTable)
      .where(eq(membersTable.id, memberId))
      .limit(1);
    expect(member?.austritt).toBeTruthy();
  });
});
