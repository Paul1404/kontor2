import { call } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Session } from "~/server/auth/auth";
import { db } from "~/server/db/client";
import { users } from "~/server/db/schema/auth";
import { contractsTable } from "~/server/db/schema/contracts";
import { membersTable } from "~/server/db/schema/members";
import { relationshipsTable } from "~/server/db/schema/relationships";
import type { AppContext } from "~/server/orpc/context";
import { appRouter } from "~/server/orpc/router";

/**
 * Schadenbegrenzung: ein minderjähriger Selbstzahler ohne jede Beziehung, aber
 * mit Kontoinhaber-Namen, bekommt einen Zahler-Kontakt aus diesem Namen, samt
 * übernommener Bankverbindung und Vertreter-Beziehung. Der Kontoinhaber steht
 * hier in "Nachname Vorname"-Reihenfolge, um die Namens-Zerlegung zu prüfen.
 *
 * Runs only against the throwaway test database (bun run test:int).
 */
const onTestDb = process.env.DATABASE_URL?.includes("svuwv_test") ?? false;
const MARKER = `Kih-${Date.now()}`;
const ACTOR_ID = `${MARKER}-actor`;

function authedContext(): AppContext {
  const session = {
    session: { id: "test", userId: ACTOR_ID },
    user: { id: ACTOR_ID, email: "kih-actor@test.local", role: "vorstand" },
  } as unknown as Session;
  return {
    db: db(),
    session,
    headers: new Headers(),
    tenant: { key: "svu", databaseUrl: "" },
    requestId: "kih-test",
  };
}

describe.skipIf(!onTestDb)("Mandate-Nachtrag Kontoinhaber-Kontakt (integration)", () => {
  let minorId = "";
  let minorAdr = 0;
  const surname = `${MARKER}-Reinhart`;

  beforeAll(async () => {
    await db()
      .insert(users)
      .values({
        id: ACTOR_ID,
        name: "Kih Integration",
        email: "kih-actor@test.local",
        emailVerified: true,
        role: "vorstand",
      })
      .onConflictDoNothing();

    minorAdr = 700000000 + (Date.now() % 90000000);
    const childBirth = new Date();
    childBirth.setFullYear(childBirth.getFullYear() - 11);

    const [minor] = await db()
      .insert(membersTable)
      .values({
        adrNr: minorAdr,
        nachname: surname,
        vorname: "Ronja",
        memberNo: `${MARKER}-C`,
        geburtsdatum: childBirth,
        eintritt: new Date("2018-09-01"),
        iban1: "DE89370400440532013000",
        iban1Last4: "3000",
        bic1: "COBADEFFXXX",
        // "Nachname Vorname" -> Anker ist der Kind-Nachname.
        abwKontoInh: `${surname} Jessica`,
      })
      .returning({ id: membersTable.id });
    if (!minor) throw new Error("seed failed");
    minorId = minor.id;

    await db()
      .insert(contractsTable)
      .values({
        memberId: minorId,
        adrNr: minorAdr,
        vertragNr: `${MARKER}-V`,
        art: 1,
        betrag: "60",
        isDirectDebit: true,
      });
  });

  afterAll(async () => {
    // Remove the relationship and any created contact, then the minor + user.
    const rels = await db()
      .select({ toMemberId: relationshipsTable.toMemberId })
      .from(relationshipsTable)
      .where(eq(relationshipsTable.fromMemberId, minorId));
    await db().delete(relationshipsTable).where(eq(relationshipsTable.fromMemberId, minorId));
    for (const r of rels) {
      if (r.toMemberId) {
        await db().delete(contractsTable).where(eq(contractsTable.memberId, r.toMemberId));
        await db().delete(membersTable).where(eq(membersTable.id, r.toMemberId));
      }
    }
    await db().delete(contractsTable).where(eq(contractsTable.memberId, minorId));
    await db().delete(membersTable).where(eq(membersTable.id, minorId));
    await db().delete(users).where(eq(users.id, ACTOR_ID));
  });

  it("legt einen Zahler-Kontakt aus dem Kontoinhaber an und verknüpft ihn als Vertreter", async () => {
    // Vorher: der Minderjährige erscheint mit einem Kontakt-Vorschlag.
    const before = await call(appRouter.sepa.nachtragKandidaten, undefined, {
      context: authedContext(),
    });
    const beforeRow = before.find((r) => r.zahlerMemberId === minorId);
    expect(beforeRow?.payerContactSuggestion?.nachname).toBe(surname);
    expect(beforeRow?.payerContactSuggestion?.vorname).toBe("Jessica");

    const res = await call(
      appRouter.sepa.resolveMinorViaKontoinhaber,
      { minorMemberId: minorId },
      { context: authedContext() },
    );
    expect(res.action).toBe("created");

    // Der Kontakt trägt den zerlegten Namen und die übernommene IBAN.
    const [contact] = await db()
      .select({
        nachname: membersTable.nachname,
        vorname: membersTable.vorname,
        kontaktNo: membersTable.kontaktNo,
        iban1Last4: membersTable.iban1Last4,
        bic1: membersTable.bic1,
      })
      .from(membersTable)
      .where(eq(membersTable.id, res.zahlerMemberId));
    expect(contact?.nachname).toBe(surname);
    expect(contact?.vorname).toBe("Jessica");
    expect(contact?.kontaktNo).toBeTruthy();
    expect(contact?.iban1Last4).toBe("3000");
    expect(contact?.bic1).toBe("COBADEFFXXX");

    // Die Vertreter-Beziehung steht.
    const [rel] = await db()
      .select({ istVertreter: relationshipsTable.istVertreter })
      .from(relationshipsTable)
      .where(
        and(
          eq(relationshipsTable.fromMemberId, minorId),
          eq(relationshipsTable.toMemberId, res.zahlerMemberId),
        ),
      );
    expect(rel?.istVertreter).toBe(true);

    // Danach ist der Minderjährige kein Selbstzahler-Befund mehr.
    const after = await call(appRouter.sepa.nachtragKandidaten, undefined, {
      context: authedContext(),
    });
    expect(after.find((r) => r.zahlerMemberId === minorId)).toBeFalsy();
  });
});
