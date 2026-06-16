import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "~/server/db/client";
import { membersTable } from "~/server/db/schema/members";
import { relationshipsTable } from "~/server/db/schema/relationships";
import { runIngest } from "~/server/importer/ingest-pipeline";

/**
 * The legal representative (`ist_vertreter`) is an app-side curation decision,
 * set when nachtragend a minor's SEPA mandate. Linear has no such concept, so
 * the importer must NOT strip it on a routine re-import: it replaces verkn rows
 * wholesale (delete by AdrNr + re-insert) but skips `ist_vertreter` rows, and
 * the re-insert never carries the column, so a flag on a row that still exists
 * in Linear is left untouched too.
 *
 * Runs only against the throwaway test database (bun run test:int).
 */
const onTestDb = process.env.DATABASE_URL?.includes("svuwv_test") ?? false;
const MARKER = `IngestVertreter-${Date.now()}`;

describe.skipIf(!onTestDb)("ingest keeps ist_vertreter across re-import (integration)", () => {
  const adrNrs: number[] = [];

  beforeAll(async () => {
    const [maxRow] = await db()
      .select({ max: sql<number>`coalesce(max(${membersTable.adrNr}), 0)::int` })
      .from(membersTable);
    const baseAdr = (maxRow?.max ?? 0) + 1;
    const minorAdr = baseAdr;
    const adultAdr = baseAdr + 1;
    const contactAdr = baseAdr + 2;
    adrNrs.push(minorAdr, adultAdr, contactAdr);

    const [minor] = await db()
      .insert(membersTable)
      .values({ adrNr: minorAdr, nachname: MARKER, vorname: "Kind", memberNo: `${MARKER}-K` })
      .returning({ id: membersTable.id });
    const [adult] = await db()
      .insert(membersTable)
      .values({ adrNr: adultAdr, nachname: MARKER, vorname: "Eltern", memberNo: `${MARKER}-E` })
      .returning({ id: membersTable.id });
    const [contact] = await db()
      .insert(membersTable)
      .values({ adrNr: contactAdr, nachname: MARKER, vorname: "Kontakt", kontaktNo: `${MARKER}-C` })
      .returning({ id: membersTable.id });
    if (!minor || !adult || !contact) throw new Error("seed failed");

    // A: Linear-backed verkn we flagged as Vertreter (both sides re-imported).
    await db().insert(relationshipsTable).values({
      fromMemberId: minor.id,
      toMemberId: adult.id,
      fromAdrNr: minorAdr,
      toAdrNr: adultAdr,
      beziehung: "Familie",
      istVertreter: true,
    });
    // B: app-created Vertreter to a contact Linear never knew about.
    await db().insert(relationshipsTable).values({
      fromMemberId: minor.id,
      toMemberId: contact.id,
      fromAdrNr: minorAdr,
      toAdrNr: contactAdr,
      beziehung: "Zahler",
      istVertreter: true,
    });
    // C: a plain Linear verkn, no flag — should be replaced as before.
    await db().insert(relationshipsTable).values({
      fromMemberId: adult.id,
      toMemberId: minor.id,
      fromAdrNr: adultAdr,
      toAdrNr: minorAdr,
      beziehung: "Familie",
      istVertreter: false,
    });
  });

  afterAll(async () => {
    for (const adr of adrNrs) {
      await db().delete(relationshipsTable).where(eq(relationshipsTable.fromAdrNr, adr));
      await db().delete(relationshipsTable).where(eq(relationshipsTable.toAdrNr, adr));
      await db().delete(membersTable).where(eq(membersTable.adrNr, adr));
    }
  });

  it("preserves ist_vertreter on both Linear-backed and app-created rows", async () => {
    const [minorAdr, adultAdr, contactAdr] = adrNrs as [number, number, number];

    // Re-import as Linear would deliver it: reciprocal verkn pairs, no flag.
    await runIngest(
      db(),
      {
        source: "sql_upload",
        relationships: [
          { AdrNr: minorAdr, Verkn: adultAdr, Beziehung: "Familie" },
          { AdrNr: adultAdr, Verkn: minorAdr, Beziehung: "Familie" },
        ],
      },
      "svu",
    );

    const rows = await db()
      .select({
        fromAdrNr: relationshipsTable.fromAdrNr,
        toAdrNr: relationshipsTable.toAdrNr,
        istVertreter: relationshipsTable.istVertreter,
      })
      .from(relationshipsTable)
      .where(eq(relationshipsTable.fromAdrNr, minorAdr));

    // A: Linear re-delivered minor->adult; flag survived the upsert.
    const a = rows.find((r) => r.toAdrNr === adultAdr);
    expect(a, "A minor->adult").toBeDefined();
    expect(a?.istVertreter).toBe(true);

    // B: app-created minor->contact has no Linear counterpart; survived intact.
    const b = rows.find((r) => r.toAdrNr === contactAdr);
    expect(b, "B minor->contact").toBeDefined();
    expect(b?.istVertreter).toBe(true);
  });

  it("still replaces a non-Vertreter verkn row", async () => {
    const [minorAdr, adultAdr] = adrNrs as [number, number, number];
    const [c] = await db()
      .select({ istVertreter: relationshipsTable.istVertreter })
      .from(relationshipsTable)
      .where(eq(relationshipsTable.fromAdrNr, adultAdr));
    // The unflagged adult->minor verkn was deleted and re-inserted from Linear.
    expect(c?.istVertreter).toBe(false);
    expect(minorAdr).toBeGreaterThan(0);
  });
});
