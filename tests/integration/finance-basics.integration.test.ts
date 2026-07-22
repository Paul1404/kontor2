import { call } from "@orpc/server";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Session } from "~/server/auth/auth";
import { db } from "~/server/db/client";
import { users } from "~/server/db/schema/auth";
import { contractsTable } from "~/server/db/schema/contracts";
import { feeRunsTable, sollStellungenTable } from "~/server/db/schema/fee-runs";
import { membersTable } from "~/server/db/schema/members";
import { organizationSettingsTable } from "~/server/db/schema/organization-settings";
import type { AppContext } from "~/server/orpc/context";
import { appRouter } from "~/server/orpc/router";

const onTestDb = process.env.DATABASE_URL?.includes("svuwv_test") ?? false;
const MARKER = `FinanceBasics-${Date.now()}`;
const ACTOR_ID = `${MARKER}-actor`;
const YEAR = 2096;

function vorstandContext(): AppContext {
  const session = {
    session: { id: "test", userId: ACTOR_ID },
    user: { id: ACTOR_ID, email: "finance-basics@test.local", role: "vorstand" },
  } as unknown as Session;
  return {
    db: db(),
    session,
    headers: new Headers(),
    tenant: { key: "svu", databaseUrl: "" },
    requestId: "finance-basics-int-test",
  };
}

describe.skipIf(!onTestDb)("basic finance regressions (integration)", () => {
  let memberId = "";
  let invoiceContractId = "";
  let runId = "";

  beforeAll(async () => {
    await db()
      .insert(users)
      .values({
        id: ACTOR_ID,
        name: "Finance Basics Integration",
        email: "finance-basics@test.local",
        emailVerified: true,
        role: "vorstand",
      })
      .onConflictDoNothing();
    await db()
      .insert(organizationSettingsTable)
      .values({
        id: 1,
        vereinsname: "Testverein",
        glaeubigerId: "DE98ZZZ09999999999",
        vereinsIban: "DE89370400440532013000",
        vereinsIbanLast4: "3000",
        vereinsBic: "COBADEFFXXX",
      })
      .onConflictDoNothing();

    const [maxRow] = await db()
      .select({ max: sql<number>`coalesce(max(${membersTable.adrNr}), 0)::int` })
      .from(membersTable);
    const adrNr = (maxRow?.max ?? 0) + 1;
    const [member] = await db()
      .insert(membersTable)
      .values({
        adrNr,
        nachname: MARKER,
        vorname: "Rechnung",
        memberNo: `${MARKER}-M`,
        status: "aktiv",
        geburtsdatum: new Date(`${YEAR - 40}-05-10T00:00:00Z`),
        austritt: new Date(`${YEAR}-09-30T00:00:00Z`),
      })
      .returning({ id: membersTable.id });
    memberId = member?.id ?? "";
    const [contract] = await db()
      .insert(contractsTable)
      .values({
        memberId,
        adrNr,
        vertragNr: `${MARKER}-invoice`,
        art: 7001,
        artName: "Rechnung",
        betrag: "60",
        vertragBegin: new Date(`${YEAR}-01-01T00:00:00Z`),
        isDirectDebit: false,
      })
      .returning({ id: contractsTable.id });
    invoiceContractId = contract?.id ?? "";
  });

  afterAll(async () => {
    if (runId) await db().delete(feeRunsTable).where(eq(feeRunsTable.id, runId));
    if (memberId) await db().delete(membersTable).where(eq(membersTable.id, memberId));
    await db().delete(users).where(eq(users.id, ACTOR_ID));
  });

  it("defaults API-created contracts to Lastschrift", async () => {
    const created = await call(
      appRouter.contracts.create,
      {
        memberId,
        patch: { vertragNr: `${MARKER}-default`, art: 7002, betrag: "0" },
      },
      { context: vorstandContext() },
    );
    const [row] = await db()
      .select({ isDirectDebit: contractsTable.isDirectDebit })
      .from(contractsTable)
      .where(eq(contractsTable.id, created.id));
    expect(row?.isDirectDebit).toBe(true);
  });

  it("includes a member whose exit is after the requested birthday", async () => {
    const result = await call(
      appRouter.reports.geburtstage,
      { month: 5, year: YEAR },
      { context: vorstandContext() },
    );
    expect(result.rows.some((row) => row.id === memberId)).toBe(true);
  });

  it("commits an invoice-only run, refuses a partial cancellation, then excludes the cancelled posting from finance reports", async () => {
    const preview = await call(
      appRouter.feeRuns.preview,
      { billingYear: YEAR, falligkeitsdatum: `${YEAR}-03-15` },
      { context: vorstandContext() },
    );
    expect(preview.candidates).toHaveLength(0);
    expect(preview.invoices.some((item) => item.contractId === invoiceContractId)).toBe(true);

    const committed = await call(
      appRouter.feeRuns.commit,
      {
        billingYear: YEAR,
        falligkeitsdatum: `${YEAR}-03-15`,
        expectedItemCount: preview.totals.count,
        expectedTotalAmount: preview.totals.grandTotal,
      },
      { context: vorstandContext() },
    );
    runId = committed.feeRunId;
    expect(committed.xmlFilename).toBeNull();
    expect(committed.invoiceCount).toBe(1);

    const [posting] = await db()
      .select({ id: sollStellungenTable.id })
      .from(sollStellungenTable)
      .where(
        and(
          eq(sollStellungenTable.contractId, invoiceContractId),
          eq(sollStellungenTable.billingYear, YEAR),
        ),
      );
    await db()
      .update(sollStellungenTable)
      .set({ paidAmount: "1", openAmount: "59" })
      .where(eq(sollStellungenTable.id, posting!.id));
    await expect(
      call(appRouter.feeRuns.cancel, { id: runId }, { context: vorstandContext() }),
    ).rejects.toThrow(/nicht vollständig storniert/);

    await db()
      .update(sollStellungenTable)
      .set({ paidAmount: "0", openAmount: "60" })
      .where(eq(sollStellungenTable.id, posting!.id));
    await call(appRouter.feeRuns.cancel, { id: runId }, { context: vorstandContext() });

    const report = await call(
      appRouter.reports.finanzbericht,
      { year: YEAR },
      { context: vorstandContext() },
    );
    expect(Number(report.totals.billed)).toBe(0);
    expect(Number(report.totals.open)).toBe(0);
    expect(report.totals.count).toBe(0);
  });
});
