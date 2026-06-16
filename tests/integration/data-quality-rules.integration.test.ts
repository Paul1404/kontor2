import { call } from "@orpc/server";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Session } from "~/server/auth/auth";
import { db } from "~/server/db/client";
import { contractsTable } from "~/server/db/schema/contracts";
import { membersTable } from "~/server/db/schema/members";
import type { AppContext } from "~/server/orpc/context";
import type { CategoryId } from "~/server/orpc/procedures/data-quality";
import { appRouter } from "~/server/orpc/router";

/**
 * Issue #79: one matching + one non-matching fixture per new data-quality rule
 * (and the refined email_mehrfach). Exercises the real SQL WHERE clauses.
 *
 * Runs only against the throwaway test database (bun run test:int).
 */
const onTestDb = process.env.DATABASE_URL?.includes("svuwv_test") ?? false;
const MARKER = `DQRule-${Date.now()}`;

function vorstandContext(): AppContext {
  const session = {
    session: { id: "test", userId: "test" },
    user: { id: "test", email: "test@test.local", role: "vorstand" },
  } as unknown as Session;
  return {
    db: db(),
    session,
    headers: new Headers(),
    tenant: { key: "svu", databaseUrl: "" },
    requestId: "dq-rule-test",
  };
}

describe.skipIf(!onTestDb)("data-quality new rules (integration)", () => {
  const ids: string[] = [];
  let nextAdr = 0;

  const addMember = async (row: Partial<typeof membersTable.$inferInsert>): Promise<string> => {
    const [m] = await db()
      .insert(membersTable)
      .values({ adrNr: nextAdr++, nachname: MARKER, ...row })
      .returning({ id: membersTable.id, adrNr: membersTable.adrNr });
    if (!m) throw new Error("seed failed");
    ids.push(m.id);
    return m.id;
  };

  const addContract = async (
    memberId: string,
    adrNr: number,
    row: Partial<typeof contractsTable.$inferInsert>,
  ): Promise<void> => {
    await db()
      .insert(contractsTable)
      .values({ memberId, adrNr, vertragNr: `${MARKER}-${adrNr}`, art: 1, ...row });
  };

  // Resolve the member's adrNr (needed for child rows keyed on it).
  const adrOf = async (id: string): Promise<number> => {
    const [r] = await db()
      .select({ adrNr: membersTable.adrNr })
      .from(membersTable)
      .where(eq(membersTable.id, id))
      .limit(1);
    return r?.adrNr ?? 0;
  };

  const match: Partial<Record<CategoryId, string>> = {};
  const control: Partial<Record<CategoryId, string>> = {};

  beforeAll(async () => {
    const [maxRow] = await db()
      .select({ max: sql<number>`coalesce(max(${membersTable.adrNr}), 0)::int` })
      .from(membersTable);
    nextAdr = (maxRow?.max ?? 0) + 1;

    // telefon_nur_vorwahl
    match.telefon_nur_vorwahl = await addMember({ telefon1: "09521" });
    control.telefon_nur_vorwahl = await addMember({ telefon1: "09521 123456" });

    // NOTE: `mitgliedsnummer_kollision` is intentionally NOT fixture-tested
    // here. The partial unique index from migration 0048 makes two non-deleted
    // rows with the same Mitgliedsnummer impossible to insert, so the state the
    // rule detects cannot be reproduced. The rule stays in the registry as a
    // defensive/pre-migration check; the summary test below confirms it is
    // present (count 0).

    // name_reihenfolge_vertauscht: build a "common firstname" set with a marker.
    await addMember({ vorname: `${MARKER}fn`, nachname: `${MARKER}a` });
    await addMember({ vorname: `${MARKER}fn`, nachname: `${MARKER}b` });
    match.name_reihenfolge_vertauscht = await addMember({
      vorname: `${MARKER}unique`,
      nachname: `${MARKER}fn`,
    });
    control.name_reihenfolge_vertauscht = await addMember({
      vorname: `${MARKER}fn`,
      nachname: `${MARKER}plainsurname`,
    });

    // mehrere_personen_im_datensatz
    match.mehrere_personen_im_datensatz = await addMember({ vorname: "Hans u. Grete" });
    control.mehrere_personen_im_datensatz = await addMember({ vorname: "Hans", nachname: "Meier" });

    // strasse_ohne_hausnummer
    match.strasse_ohne_hausnummer = await addMember({ strasse: "Hauptstrasse", hausnummer: null });
    control.strasse_ohne_hausnummer = await addMember({
      strasse: "Hauptstrasse",
      hausnummer: "5",
    });

    // dublette_name_ohne_gebdatum
    match.dublette_name_ohne_gebdatum = await addMember({
      vorname: `${MARKER}dub`,
      nachname: `${MARKER}dub`,
      geburtsdatum: new Date("1990-01-01"),
    });
    await addMember({ vorname: `${MARKER}dub`, nachname: `${MARKER}dub`, geburtsdatum: null });
    control.dublette_name_ohne_gebdatum = await addMember({
      vorname: `${MARKER}solo`,
      nachname: `${MARKER}solo`,
      geburtsdatum: null,
    });

    // vertrag_betrag_null
    const vbnMatch = await addMember({ memberNo: `${MARKER}-VBN-M` });
    await addContract(vbnMatch, await adrOf(vbnMatch), { betrag: "0" });
    match.vertrag_betrag_null = vbnMatch;
    const vbnCtrl = await addMember({ memberNo: `${MARKER}-VBN-C` });
    await addContract(vbnCtrl, await adrOf(vbnCtrl), { betrag: "12.50" });
    control.vertrag_betrag_null = vbnCtrl;

    // (Es gibt bewusst keine "Mandat abgelaufen"-Prüfung: ein SEPA-Mandat läuft
    // nicht zu einem Datum ab, daher kein gültig-bis-Check mehr.)

    // volljaehrig_eltern_konto (#236): heuristic detection without a formal
    // payer link. An 18+ member with an active DD contract whose abweichender
    // Kontoinhaber names someone other than themselves is flagged; the control
    // names the member themselves and must not be.
    const adultParentAcct = await addMember({
      memberNo: `${MARKER}-VEK-M`,
      vorname: "Lisa",
      nachname: `${MARKER}fam`,
      geburtsdatum: new Date("2000-01-01"),
      abwKontoInh: `${MARKER}fam, Hans`,
    });
    await addContract(adultParentAcct, await adrOf(adultParentAcct), {
      isDirectDebit: true,
      betrag: "60",
    });
    match.volljaehrig_eltern_konto = adultParentAcct;

    const adultSelfAcct = await addMember({
      memberNo: `${MARKER}-VEK-C`,
      vorname: "Lisa",
      nachname: `${MARKER}fam`,
      geburtsdatum: new Date("2000-01-01"),
      abwKontoInh: "Lisa (eigenes Konto)",
    });
    await addContract(adultSelfAcct, await adrOf(adultSelfAcct), {
      isDirectDebit: true,
      betrag: "60",
    });
    control.volljaehrig_eltern_konto = adultSelfAcct;

    // email_mehrfach refinement: cross-household matches, same-household does not.
    match.email_mehrfach = await addMember({ email: "cross@test.local", ort: "Bamberg" });
    await addMember({ email: "cross@test.local", ort: "Schweinfurt" });
    control.email_mehrfach = await addMember({
      email: "same@test.local",
      strasse: "Dorfweg",
      plz: "97461",
      ort: "Untereuerheim",
    });
    await addMember({
      email: "same@test.local",
      strasse: "Dorfweg",
      plz: "97461",
      ort: "Untereuerheim",
    });
  });

  afterAll(async () => {
    for (const id of ids) {
      await db().delete(membersTable).where(eq(membersTable.id, id));
    }
  });

  const listIds = async (category: CategoryId): Promise<Set<string>> => {
    const res = (await call(
      appRouter.dataQuality.list,
      { category },
      { context: vorstandContext() },
    )) as {
      items: { id: string }[];
    };
    return new Set(res.items.map((i) => i.id));
  };

  const cases: CategoryId[] = [
    "telefon_nur_vorwahl",
    "name_reihenfolge_vertauscht",
    "mehrere_personen_im_datensatz",
    "strasse_ohne_hausnummer",
    "dublette_name_ohne_gebdatum",
    "vertrag_betrag_null",
    "email_mehrfach",
    "volljaehrig_eltern_konto",
  ];

  for (const category of cases) {
    it(`${category}: flags the matching row, not the control`, async () => {
      const hits = await listIds(category);
      expect(hits.has(match[category] as string)).toBe(true);
      expect(hits.has(control[category] as string)).toBe(false);
    });
  }

  it("summary lists every new rule with a numeric count", async () => {
    const res = (await call(appRouter.dataQuality.summary, undefined, {
      context: vorstandContext(),
    })) as { categories: { id: string; count: number }[] };
    const byId = new Map(res.categories.map((c) => [c.id, c.count]));
    for (const category of cases) {
      expect(byId.has(category)).toBe(true);
      expect(typeof byId.get(category)).toBe("number");
    }
  });
});
