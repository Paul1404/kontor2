import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "~/server/db/client";
import { contractsTable } from "~/server/db/schema/contracts";
import { membersTable } from "~/server/db/schema/members";
import { buildFeeRunPreview } from "~/server/sepa/build-fee-run";

/**
 * Beitragslauf: ein Rechnungszahler (is_direct_debit = false, Betrag > 0) wird
 * nicht mehr ausgeschlossen, sondern als Rechnung gefuehrt -- beim Commit
 * entstuende daraus eine offene Sollstellung.
 *
 * Runs only against the throwaway test database (bun run test:int).
 */
const onTestDb = process.env.DATABASE_URL?.includes("svuwv_test") ?? false;
const MARKER = `FeeInvoice-${Date.now()}`;
const YEAR = 2099;

describe.skipIf(!onTestDb)("Beitragslauf fuehrt Rechnungszahler als Rechnung (integration)", () => {
  let memberId = "";
  let contractId = "";

  beforeAll(async () => {
    const [maxRow] = await db()
      .select({ max: sql<number>`coalesce(max(${membersTable.adrNr}), 0)::int` })
      .from(membersTable);
    const adr = (maxRow?.max ?? 0) + 1;
    const [m] = await db()
      .insert(membersTable)
      .values({ adrNr: adr, nachname: MARKER, vorname: "Rechnung", memberNo: `${MARKER}-M` })
      .returning({ id: membersTable.id });
    if (!m) throw new Error("seed failed");
    memberId = m.id;
    const [c] = await db()
      .insert(contractsTable)
      .values({
        memberId,
        adrNr: adr,
        vertragNr: `${MARKER}-V`,
        art: 1,
        artName: "Erwachsene",
        betrag: "60",
        isDirectDebit: false,
      })
      .returning({ id: contractsTable.id });
    if (!c) throw new Error("seed failed");
    contractId = c.id;
  });

  afterAll(async () => {
    await db().delete(contractsTable).where(eq(contractsTable.memberId, memberId));
    await db().delete(membersTable).where(eq(membersTable.id, memberId));
  });

  it("listet den Rechnungszahler unter invoices, nicht unter excluded", async () => {
    const preview = await buildFeeRunPreview(db(), {
      billingYear: YEAR,
      falligkeitsdatum: new Date(`${YEAR}-03-01`),
    });

    const invoice = preview.invoices.find((i) => i.contractId === contractId);
    expect(invoice).toBeTruthy();
    expect(Number(invoice?.amount)).toBe(60);

    // Nicht als Lastschrift-Kandidat und nicht mit Grund "Lastschrift nicht aktiv".
    expect(preview.candidates.find((c) => c.contractId === contractId)).toBeFalsy();
    expect(
      preview.excluded.find(
        (e) => e.contractId === contractId && e.reason === "Lastschrift nicht aktiv",
      ),
    ).toBeFalsy();
    expect(preview.totals.invoiceCount).toBeGreaterThanOrEqual(1);
  });
});
