import { call } from "@orpc/server";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Session } from "~/server/auth/auth";
import { db } from "~/server/db/client";
import { contractsTable } from "~/server/db/schema/contracts";
import { membersTable } from "~/server/db/schema/members";
import type { AppContext } from "~/server/orpc/context";
import { appRouter } from "~/server/orpc/router";

/**
 * Regression: a member with a recorded Austritt (Kündigung) must not appear in
 * "Mandate nachtragen", not even when the Austritt is a future date and the
 * member is still nominally "aktiv". Before the fix the filter kept future-dated
 * Austritte, so a member who was just cancelled (and whose mandate was revoked
 * as part of that cancellation) was surfaced with the advice to collect a fresh
 * signature. That is dead, wrong work.
 *
 * Runs only against the throwaway test database (bun run test:int).
 */
const onTestDb = process.env.DATABASE_URL?.includes("svuwv_test") ?? false;
const MARKER = `NachtragAustritt-${Date.now()}`;

function vorstandContext(): AppContext {
  const session = {
    session: { id: "test", userId: "nachtrag-actor" },
    user: { id: "nachtrag-actor", email: "nachtrag@test.local", role: "vorstand" },
  } as unknown as Session;
  return {
    db: db(),
    session,
    headers: new Headers(),
    tenant: { key: "svu", databaseUrl: "" },
    requestId: "nachtrag-int-test",
  };
}

describe.skipIf(!onTestDb)("Mandate nachtragen excludes cancelled members (integration)", () => {
  let memberId = "";

  beforeAll(async () => {
    const [maxRow] = await db()
      .select({ max: sql<number>`coalesce(max(${membersTable.adrNr}), 0)::int` })
      .from(membersTable);
    const adrNr = (maxRow?.max ?? 0) + 1;

    // Adult self-payer with a direct-debit contract but no usable mandate:
    // exactly a "Mandat nachtragen" candidate while active.
    const [m] = await db()
      .insert(membersTable)
      .values({
        adrNr,
        nachname: MARKER,
        vorname: "Nachtrag",
        memberNo: `${MARKER}-M`,
        status: "aktiv",
        geburtsdatum: new Date("1990-04-01"),
        eintritt: new Date("2020-01-15"),
      })
      .returning({ id: membersTable.id });
    memberId = m?.id ?? "";

    await db()
      .insert(contractsTable)
      .values({
        memberId,
        adrNr,
        vertragNr: "1",
        art: 100,
        betrag: "54.00000000",
        isDirectDebit: true,
      } as never);
  });

  afterAll(async () => {
    if (memberId) await db().delete(membersTable).where(eq(membersTable.id, memberId));
  });

  it("lists an active self-payer, then drops it once an Austritt is recorded", async () => {
    const present = await call(appRouter.sepa.nachtragKandidaten, undefined, {
      context: vorstandContext(),
    });
    expect(present.some((k) => k.zahlerMemberId === memberId)).toBe(true);

    // Cancel effective end of a future year -- member stays "aktiv" until then.
    await db()
      .update(membersTable)
      .set({ austritt: new Date("2099-12-31") })
      .where(eq(membersTable.id, memberId));

    const afterCancel = await call(appRouter.sepa.nachtragKandidaten, undefined, {
      context: vorstandContext(),
    });
    expect(afterCancel.some((k) => k.zahlerMemberId === memberId)).toBe(false);
  });
});
