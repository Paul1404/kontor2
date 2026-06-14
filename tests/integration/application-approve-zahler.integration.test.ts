import { call } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Session } from "~/server/auth/auth";
import { db } from "~/server/db/client";
import { users } from "~/server/db/schema/auth";
import { contractsTable } from "~/server/db/schema/contracts";
import { membersTable } from "~/server/db/schema/members";
import { membershipApplicationsTable } from "~/server/db/schema/membership-applications";
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
  const childSurname = `${MARKER}-Kind`;
  const guardianSurname = `${MARKER}-Eltern`;
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
  });

  afterAll(async () => {
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
      .where(eq(membershipApplicationsTable.id, applicationId));
    await db().delete(users).where(eq(users.id, ACTOR_ID));
  });

  it("Kind = Mitglied ohne IBAN, Erziehungsberechtigter = Kontakt mit IBAN/Mandat, als Vertreter verknüpft", async () => {
    await call(
      appRouter.applications.approve,
      { id: applicationId, art: 1, betrag: "0" },
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
      .select({ id: contractsTable.id, isDirectDebit: contractsTable.isDirectDebit })
      .from(contractsTable)
      .where(eq(contractsTable.memberId, child?.id as string));
    expect(childContracts.length).toBe(1);
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
});
