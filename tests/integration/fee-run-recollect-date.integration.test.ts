import { call } from "@orpc/server";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Session } from "~/server/auth/auth";
import { db } from "~/server/db/client";
import { users } from "~/server/db/schema/auth";
import { contractsTable } from "~/server/db/schema/contracts";
import { feeRunItemsTable, feeRunsTable, sollStellungenTable } from "~/server/db/schema/fee-runs";
import { membersTable } from "~/server/db/schema/members";
import { sepaMandatesTable } from "~/server/db/schema/sepa";
import type { AppContext } from "~/server/orpc/context";
import { appRouter } from "~/server/orpc/router";
import { nextCollectionDate } from "~/server/sepa/business-days";

/**
 * fee-runs.updateCollectionDate rewrites the stored pain.008 in place: it swaps
 * every <ReqdColltnDt> and the <CreDtTm> to a fresh date and syncs the linked
 * Sollstellungen. It works by string replace on the XML, which is exactly the
 * kind of logic that breaks silently. This exercises the whole path against a
 * real database: a committed run with a stale collection date is re-dated to the
 * next bank business day, and both the XML and the posting must move with it.
 *
 * Runs only against the throwaway test database (bun run test:int).
 */
const onTestDb = process.env.DATABASE_URL?.includes("svuwv_test") ?? false;
const MARKER = `RecollectDate-${Date.now()}`;
const ACTOR_ID = `${MARKER}-actor`;
const YEAR = 2098;
// A past, in-the-past collection date the run should never keep.
const STALE_DATE = "2020-01-06";
const STALE_CRE = "2020-01-01T09:00:00";

function vorstandContext(): AppContext {
  const session = {
    session: { id: "test", userId: ACTOR_ID },
    user: { id: ACTOR_ID, email: "recollect-actor@test.local", role: "vorstand" },
  } as unknown as Session;
  return {
    db: db(),
    session,
    headers: new Headers(),
    tenant: { key: "svu", databaseUrl: "" },
    requestId: "recollect-int-test",
  };
}

// Two ReqdColltnDt (FRST + RCUR blocks) prove the global replace hits both.
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<Document>
  <CstmrDrctDbtInitn>
    <GrpHdr><CreDtTm>${STALE_CRE}</CreDtTm></GrpHdr>
    <PmtInf><ReqdColltnDt>${STALE_DATE}</ReqdColltnDt></PmtInf>
    <PmtInf><ReqdColltnDt>${STALE_DATE}</ReqdColltnDt></PmtInf>
  </CstmrDrctDbtInitn>
