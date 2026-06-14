import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "~/server/db/client";
import { contractsTable } from "~/server/db/schema/contracts";
import { membersTable } from "~/server/db/schema/members";
import { runIngest } from "~/server/importer/ingest-pipeline";

/**
 * Zahler-Konzept Stufe 2: the explicit per-contract Zahler-Override lives only
 * in the app, not in Linear. The importer replaces contracts wholesale
 * (delete by AdrNr + re-insert), so it must carry the override back onto the
 * re-inserted row by its stable Linear key (AdrNr, VertragNr, Art) — otherwise
 * a routine re-import silently wipes it.
 *
 * Runs only against the throwaway test database (bun run test:int).
 */
const onTestDb = process.env.DATABASE_URL?.includes("svuwv_test") ?? false;
const MARKER = `IngestZahler-${Date.now()}`;

describe.skipIf(!onTestDb)("ingest preserves explicit Zahler-Override (integration)", () => {
  const adrNrs: number[] = [];

  beforeAll(async () => {
    const [maxRow] = await db()
      .select({ max: sql<number>`coalesce(max(${membersTable.adrNr}), 0)::int` })
      .from(membersTable);
    const baseAdr = (maxRow?.max ?? 0) + 1;
    const memberAdr = baseAdr;
    const zahlerAdr = baseAdr + 1;
    adrNrs.push(memberAdr, zahlerAdr);

    const [zahler] = await db()
      .insert(membersTable)
      .values({ adrNr: zahlerAdr, nachname: MARKER, vorname: "Zahler", memberNo: `${MARKER}-Z` })
      .returning({ id: membersTable.id });
    const [member] = await db()
      .insert(membersTable)
      .values({ adrNr: memberAdr, nachname: MARKER, vorname: "Mitglied", memberNo: `${MARKER}-M` })
      .returning({ id: membersTable.id });
    if (!zahler || !member) throw new Error("seed failed");

    // Contract with an explicit override pointing at the Zahler member.
    await db().insert(contractsTable).values({
      memberId: member.id,
      zahlerMemberId: zahler.id,
      adrNr: memberAdr,
      vertragNr: "V1",
      art: 1,
      betrag: "60",
      isDirectDebit: true,
    });
  });

  afterAll(async () => {
    for (const adr of adrNrs) {
      await db().delete(contractsTable).where(eq(contractsTable.adrNr, adr));
      await db().delete(membersTable).where(eq(membersTable.adrNr, adr));
    }
  });

  it("carries zahler_member_id onto the re-inserted contract row", async () => {
    const memberAdr = adrNrs[0] as number;
    const [zahler] = await db()
      .select({ id: membersTable.id })
      .from(membersTable)
      .where(eq(membersTable.adrNr, adrNrs[1] as number));

    const before = await db()
      .select({ id: contractsTable.id, zahlerMemberId: contractsTable.zahlerMemberId })
      .from(contractsTable)
      .where(eq(contractsTable.adrNr, memberAdr));
    expect(before).toHaveLength(1);
    expect(before[0]?.zahlerMemberId).toBe(zahler?.id);

    // Re-import the same contract as Linear would deliver it: no Zahler field.
    await runIngest(
      db(),
      {
        source: "sql_upload",
        contracts: [{ AdrNr: memberAdr, VertragNr: "V1", Art: 1, Betrag: "60" }],
      },
      "svu",
    );

    const after = await db()
      .select({ id: contractsTable.id, zahlerMemberId: contractsTable.zahlerMemberId })
      .from(contractsTable)
      .where(eq(contractsTable.adrNr, memberAdr));
    expect(after).toHaveLength(1);
    // The row was actually replaced (delete + insert), not skipped.
    expect(after[0]?.id).not.toBe(before[0]?.id);
    // …but the explicit override survived the round-trip.
    expect(after[0]?.zahlerMemberId).toBe(zahler?.id);
  });

  it("leaves the override null when the contract had none", async () => {
    const memberAdr = adrNrs[0] as number;
    const [member] = await db()
      .select({ id: membersTable.id })
      .from(membersTable)
      .where(eq(membersTable.adrNr, memberAdr));

    // A second contract on the same member without any override.
    await db()
      .insert(contractsTable)
      .values({
        memberId: member?.id as string,
        adrNr: memberAdr,
        vertragNr: "V2",
        art: 2,
        betrag: "30",
        isDirectDebit: true,
      });

    await runIngest(
      db(),
      {
        source: "sql_upload",
        contracts: [
          { AdrNr: memberAdr, VertragNr: "V1", Art: 1, Betrag: "60" },
          { AdrNr: memberAdr, VertragNr: "V2", Art: 2, Betrag: "30" },
        ],
      },
      "svu",
    );

    const [v2] = await db()
      .select({ zahlerMemberId: contractsTable.zahlerMemberId })
      .from(contractsTable)
      .where(and(eq(contractsTable.adrNr, memberAdr), eq(contractsTable.vertragNr, "V2")));
    expect(v2?.zahlerMemberId).toBeNull();
  });
});
