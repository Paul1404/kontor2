import { call, ORPCError } from "@orpc/server";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Session } from "~/server/auth/auth";
import { db } from "~/server/db/client";
import { membersTable } from "~/server/db/schema/members";
import type { AppContext } from "~/server/orpc/context";
import { appRouter } from "~/server/orpc/router";

/**
 * Issue #82: get_member must resolve a Kontakt record referenced by its
 * internal UUID id (as the data-quality drill-downs and the MCP audit do),
 * and a non-existent reference must surface a clean NOT_FOUND, never an opaque
 * Postgres error (which previously read as a 401 to the client).
 *
 * Runs only against the throwaway test database (bun run test:int).
 */
const onTestDb = process.env.DATABASE_URL?.includes("svuwv_test") ?? false;
const MARKER = `GetMemberLookup-${Date.now()}`;

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
    requestId: "get-lookup-test",
  };
}

describe.skipIf(!onTestDb)("members.get lookup (integration)", () => {
  let kontaktId = "";
  let kontaktNo = "";

  beforeAll(async () => {
    const [maxRow] = await db()
      .select({ max: sql<number>`coalesce(max(${membersTable.adrNr}), 0)::int` })
      .from(membersTable);
    kontaktNo = `${MARKER}-K`;
    const [row] = await db()
      .insert(membersTable)
      .values({
        adrNr: (maxRow?.max ?? 0) + 1,
        nachname: MARKER,
        vorname: "Kontakt",
        kontaktNo,
      })
      .returning({ id: membersTable.id });
    kontaktId = row?.id ?? "";
  });

  afterAll(async () => {
    if (kontaktId) await db().delete(membersTable).where(eq(membersTable.id, kontaktId));
  });

  it("resolves a Kontakt by its internal UUID id", async () => {
    const res = (await call(
      appRouter.members.get,
      { mitgliedsnummer: kontaktId },
      { context: vorstandContext() },
    )) as { member: { id: string } };
    expect(res.member.id).toBe(kontaktId);
  });

  it("still resolves by kontaktNo", async () => {
    const res = (await call(
      appRouter.members.get,
      { mitgliedsnummer: kontaktNo },
      { context: vorstandContext() },
    )) as { member: { id: string } };
    expect(res.member.id).toBe(kontaktId);
  });

  it("returns NOT_FOUND (not a raw error) for an unknown reference", async () => {
    await expect(
      call(
        appRouter.members.get,
        { mitgliedsnummer: "00000000-0000-0000-0000-000000000000" },
        { context: vorstandContext() },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    // And for a non-UUID-shaped unknown ref (must not throw an invalid-uuid error).
    await expect(
      call(
        appRouter.members.get,
        { mitgliedsnummer: "no-such-ref" },
        { context: vorstandContext() },
      ),
    ).rejects.toBeInstanceOf(ORPCError);
  });
});
