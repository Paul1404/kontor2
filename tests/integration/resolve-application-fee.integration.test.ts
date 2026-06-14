import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "~/server/db/client";
import { feeTypesTable } from "~/server/db/schema/fee-types";
import { DEFAULT_BEITRAGSSTAFFEL } from "~/server/db/schema/organization-settings";
import { resolveApplicationFee } from "~/server/domain/application/resolve-fee";

/**
 * resolveApplicationFee prefers a role-tagged Beitragsart's betrag1 and falls
 * back to the Beitragsstaffel when none is tagged.
 *
 * Runs only against the throwaway test database (bun run test:int).
 */
const onTestDb = process.env.DATABASE_URL?.includes("svuwv_test") ?? false;

describe.skipIf(!onTestDb)("resolveApplicationFee (integration)", () => {
  let art = 0;

  beforeAll(async () => {
    const [row] = await db()
      .select({ max: sql<number>`coalesce(max(${feeTypesTable.art}), 0)::int` })
      .from(feeTypesTable);
    art = (row?.max ?? 0) + 1;
    // A Beitragsart tagged for the "erwachsener" online-application role.
    await db()
      .insert(feeTypesTable)
      .values({ art, bezeichnung: "Erwachsene Aktiv", betrag1: "60", antragsRolle: "erwachsener" });
  });

  afterAll(async () => {
    await db().delete(feeTypesTable).where(eq(feeTypesTable.art, art));
  });

  it("quotes the tagged Beitragsart's betrag1 and returns its art", async () => {
    const fee = await resolveApplicationFee(db(), {
      kategorie: "erwachsener",
      elternteilMitglied: false,
      staffel: DEFAULT_BEITRAGSSTAFFEL,
    });
    expect(fee.art).toBe(art);
    expect(fee.betrag).toBe("60.00");
    expect(fee.label).toBe("Erwachsene Aktiv");
  });

  it("falls back to the Staffel for a role with no tagged Beitragsart", async () => {
    // No Beitragsart is tagged "familie", so the Staffel value is used.
    const fee = await resolveApplicationFee(db(), {
      kategorie: "familie",
      elternteilMitglied: false,
      staffel: DEFAULT_BEITRAGSSTAFFEL,
    });
    expect(fee.art).toBeNull();
    expect(fee.betrag).toBe(DEFAULT_BEITRAGSSTAFFEL.familie);
  });

  it("throws when neither a tagged Beitragsart nor a Staffel is available", async () => {
    await expect(
      resolveApplicationFee(db(), {
        kategorie: "kind",
        elternteilMitglied: false,
        staffel: null,
      }),
    ).rejects.toThrow();
  });
});
