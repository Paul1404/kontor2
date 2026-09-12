import { call } from "@orpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Session } from "~/server/auth/auth";
import { db } from "~/server/db/client";
import { users } from "~/server/db/schema/auth";
import { contractsTable } from "~/server/db/schema/contracts";
import { familienMitgliederTable, familienTable } from "~/server/db/schema/familien";
import { feeTypesTable } from "~/server/db/schema/fee-types";
import { membersTable } from "~/server/db/schema/members";
import {
  membershipApplicationFilesTable,
  membershipApplicationsTable,
} from "~/server/db/schema/membership-applications";
import { relationshipsTable } from "~/server/db/schema/relationships";
import { sepaMandatesTable } from "~/server/db/schema/sepa";
import type { AppContext } from "~/server/orpc/context";
import { appRouter } from "~/server/orpc/router";

/**
 * Genehmigung eines Kind-Antrags legt den Zahler sauber an: das Kind ist
 * Mitglied (mit Vertrag, ohne eigene Bankverbindung), der Erziehungsberechtigte
 * ist ein Kontakt mit IBAN + Mandat, und beide sind als Vertreter verknüpft.
 *
 * Runs only against the throwaway test database (bun run test:int).
 */
const onTestDb = process.env.DATABASE_URL?.includes("svuwv_test") ?? false;
const MARKER = `AppZahler-${Date.now()}`;
const ACTOR_ID = `${MARKER}-actor`;
const CHILD_ART = 910001;
const FAMILY_ART = 910002;
const INACTIVE_ART = 910003;

function authedContext(): AppContext {
  const session = {
    session: { id: "test", userId: ACTOR_ID },
    user: { id: ACTOR_ID, email: "appzahler-actor@test.local", role: "vorstand" },
  } as unknown as Session;
  return {
    db: db(),
    session,
    headers: new Headers(),
    tenant: { key: "svu", databaseUrl: "" },
    requestId: "appzahler-test",
  };
}

