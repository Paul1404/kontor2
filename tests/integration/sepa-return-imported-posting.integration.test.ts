import { call } from "@orpc/server";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Session } from "~/server/auth/auth";
import { db } from "~/server/db/client";
import { users } from "~/server/db/schema/auth";
import { contractsTable } from "~/server/db/schema/contracts";
import { sepaReturnsTable } from "~/server/db/schema/dunning";
import { feeRunItemsTable, feeRunsTable, sollStellungenTable } from "~/server/db/schema/fee-runs";
import { membersTable } from "~/server/db/schema/members";
import { sepaMandatesTable } from "~/server/db/schema/sepa";
import type { AppContext } from "~/server/orpc/context";
import { appRouter } from "~/server/orpc/router";

/**
 * Advanced Rückläufer path: an imported "eingezogen" posting that never went
 * through an app SEPA run (no fee_run_item) can still be recorded as a return,
 * anchored on the Sollstellung alone. The normal candidates list only shows app
 * debits; postingCandidates surfaces the imported ones. A posting that DOES have
 * a fee_run_item must be refused here (it belongs to the normal flow).
 *
 * Runs only against the throwaway test database (bun run test:int).
 */
const onTestDb = process.env.DATABASE_URL?.includes("svuwv_test") ?? false;
const MARKER = `RetImport-${Date.now()}`;
const ACTOR_ID = `${MARKER}-actor`;
const AMOUNT = "54.00000000";

function vorstandContext(): AppContext {
  const session = {
    session: { id: "test", userId: ACTOR_ID },
    user: { id: ACTOR_ID, email: "retimport-actor@test.local", role: "vorstand" },
  } as unknown as Session;
  return {
    db: db(),
    session,
    headers: new Headers(),
    tenant: { key: "svu", databaseUrl: "" },
    requestId: "retimport-int-test",
  };
}

