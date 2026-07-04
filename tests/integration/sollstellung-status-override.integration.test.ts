import { call } from "@orpc/server";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Session } from "~/server/auth/auth";
import { db } from "~/server/db/client";
import { users } from "~/server/db/schema/auth";
import { contractsTable } from "~/server/db/schema/contracts";
import { sollStellungenTable } from "~/server/db/schema/fee-runs";
import { membersTable } from "~/server/db/schema/members";
import type { AppContext } from "~/server/orpc/context";
import { appRouter } from "~/server/orpc/router";

/**
 * feeRuns.setSollstellungStatus is the manual status override. It must move a
 * posting between open / eingezogen / paid / cancelled and keep paidAmount and
 * openAmount consistent each time. The gap this fills: a posting booked as
 * `paid` had no way back to `eingezogen` or `open` in the UI.
 *
 * Runs only against the throwaway test database (bun run test:int).
 */
const onTestDb = process.env.DATABASE_URL?.includes("svuwv_test") ?? false;
const MARKER = `SollStatus-${Date.now()}`;
const ACTOR_ID = `${MARKER}-actor`;
const AMOUNT = "54.00000000";

function vorstandContext(): AppContext {
  const session = {
    session: { id: "test", userId: ACTOR_ID },
    user: { id: ACTOR_ID, email: "sollstatus-actor@test.local", role: "vorstand" },
  } as unknown as Session;
  return {
    db: db(),
    session,
    headers: new Headers(),
    tenant: { key: "svu", databaseUrl: "" },
    requestId: "sollstatus-int-test",
  };
}

async function reload(id: string) {
  const [row] = await db()
    .select({
      status: sollStellungenTable.status,
      paidAmount: sollStellungenTable.paidAmount,
      openAmount: sollStellungenTable.openAmount,
    })
    .from(sollStellungenTable)
    .where(eq(sollStellungenTable.id, id))
    .limit(1);
  return row;
}

describe.skipIf(!onTestDb)("feeRuns.setSollstellungStatus (integration)", () => {
  let memberId = "";
  let sollId = "";

  beforeAll(async () => {
    await db()
      .insert(users)
      .values({
        id: ACTOR_ID,
        name: "Sollstatus Integration",
        email: "sollstatus-actor@test.local",
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
        vorname: "Status",
        memberNo: `${MARKER}-M`,
        status: "aktiv",
      })
      .returning({ id: membersTable.id });
    memberId = m?.id ?? "";

    const [c] = await db()
      .insert(contractsTable)
      .values({
        memberId,
        adrNr,
        vertragNr: "1",
        art: 100,
        betrag: AMOUNT,
        isDirectDebit: true,
      } as never)
      .returning({ id: contractsTable.id });

    // Start life as a settled ("paid") posting -- the case with no way back.
    const [s] = await db()
      .insert(sollStellungenTable)
      .values({
        memberId,
        contractId: c?.id ?? "",
        billingYear: 2097,
        falligkeitsdatum: "2097-01-15",
        amount: AMOUNT,
        paidAmount: AMOUNT,
        openAmount: "0",
        status: "paid",
      })
      .returning({ id: sollStellungenTable.id });
    sollId = s?.id ?? "";
  });

  afterAll(async () => {
    if (memberId) await db().delete(membersTable).where(eq(membersTable.id, memberId));
    await db().delete(users).where(eq(users.id, ACTOR_ID));
  });

  it("resets paid -> eingezogen -> open -> cancelled with consistent amounts", async () => {
    const set = (status: "open" | "eingezogen" | "paid" | "cancelled") =>
      call(
        appRouter.feeRuns.setSollstellungStatus,
        { sollStellungId: sollId, status },
        { context: vorstandContext() },
      );

    // paid -> eingezogen: still counts as collected, nothing open.
    let res = await set("eingezogen");
    expect(res.changed).toBe(true);
    let row = await reload(sollId);
    expect(row?.status).toBe("eingezogen");
    expect(Number(row?.paidAmount)).toBe(54);
    expect(Number(row?.openAmount)).toBe(0);

    // eingezogen -> open: full amount owed again, dunnable.
    res = await set("open");
    expect(res.changed).toBe(true);
    row = await reload(sollId);
    expect(row?.status).toBe("open");
    expect(Number(row?.paidAmount)).toBe(0);
    expect(Number(row?.openAmount)).toBe(54);

    // open -> cancelled: neither open nor paid.
    res = await set("cancelled");
    expect(res.changed).toBe(true);
    row = await reload(sollId);
    expect(row?.status).toBe("cancelled");
    expect(Number(row?.paidAmount)).toBe(0);
    expect(Number(row?.openAmount)).toBe(0);

    // Setting the same status again is a no-op.
    res = await set("cancelled");
    expect(res.changed).toBe(false);
  });
});