describe.skipIf(!onTestDb)("Antrag-Genehmigung legt Zahler an (integration)", () => {
  let applicationId = "";
  let familyApplicationId = "";
  let invalidApplicationId = "";
  let familyId = "";
  const childSurname = `${MARKER}-Kind`;
  const guardianSurname = `${MARKER}-Eltern`;
  const familySurname = `${MARKER}-Familie`;
  const createdMemberIds: string[] = [];

  beforeAll(async () => {
    await db()
      .insert(users)
      .values({
        id: ACTOR_ID,
        name: "AppZahler Integration",
        email: "appzahler-actor@test.local",
        emailVerified: true,
        role: "vorstand",
      })
      .onConflictDoNothing();
    await db()
      .insert(feeTypesTable)
      .values([
        { art: CHILD_ART, bezeichnung: "Kinderbeitrag Test", betrag1: "0.00" },
        {
          art: FAMILY_ART,
          bezeichnung: "Familienbeitrag Test",
          betrag1: "96.00",
          antragsRolle: "familie",
        },
        { art: INACTIVE_ART, bezeichnung: "Inaktiver Beitrag Test", nichAktiv: "J" },
      ])
      .onConflictDoNothing();

    const childBirth = new Date();
    childBirth.setFullYear(childBirth.getFullYear() - 10);

    const [app] = await db()
      .insert(membershipApplicationsTable)
      .values({
        antragsnummer: `${MARKER}-A`,
        antragstyp: "kind",
        status: "neu",
        source: "online",
        mitgliedschaftTyp: "kind",
        vorname: "Mara",
        nachname: childSurname,
        geburtsdatum: childBirth,
        strasse: "Dornweg",
        hausnummer: "12",
        plz: "97508",
        ort: "Obereuerheim",
        erziehungsberechtigterVorname: "Theresia",
        erziehungsberechtigterNachname: guardianSurname,
        iban: "DE89370400440532013000",
        ibanLast4: "3000",
        bic: "COBADEFFXXX",
        kontoinhaber: `Theresia ${guardianSurname}`,
        mandatsreferenz: `${MARKER}-MAN`,
        consentAt: new Date(),
      })
      .returning({ id: membershipApplicationsTable.id });
    if (!app) throw new Error("seed failed");
    applicationId = app.id;
    await db()
      .insert(membershipApplicationFilesTable)
      .values({
        applicationId,
        kind: "signed_scan",
        s3Key: `test/${MARKER}.pdf`,
        filename: `${MARKER}.pdf`,
        mimeType: "application/pdf",
        sizeBytes: 1,
      });

    const [invalidApp] = await db()
      .insert(membershipApplicationsTable)
      .values({
        antragsnummer: `${MARKER}-INVALID`,
        antragstyp: "einzel",
        status: "dokument_hochgeladen",
        source: "online",
        mitgliedschaftTyp: "erwachsener",
        vorname: "Invalid",
        nachname: MARKER,
        geburtsdatum: new Date("1991-02-03"),
        jahresbeitrag: "54.00",
      })
      .returning({ id: membershipApplicationsTable.id });
    if (!invalidApp) throw new Error("invalid seed failed");
    invalidApplicationId = invalidApp.id;
    await db()
      .insert(membershipApplicationFilesTable)
      .values({
        applicationId: invalidApplicationId,
        kind: "signed_scan",
        s3Key: `test/${MARKER}-invalid.pdf`,
        filename: `${MARKER}-invalid.pdf`,
        mimeType: "application/pdf",
        sizeBytes: 1,
      });

    const [familyApp] = await db()
      .insert(membershipApplicationsTable)
      .values({
        antragsnummer: `${MARKER}-F`,
        antragstyp: "familie",
        status: "dokument_hochgeladen",
        source: "online",
        mitgliedschaftTyp: "familie",
        vorname: "Paula",
        nachname: familySurname,
        geburtsdatum: new Date("1990-04-12"),
        strasse: "Testweg",
        hausnummer: "7",
        plz: "97508",
        ort: "Untereuerheim",
        partnerVorname: "Peter",
        partnerNachname: familySurname,
        partnerGeburtsdatum: new Date("1989-03-11"),
        kinder: [
          {
            vorname: "Klara",
            nachname: familySurname,
            geburtsdatum: "2018-05-06",
            abteilungen: [],
          },
        ],
        jahresbeitrag: "96.00",
        vorgeschlageneArt: FAMILY_ART,
        iban: "DE89370400440532013000",
        ibanLast4: "3000",
        bic: "COBADEFFXXX",
        kontoinhaber: `Paula ${familySurname}`,
        mandatsreferenz: `${MARKER}-FAM-MAN`,
        consentAt: new Date(),
      })
      .returning({ id: membershipApplicationsTable.id });
    if (!familyApp) throw new Error("family seed failed");
    familyApplicationId = familyApp.id;
    await db()
      .insert(membershipApplicationFilesTable)
      .values({
        applicationId: familyApplicationId,
        kind: "signed_scan",
        s3Key: `test/${MARKER}-family.pdf`,
        filename: `${MARKER}-family.pdf`,
        mimeType: "application/pdf",
        sizeBytes: 1,
      });
  });

  afterAll(async () => {
    if (familyId) await db().delete(familienTable).where(eq(familienTable.id, familyId));
    for (const id of createdMemberIds) {
      await db().delete(relationshipsTable).where(eq(relationshipsTable.fromMemberId, id));
      await db().delete(sepaMandatesTable).where(eq(sepaMandatesTable.memberId, id));
      await db().delete(contractsTable).where(eq(contractsTable.memberId, id));
    }
    for (const id of createdMemberIds) {
      await db().delete(membersTable).where(eq(membersTable.id, id));
    }
    await db()
      .delete(membershipApplicationsTable)
      .where(
        inArray(membershipApplicationsTable.id, [
          applicationId,
          familyApplicationId,
          invalidApplicationId,
        ]),
      );
    await db()
      .delete(feeTypesTable)
      .where(inArray(feeTypesTable.art, [CHILD_ART, FAMILY_ART, INACTIVE_ART]));
    await db().delete(users).where(eq(users.id, ACTOR_ID));
  });

  it("Kind = Mitglied ohne IBAN, Erziehungsberechtigter = Kontakt mit IBAN/Mandat, als Vertreter verknüpft", async () => {
    await call(
      appRouter.applications.approve,
      { id: applicationId, art: CHILD_ART, betrag: "0,00" },
      { context: authedContext() },
    );

    // Kind: Mitglied (M-) mit Vertrag, ohne eigene IBAN.
    const [child] = await db()
      .select({
        id: membersTable.id,
        memberNo: membersTable.memberNo,
        kontaktNo: membersTable.kontaktNo,
        iban1Last4: membersTable.iban1Last4,
      })
      .from(membersTable)
      .where(eq(membersTable.nachname, childSurname));
    expect(child?.memberNo).toBeTruthy();
    expect(child?.kontaktNo).toBeNull();
    expect(child?.iban1Last4).toBeNull();
    if (child) createdMemberIds.push(child.id);

    const childContracts = await db()
      .select({
        id: contractsTable.id,
        artName: contractsTable.artName,
        betrag: contractsTable.betrag,
        isDirectDebit: contractsTable.isDirectDebit,
      })
      .from(contractsTable)
      .where(eq(contractsTable.memberId, child?.id as string));
    expect(childContracts.length).toBe(1);
    expect(childContracts[0]?.artName).toBe("Kinderbeitrag Test");
    expect(Number(childContracts[0]?.betrag)).toBe(0);
    // The child's contract is direct debit even though the mandate sits on the
    // guardian; the fee run routes the debit via the Vertreter link. Without
    // this it would be booked as an invoice payer and never debited.
    expect(childContracts[0]?.isDirectDebit).toBe(true);

    // Erziehungsberechtigter: Kontakt (K-) mit IBAN + Mandat.
    const [guardian] = await db()
      .select({
        id: membersTable.id,
        memberNo: membersTable.memberNo,
        kontaktNo: membersTable.kontaktNo,
        iban1Last4: membersTable.iban1Last4,
      })
      .from(membersTable)
      .where(eq(membersTable.nachname, guardianSurname));
    expect(guardian?.kontaktNo).toBeTruthy();
    expect(guardian?.memberNo).toBeNull();
    expect(guardian?.iban1Last4).toBe("3000");
    if (guardian) createdMemberIds.push(guardian.id);

    const guardianMandates = await db()
      .select({ id: sepaMandatesTable.id })
      .from(sepaMandatesTable)
      .where(eq(sepaMandatesTable.memberId, guardian?.id as string));
    expect(guardianMandates.length).toBe(1);

    // Vertreter-Beziehung Kind -> Erziehungsberechtigter.
    const [rel] = await db()
      .select({ istVertreter: relationshipsTable.istVertreter })
      .from(relationshipsTable)
      .where(
        and(
          eq(relationshipsTable.fromMemberId, child?.id as string),
          eq(relationshipsTable.toMemberId, guardian?.id as string),
        ),
      );
    expect(rel?.istVertreter).toBe(true);
  });

  it("Familie = Zahler mit Vertrag und Mandat, Partner und Kind beitragsfrei gruppiert", async () => {
    await call(
      appRouter.applications.approve,
      { id: familyApplicationId, art: FAMILY_ART, betrag: "96,00" },
      { context: authedContext() },
    );

    const familyMembers = await db()
      .select({ id: membersTable.id, vorname: membersTable.vorname })
      .from(membersTable)
      .where(eq(membersTable.nachname, familySurname));
    expect(familyMembers).toHaveLength(3);
    createdMemberIds.push(...familyMembers.map((m) => m.id));
    const primary = familyMembers.find((m) => m.vorname === "Paula");
    const partner = familyMembers.find((m) => m.vorname === "Peter");
    const child = familyMembers.find((m) => m.vorname === "Klara");
    expect(primary).toBeTruthy();
    expect(partner).toBeTruthy();
    expect(child).toBeTruthy();

    const [family] = await db()
      .select({ id: familienTable.id, zahlerMemberId: familienTable.zahlerMemberId })
      .from(familienTable)
      .where(eq(familienTable.zahlerMemberId, primary?.id as string));
    expect(family?.zahlerMemberId).toBe(primary?.id);
    familyId = family?.id ?? "";

    const roles = await db()
      .select({ memberId: familienMitgliederTable.memberId, rolle: familienMitgliederTable.rolle })
      .from(familienMitgliederTable)
      .where(eq(familienMitgliederTable.familieId, family?.id as string));
    expect(new Map(roles.map((r) => [r.memberId, r.rolle]))).toEqual(
      new Map([
        [primary?.id as string, "zahler"],
        [partner?.id as string, "partner"],
        [child?.id as string, "kind"],
      ]),
    );

    const contracts = await db()
      .select({
        memberId: contractsTable.memberId,
        art: contractsTable.art,
        artName: contractsTable.artName,
        betrag: contractsTable.betrag,
        isDirectDebit: contractsTable.isDirectDebit,
      })
      .from(contractsTable)
      .where(
        inArray(
          contractsTable.memberId,
          familyMembers.map((m) => m.id),
        ),
      );
    expect(contracts).toHaveLength(1);
    expect(contracts[0]).toMatchObject({
      memberId: primary?.id,
      art: FAMILY_ART,
      artName: "Familienbeitrag Test",
      isDirectDebit: true,
    });
    expect(Number(contracts[0]?.betrag)).toBe(96);

    const mandates = await db()
      .select({ memberId: sepaMandatesTable.memberId })
      .from(sepaMandatesTable)
      .where(
        inArray(
          sepaMandatesTable.memberId,
          familyMembers.map((m) => m.id),
        ),
      );
    expect(mandates).toEqual([{ memberId: primary?.id }]);
  });

  it("weist unbekannte und inaktive Beitragsarten sowie negative Beträge vor der Anlage ab", async () => {
    await expect(
      call(
        appRouter.applications.approve,
        { id: invalidApplicationId, art: 919999, betrag: "54.00" },
        { context: authedContext() },
      ),
    ).rejects.toThrow("Beitragsart nicht gefunden");
    await expect(
      call(
        appRouter.applications.approve,
        { id: invalidApplicationId, art: INACTIVE_ART, betrag: "54.00" },
        { context: authedContext() },
      ),
    ).rejects.toThrow("Beitragsart ist inaktiv");
    await expect(
      call(
        appRouter.applications.approve,
        { id: invalidApplicationId, art: CHILD_ART, betrag: "-54.00" },
        { context: authedContext() },
      ),
    ).rejects.toThrow("Ungültiger Betrag");

    const [unchanged] = await db()
      .select({
        status: membershipApplicationsTable.status,
        memberId: membershipApplicationsTable.memberId,
      })
      .from(membershipApplicationsTable)
      .where(eq(membershipApplicationsTable.id, invalidApplicationId));
    expect(unchanged).toEqual({ status: "dokument_hochgeladen", memberId: null });
  });
});
