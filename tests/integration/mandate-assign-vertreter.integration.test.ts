import { call } from "@orpc/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Session } from "~/server/auth/auth";
import { db } from "~/server/db/client";
import { users } from "~/server/db/schema/auth";
import { membersTable } from "~/server/db/schema/members";
import { relationshipsTable } from "~/server/db/schema/relationships";
import type { AppContext } from "~/server/orpc/context";
import { appRouter } from "~/server/orpc/router";

/**
 * "Als Vertreter übernehmen": setzt ist_vertreter und zieht bei einem
 * Kontoinhaber-Treffer die Bankverbindung des Kindes mit -- aber nur, wenn der
 * Vertreter selbst noch keine IBAN hat.
 *
 * Runs only against the throwaway test database (bun run test:int).
 */
const onTestDb = process.env.DATABASE_URL?.includes("svuwv_test") ?? false;
const MARKER = `AssignV-${Date.now()}`;
const ACTOR_ID = `${MARKER}-actor`;

function authedContext(): AppContext {
  const session = {
    session: { id: "test", userId: ACTOR_ID },
    user: { id: ACTOR_ID, email: "assignv-actor@test.local", role: "vorstand" },
  } as unknown as Session;
  return {
    db: db(),
    session,
    headers: new Headers(),
    tenant: { key: "svu", databaseUrl: "" },
    requestId: "assignv-test",
  };
}

async function seedPair(opts: {
  surname: string;
  base: number;
  parentHasIban: boolean;
}): Promise<{ minorId: string; parentId: string; relId: string }> {
  const minorAdr = opts.base;
  const parentAdr = opts.base + 1;
  const childBirth = new Date();
  childBirth.setFullYear(childBirth.getFullYear() - 12);

  const [parent] = await db()
    .insert(membersTable)
    .values({
      adrNr: parentAdr,
      nachname: opts.surname,
      vorname: "Theresia",
      memberNo: `${MARKER}-${opts.surname}-P`,
      geburtsdatum: new Date("1981-12-08"),
      ...(opts.parentHasIban
        ? { iban1: "DE89370400440532013000", iban1Last4: "9999", bic1: "MARKDEF1100" }
        : {}),
    })
    .returning({ id: membersTable.id });
  const [minor] = await db()
    .insert(membersTable)
    .values({
      adrNr: minorAdr,
      nachname: opts.surname,
      vorname: "Mara",
      memberNo: `${MARKER}-${opts.surname}-C`,
      geburtsdatum: childBirth,
      iban1: "DE89370400440532013000",
      iban1Last4: "3000",
      bic1: "COBADEFFXXX",
      abwKontoInh: `Theresia ${opts.surname}`,
    })
    .returning({ id: membersTable.id });
  if (!parent || !minor) throw new Error("seed failed");
  const [rel] = await db()
    .insert(relationshipsTable)
    .values({
      fromMemberId: minor.id,
      toMemberId: parent.id,
      fromAdrNr: minorAdr,
      toAdrNr: parentAdr,
    })
    .returning({ id: relationshipsTable.id });
  if (!rel) throw new Error("seed failed");
  return { minorId: minor.id, parentId: parent.id, relId: rel.id };
}

describe.skipIf(!onTestDb)("Mandate-Nachtrag als Vertreter übernehmen (integration)", () => {
  let a: { minorId: string; parentId: string; relId: string };
  let b: { minorId: string; parentId: string; relId: string };
  const ids: string[] = [];

  beforeAll(async () => {
    await db()
      .insert(users)
      .values({
        id: ACTOR_ID,
        name: "AssignV Integration",
        email: "assignv-actor@test.local",
        emailVerified: true,
        role: "vorstand",
      })
      .onConflictDoNothing();

    const base = 600000000 + (Date.now() % 80000000);
    a = await seedPair({ surname: `${MARKER}A`, base, parentHasIban: false });
    b = await seedPair({ surname: `${MARKER}B`, base: base + 10, parentHasIban: true });
    ids.push(a.minorId, a.parentId, b.minorId, b.parentId);
  });

  afterAll(async () => {
    for (const id of ids) {
      await db().delete(relationshipsTable).where(eq(relationshipsTable.fromMemberId, id));
    }
    for (const id of ids) {
      await db().delete(membersTable).where(eq(membersTable.id, id));
    }
    await db().delete(users).where(eq(users.id, ACTOR_ID));
  });

  it("setzt Vertreter und zieht die IBAN mit, wenn der Vertreter keine hat", async () => {
    const res = await call(
      appRouter.sepa.assignVertreter,
      { minorMemberId: a.minorId, relationshipId: a.relId },
      { context: authedContext() },
    );
    expect(res.ibanMoved).toBe(true);

    const [rel] = await db()
      .select({ istVertreter: relationshipsTable.istVertreter })
      .from(relationshipsTable)
      .where(eq(relationshipsTable.id, a.relId));
    expect(rel?.istVertreter).toBe(true);

    const [parent] = await db()
      .select({ iban1Last4: membersTable.iban1Last4 })
      .from(membersTable)
      .where(eq(membersTable.id, a.parentId));
    expect(parent?.iban1Last4).toBe("3000");
  });

  it("überschreibt eine vorhandene IBAN des Vertreters nicht", async () => {
    const res = await call(
      appRouter.sepa.assignVertreter,
      { minorMemberId: b.minorId, relationshipId: b.relId },
      { context: authedContext() },
    );
    expect(res.ibanMoved).toBe(false);

    const [parent] = await db()
      .select({ iban1Last4: membersTable.iban1Last4 })
      .from(membersTable)
      .where(eq(membersTable.id, b.parentId));
    expect(parent?.iban1Last4).toBe("9999");
  });
});