describe.skipIf(!onTestDb)("sepaReturns imported-posting path (integration)", () => {
  let memberId = "";
  let importedSollId = "";
  let appSollId = "";
  let runId = "";

  beforeAll(async () => {
    await db()
      .insert(users)
      .values({
        id: ACTOR_ID,
        name: "RetImport Integration",
        email: "retimport-actor@test.local",
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
      .values({ adrNr, nachname: MARKER, vorname: "Ret", memberNo: `${MARKER}-M`, status: "aktiv" })
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
    const contractId = c?.id ?? "";

    // Imported posting: eingezogen, NO fee_run_item.
    const [imp] = await db()
      .insert(sollStellungenTable)
      .values({
        memberId,
        contractId,
        billingYear: 2094,
        falligkeitsdatum: "2094-01-15",
        amount: AMOUNT,
        paidAmount: AMOUNT,
        openAmount: "0",
        status: "eingezogen",
      })
      .returning({ id: sollStellungenTable.id });
    importedSollId = imp?.id ?? "";

    // App-collected posting: eingezogen WITH a fee_run_item (must be refused by
    // the imported path). Needs a committed run + mandate + item.
    const [mand] = await db()
      .insert(sepaMandatesTable)
      .values({ memberId, adrNr, mandatsNr: `${MARKER}-MND`, status: "aktiv" })
      .returning({ id: sepaMandatesTable.id });
    const [run] = await db()
      .insert(feeRunsTable)
      .values({ billingYear: 2095, falligkeitsdatum: "2095-01-15", status: "committed" })
      .returning({ id: feeRunsTable.id });
    runId = run?.id ?? "";
    const [app] = await db()
      .insert(sollStellungenTable)
      .values({
        memberId,
        contractId,
        billingYear: 2095,
        falligkeitsdatum: "2095-01-15",
        amount: AMOUNT,
        paidAmount: AMOUNT,
        openAmount: "0",
        status: "eingezogen",
        feeRunId: runId,
      })
      .returning({ id: sollStellungenTable.id });
    appSollId = app?.id ?? "";
    await db()
      .insert(feeRunItemsTable)
      .values({
        feeRunId: runId,
        memberId,
        contractId,
        sepaMandateId: mand?.id ?? "",
        sollStellungId: appSollId,
        amount: AMOUNT,
        purpose: "Beitrag",
        endToEndId: `${MARKER}-E2E`,
        sequenceType: "RCUR",
        mandateRef: `${MARKER}-MND`,
        debtorName: MARKER,
        debtorIbanLast4: "1234",
      });
  });

  afterAll(async () => {
    await db().delete(sepaReturnsTable).where(eq(sepaReturnsTable.memberId, memberId));
    if (runId) await db().delete(feeRunItemsTable).where(eq(feeRunItemsTable.feeRunId, runId));
    await db().delete(sollStellungenTable).where(eq(sollStellungenTable.memberId, memberId));
    if (runId) await db().delete(feeRunsTable).where(eq(feeRunsTable.id, runId));
    if (memberId) await db().delete(membersTable).where(eq(membersTable.id, memberId));
    await db().delete(users).where(eq(users.id, ACTOR_ID));
  });

  it("lists only the imported posting as a posting candidate", async () => {
    const cands = await call(
      appRouter.sepaReturns.postingCandidates,
      { query: MARKER, limit: 50 },
      { context: vorstandContext() },
    );
    const ids = cands.map((c) => c.sollStellungId);
    expect(ids).toContain(importedSollId);
    // The app-collected one has a fee_run_item, so it is NOT a posting candidate.
    expect(ids).not.toContain(appSollId);
  });

  it("refuses an app-collected posting on the imported path", async () => {
    await expect(
      call(
        appRouter.sepaReturns.createForPosting,
        { sollStellungId: appSollId, returnedOn: "2094-02-01", reasonCode: "AM04" },
        { context: vorstandContext() },
      ),
    ).rejects.toThrow();
  });

  it("records the imported return, reopens the posting, shows it in the list, then undoes it", async () => {
    const res = await call(
      appRouter.sepaReturns.createForPosting,
      {
        sollStellungId: importedSollId,
        returnedOn: "2094-02-01",
        reasonCode: "AM04",
        rueckgebuhr: "3.00",
      },
      { context: vorstandContext() },
    );
    expect(res.id).toBeTruthy();

    // sepa_returns row: no fee_run_item, anchored on the Sollstellung.
    const [ret] = await db()
      .select({
        feeRunItemId: sepaReturnsTable.feeRunItemId,
        sollStellungId: sepaReturnsTable.sollStellungId,
      })
      .from(sepaReturnsTable)
      .where(eq(sepaReturnsTable.id, res.id))
      .limit(1);
    expect(ret?.feeRunItemId).toBeNull();
    expect(ret?.sollStellungId).toBe(importedSollId);

    // Posting reopened to a live claim.
    const [soll] = await db()
      .select({
        status: sollStellungenTable.status,
        paidAmount: sollStellungenTable.paidAmount,
        openAmount: sollStellungenTable.openAmount,
        mahnstufe: sollStellungenTable.mahnstufe,
      })
      .from(sollStellungenTable)
      .where(eq(sollStellungenTable.id, importedSollId))
      .limit(1);
    expect(soll?.status).toBe("returned");
    expect(Number(soll?.paidAmount)).toBe(0);
    expect(Number(soll?.openAmount)).toBe(54);
    expect(soll?.mahnstufe).toBe(0);

    // Appears in the returns list with amount + Beitragsjahr from the posting.
    const list = await call(
      appRouter.sepaReturns.list,
      { page: 1, pageSize: 100, memberId },
      { context: vorstandContext() },
    );
    const listed = list.rows.find((r) => r.id === res.id);
    expect(listed).toBeTruthy();
    expect(Number(listed?.amount)).toBe(54);
    expect(listed?.billingYear).toBe(2094);

    // Second attempt on the same posting is refused.
    await expect(
      call(
        appRouter.sepaReturns.createForPosting,
        { sollStellungId: importedSollId, returnedOn: "2094-02-01" },
        { context: vorstandContext() },
      ),
    ).rejects.toThrow();

    // Undo restores the posting to eingezogen.
    await call(appRouter.sepaReturns.delete, { id: res.id }, { context: vorstandContext() });
    const [restored] = await db()
      .select({ status: sollStellungenTable.status, openAmount: sollStellungenTable.openAmount })
      .from(sollStellungenTable)
      .where(eq(sollStellungenTable.id, importedSollId))
      .limit(1);
    expect(restored?.status).toBe("eingezogen");
    expect(Number(restored?.openAmount)).toBe(0);
  });
});
