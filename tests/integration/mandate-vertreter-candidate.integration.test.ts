import { call } from "@orpc/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Session } from "~/server/auth/auth";
import { db } from "~/server/db/client";
import { contractsTable } from "~/server/db/schema/contracts";
import { membersTable } from "~/server/db/schema/members";
import { relationshipsTable } from "~/server/db/schema/relationships";
import type { AppContext } from "~/server/orpc/context";
import { appRouter } from "~/server/orpc/router";

/**
 * Mandate nachtragen: ein minderjähriger Selbstzahler mit einer Beziehung zu
 * einem Erwachsenen bekommt einen Vertreter-Vorschlag. Passt der Name zum
 * hinterlegten Kontoinhaber, ist es ein "starker" Treffer.
 *
 * Runs only against the throwaway test database (bun run test:int).
 */
const onTestDb = process.env.DATABASE_URL?.includes("svuwv_test") ?? false;
const MARKER = `Vertreter-${Date.now()}`;

function authedContext(): AppContext {
  const session = {
    session: { id: "test", userId: "test" },
    user: { id: "test", email: "test@test.local", role: "vorstand" },
  } as unknown as Session;
  return {
    db: db(),
    session,
    headers: new Headers(),
    tenant: { key: "svu", databaseUrl: "" },
    requestId: "vertreter-test",
  };
}

describe.skipIf(!onTestDb)("Mandate-Nachtrag Vertreter-Vorschlag (integration)", () => {
  const memberIds: string[] = [];
  let minorId = "";
  let parentId = "";
  let minorAdr = 0;

  beforeAll(async () => {
    // High, unique adrNr base to avoid colliding with other seed rows.
    const base = 800000000 + (Date.now() % 90000000);
    minorAdr = base;
    const parentAdr = base + 1;

    const childBirth = new Date();
    childBirth.setFullYear(childBirth.getFullYear() - 12);

    const [parent] = await db()
      .insert(membersTable)
      .values({
        adrNr: parentAdr,
        nachname: `${MARKER}-Dorsch`,
        vorname: "Theresia",
        memberNo: `${MARKER}-P`,
        geburtsdatum: new Date("1981-12-08"),
      })
      .returning({ id: membersTable.id });
    const [minor] = await db()
      .insert(membersTable)
      .values({
        adrNr: minorAdr,
        nachname: `${MARKER}-Dorsch`,
        vorname: "Marlene",
        memberNo: `${MARKER}-C`,
        geburtsdatum: childBirth,
        eintritt: new Date("2016-09-22"),
        // Kontoinhaber-Name zeigt auf die Mutter -> starker Treffer.
        abwKontoInh: `Theresia ${MARKER}-Dorsch`,
      })
      .returning({ id: membersTable.id });
    if (!parent || !minor) throw new Error("seed failed");
    parentId = parent.id;
    minorId = minor.id;
    memberIds.push(parentId, minorId);

    // Aktiver Lastschrift-Vertrag mit Betrag > 0 beim Kind.
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

    // Beziehung Kind -> Mutter, ohne gesetztes Vertreter-Flag (wie nach Import).
    await db().insert(relationshipsTable).values({
      fromMemberId: minorId,
      toMemberId: parentId,
      fromAdrNr: minorAdr,
      toAdrNr: parentAdr,
    });
  });

  afterAll(async () => {
    await db().delete(relationshipsTable).where(eq(relationshipsTable.fromMemberId, minorId));
    await db().delete(contractsTable).where(eq(contractsTable.memberId, minorId));
    for (const id of memberIds) {
      await db().delete(membersTable).where(eq(membersTable.id, id));
    }
  });

  it("schlägt die Erwachsenen-Beziehung als starken Vertreter vor", async () => {
    const rows = await call(appRouter.sepa.nachtragKandidaten, undefined, {
      context: authedContext(),
    });
    const row = rows.find((r) => r.zahlerMemberId === minorId);
    expect(row).toBeTruthy();
    expect(row?.plan.kind).toBe("skip");
    expect(row?.vertreterCandidate).toBeTruthy();
    expect(row?.vertreterCandidate?.toMemberId).toBe(parentId);
    expect(row?.vertreterCandidate?.strong).toBe(true);
  });
});