</Document>`;

describe.skipIf(!onTestDb)("fee-runs.updateCollectionDate (integration)", () => {
  let memberId = "";
  let contractId = "";
  let mandateId = "";
  let runId = "";
  let sollId = "";

  beforeAll(async () => {
    await db()
      .insert(users)
      .values({
        id: ACTOR_ID,
        name: "Recollect Integration",
        email: "recollect-actor@test.local",
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
        vorname: "Recollect",
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
        betrag: "54.00000000",
        isDirectDebit: true,
      } as never)
      .returning({ id: contractsTable.id });
    contractId = c?.id ?? "";

    const [mand] = await db()
      .insert(sepaMandatesTable)
      .values({ memberId, adrNr, mandatsNr: `${MARKER}-MND`, status: "aktiv" })
      .returning({ id: sepaMandatesTable.id });
    mandateId = mand?.id ?? "";

    const [run] = await db()
      .insert(feeRunsTable)
      .values({
        billingYear: YEAR,
        falligkeitsdatum: STALE_DATE,
        status: "committed",
        xmlContent: XML,
        xmlFilename: "SEPA-old.xml",
        totalAmount: "54.00000000",
        itemCount: 1,
      })
      .returning({ id: feeRunsTable.id });
    runId = run?.id ?? "";

    const [soll] = await db()
      .insert(sollStellungenTable)
      .values({
        memberId,
        contractId,
        billingYear: YEAR,
        falligkeitsdatum: STALE_DATE,
        amount: "54.00000000",
        openAmount: "54.00000000",
        status: "pending",
        feeRunId: runId,
      })
      .returning({ id: sollStellungenTable.id });
    sollId = soll?.id ?? "";

    const [item] = await db()
      .insert(feeRunItemsTable)
      .values({
        feeRunId: runId,
        memberId,
        contractId,
        sepaMandateId: mandateId,
        sollStellungId: sollId,
        amount: "54.00000000",
        purpose: "Beitrag",
        endToEndId: `${MARKER}-E2E`,
        sequenceType: "RCUR",
        mandateRef: `${MARKER}-MND`,
        debtorName: MARKER,
        debtorIbanLast4: "1234",
      })
      .returning({ id: feeRunItemsTable.id });
    await db()
      .update(sollStellungenTable)
      .set({ lastFeeRunItemId: item?.id ?? null })
      .where(eq(sollStellungenTable.id, sollId));
  });

  afterAll(async () => {
    if (runId) await db().delete(feeRunItemsTable).where(eq(feeRunItemsTable.feeRunId, runId));
    if (sollId) await db().delete(sollStellungenTable).where(eq(sollStellungenTable.id, sollId));
    if (runId) await db().delete(feeRunsTable).where(eq(feeRunsTable.id, runId));
    if (memberId) await db().delete(membersTable).where(eq(membersTable.id, memberId));
    await db().delete(users).where(eq(users.id, ACTOR_ID));
  });

  it("re-dates the XML and the linked Sollstellung to the next business day", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const expected = nextCollectionDate(today, 1);

    const res = await call(
      appRouter.feeRuns.updateCollectionDate,
      { id: runId },
      { context: vorstandContext() },
    );
    expect(res.ok).toBe(true);
    expect(res.falligkeitsdatum).toBe(expected);

    const [run] = await db().select().from(feeRunsTable).where(eq(feeRunsTable.id, runId)).limit(1);
    // Both ReqdColltnDt moved; the stale date is gone entirely.
    expect(run?.xmlContent).not.toContain(STALE_DATE);
    expect(run?.xmlContent).not.toContain(STALE_CRE);
    const matches = run?.xmlContent?.match(/<ReqdColltnDt>[^<]*<\/ReqdColltnDt>/g) ?? [];
    expect(matches).toHaveLength(2);
    expect(matches.every((m) => m === `<ReqdColltnDt>${expected}</ReqdColltnDt>`)).toBe(true);
    expect(String(run?.falligkeitsdatum).slice(0, 10)).toBe(expected);

    const [soll] = await db()
      .select()
      .from(sollStellungenTable)
      .where(eq(sollStellungenTable.id, sollId))
      .limit(1);
    expect(String(soll?.falligkeitsdatum).slice(0, 10)).toBe(expected);
  });

  it("rejects a collection date in the past", async () => {
    await expect(
      call(
        appRouter.feeRuns.updateCollectionDate,
        { id: runId, falligkeitsdatum: STALE_DATE },
        { context: vorstandContext() },
      ),
    ).rejects.toThrow();
  });

  it("keeps the debit pending until explicit bank submission", async () => {
    const [before] = await db()
      .select({ status: sollStellungenTable.status, paid: sollStellungenTable.paidAmount })
      .from(sollStellungenTable)
      .where(eq(sollStellungenTable.id, sollId));
    expect(before).toMatchObject({ status: "pending" });
    expect(Number(before?.paid)).toBe(0);

    const beforeCandidates = await call(
      appRouter.sepaReturns.candidates,
      { query: MARKER, limit: 50 },
      { context: vorstandContext() },
    );
    expect(beforeCandidates).toHaveLength(0);

    const submitted = await call(
      appRouter.feeRuns.submit,
      { id: runId },
      { context: vorstandContext() },
    );
    expect(submitted).toEqual({ ok: true, changed: true });

    const [[run], [posting]] = await Promise.all([
      db()
        .select({ status: feeRunsTable.status })
        .from(feeRunsTable)
        .where(eq(feeRunsTable.id, runId)),
      db()
        .select({
          status: sollStellungenTable.status,
          paid: sollStellungenTable.paidAmount,
          open: sollStellungenTable.openAmount,
        })
        .from(sollStellungenTable)
        .where(eq(sollStellungenTable.id, sollId)),
    ]);
    expect(run?.status).toBe("submitted");
    expect(posting?.status).toBe("eingezogen");
    expect(Number(posting?.paid)).toBe(54);
    expect(Number(posting?.open)).toBe(0);

    const afterCandidates = await call(
      appRouter.sepaReturns.candidates,
      { query: MARKER, limit: 50 },
      { context: vorstandContext() },
    );
    expect(afterCandidates).toHaveLength(1);

    expect(
      await call(appRouter.feeRuns.submit, { id: runId }, { context: vorstandContext() }),
    ).toEqual({ ok: true, changed: false });
  });
});
