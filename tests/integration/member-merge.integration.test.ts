import { call } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "~/server/db/client";
import { users } from "~/server/db/schema/auth";
import { contractsTable } from "~/server/db/schema/contracts";
import { membersTable } from "~/server/db/schema/members";
import { sepaMandatesTable } from "~/server/db/schema/sepa";
import { onboardMember } from "~/server/domain/member/onboard";
import type { AppContext } from "~/server/orpc/context";
import { appRouter } from "~/server/orpc/router";

const ACTOR_ID = "integration-test-merge-actor";
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

/**
 * Integration coverage for members.merge against the real database. The merge
 * repoints child rows across many tables and is destructive, so it must be
 * exercised end to end: a clean merge moves the child rows and soft-deletes the
 * loser, and a colliding row (same adrNr-scoped unique key) is left on the
 * loser instead of crashing.
 *
 * Runs only against the throwaway test database (bun run test:int).
 */
const onTestDb = process.env.DATABASE_URL?.includes("svuwv_test") ?? false;

function adminContext(): AppContext {
  return {
    db: db(),
    session: {
      user: { id: ACTOR_ID, email: "merge-actor@test.local", role: "admin" },
      session: { id: "merge-integration-test" },
    },
    headers: new Headers(),
    requestId: "merge-integration-test",
  } as unknown as AppContext;
}

async function onboard(nachname: string): Promise<{ id: string; adrNr: number }> {
  const res = await db().transaction((tx) =>
    onboardMember(tx, {
      patch: { vorname: "Merge", nachname, eintritt: new Date() },
      isKontakt: false,
      status: "aktiv",
      abteilungen: [],
      fallbackEintritt: new Date().toISOString().slice(0, 10),
      contract: null,
      sepa: null,
      actorId: ACTOR_ID,
      actorEmail: "merge-actor@test.local",
      requestId: null,
    }),
  );
  const [row] = await db()
    .select({ adrNr: membersTable.adrNr })
    .from(membersTable)
    .where(eq(membersTable.id, res.id))
    .limit(1);
  return { id: res.id, adrNr: row?.adrNr ?? 0 };
}

describe.skipIf(!onTestDb)("members.merge (integration)", () => {
  const createdIds: string[] = [];

  beforeAll(async () => {
    await db()
      .insert(users)
      .values({
        id: ACTOR_ID,
        name: "Merge Integration",
        email: "merge-actor@test.local",
        emailVerified: true,
        role: "admin",
      })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    for (const id of createdIds) {
      await db().delete(contractsTable).where(eq(contractsTable.memberId, id));
      await db().delete(sepaMandatesTable).where(eq(sepaMandatesTable.memberId, id));
      await db().delete(membersTable).where(eq(membersTable.id, id));
    }
  });

  it("moves contracts and mandates onto the winner and soft-deletes the loser", async () => {
    const winner = await onboard(`MergeWinner-${Date.now()}`);
    const loser = await onboard(`MergeLoser-${Date.now()}`);
    createdIds.push(winner.id, loser.id);

    const ctx = adminContext();
    const created = await call(
      appRouter.contracts.create,
      { memberId: loser.id, patch: { vertragNr: "MERGE-1", art: 1, betrag: "60" } },
      { context: ctx },
    );
    await call(
      appRouter.sepa.create,
      { memberId: loser.id, lastschriftart: "CORE" },
      { context: ctx },
    );

    const result = await call(
      appRouter.members.merge,
      { winnerId: winner.id, loserId: loser.id, confirm: true },
      { context: ctx },
    );

    expect(result.moved.contracts).toBe(1);
    expect(result.moved.sepaMandates).toBe(1);
    expect(result.skipped.contracts).toBe(0);

    const [contract] = await db()
      .select({ memberId: contractsTable.memberId, adrNr: contractsTable.adrNr })
      .from(contractsTable)
      .where(eq(contractsTable.id, created.id))
      .limit(1);
    expect(contract?.memberId).toBe(winner.id);
    expect(contract?.adrNr).toBe(winner.adrNr);

    const mandates = await db()
      .select({ memberId: sepaMandatesTable.memberId })
      .from(sepaMandatesTable)
      .where(eq(sepaMandatesTable.memberId, winner.id));
    expect(mandates.length).toBe(1);

    const [loserRow] = await db()
      .select({ deletedAt: membersTable.deletedAt })
      .from(membersTable)
      .where(eq(membersTable.id, loser.id))
      .limit(1);
    expect(loserRow?.deletedAt).not.toBeNull();

    const [winnerRow] = await db()
      .select({ deletedAt: membersTable.deletedAt })
      .from(membersTable)
      .where(eq(membersTable.id, winner.id))
      .limit(1);
    expect(winnerRow?.deletedAt).toBeNull();
  });

  it("leaves a colliding contract on the loser instead of failing", async () => {
    const winner = await onboard(`MergeConflictWinner-${Date.now()}`);
    const loser = await onboard(`MergeConflictLoser-${Date.now()}`);
    createdIds.push(winner.id, loser.id);

    const ctx = adminContext();
    // Same (vertragNr, art): after repointing the loser's contract to the
    // winner's adrNr it would collide with the winner's existing contract.
    await call(
      appRouter.contracts.create,
      { memberId: winner.id, patch: { vertragNr: "DUP-1", art: 1, betrag: "60" } },
      { context: ctx },
    );
    const loserContract = await call(
      appRouter.contracts.create,
      { memberId: loser.id, patch: { vertragNr: "DUP-1", art: 1, betrag: "60" } },
      { context: ctx },
    );

    const result = await call(
      appRouter.members.merge,
      { winnerId: winner.id, loserId: loser.id, confirm: true },
      { context: ctx },
    );

    expect(result.moved.contracts).toBe(0);
    expect(result.skipped.contracts).toBe(1);

    // The colliding contract stays attached to the (now soft-deleted) loser.
    const [stranded] = await db()
      .select({ memberId: contractsTable.memberId })
      .from(contractsTable)
      .where(eq(contractsTable.id, loserContract.id))
      .limit(1);
    expect(stranded?.memberId).toBe(loser.id);

    // The winner keeps exactly its own contract.
    const winnerContracts = await db()
      .select({ id: contractsTable.id })
      .from(contractsTable)
      .where(and(eq(contractsTable.memberId, winner.id), eq(contractsTable.vertragNr, "DUP-1")));
    expect(winnerContracts.length).toBe(1);
  });

  it("rejects merging a member into itself", async () => {
    const ctx = adminContext();
    await expect(
      call(
        appRouter.members.merge,
        { winnerId: NIL_UUID, loserId: NIL_UUID, confirm: true },
        { context: ctx },
      ),
    ).rejects.toThrow();
  });
});
