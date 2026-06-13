import { call, ORPCError } from "@orpc/server";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Session } from "~/server/auth/auth";
import { db } from "~/server/db/client";
import { apikeys, users } from "~/server/db/schema/auth";
import { idempotencyKeysTable } from "~/server/db/schema/idempotency";
import { membersTable } from "~/server/db/schema/members";
import { withIdempotency } from "~/server/mcp/idempotency";
import type { AppContext } from "~/server/orpc/context";
import { appRouter } from "~/server/orpc/router";

/**
 * Issue #83: MCP hardening — cursor paging, idempotency dedupe, and the
 * readonly-by-default key creation.
 *
 * Runs only against the throwaway test database (bun run test:int).
 */
const onTestDb = process.env.DATABASE_URL?.includes("svuwv_test") ?? false;
const MARKER = `McpHard-${Date.now()}`;

function ctx(role: string): AppContext {
  const session = {
    session: { id: "test", userId: "test" },
    user: { id: "test", email: "test@test.local", role },
  } as unknown as Session;
  return {
    db: db(),
    session,
    headers: new Headers(),
    tenant: { key: "svu", databaseUrl: "" },
    requestId: "mcp-hard-test",
  };
}

describe.skipIf(!onTestDb)("mcp idempotency (integration)", () => {
  const scope = `test-scope-${Date.now()}`;
  afterAll(async () => {
    await db().delete(idempotencyKeysTable).where(eq(idempotencyKeysTable.scope, scope));
  });

  it("runs once per key and returns the stored result on retry", async () => {
    let runs = 0;
    const op = () => {
      runs += 1;
      return Promise.resolve({ value: runs });
    };
    const first = await withIdempotency(db(), scope, "key-1", op);
    const retry = await withIdempotency(db(), scope, "key-1", op);
    expect(first).toEqual({ value: 1 });
    expect(retry).toEqual({ value: 1 }); // stored result, op not re-run
    expect(runs).toBe(1);

    // A different key runs again.
    const other = await withIdempotency(db(), scope, "key-2", op);
    expect(other).toEqual({ value: 2 });
    expect(runs).toBe(2);

    // No key => always runs.
    await withIdempotency(db(), scope, null, op);
    expect(runs).toBe(3);
  });
});

describe.skipIf(!onTestDb)("members.bulkExport cursor paging (integration)", () => {
  const ids: string[] = [];

  beforeAll(async () => {
    const [maxRow] = await db()
      .select({ max: sql<number>`coalesce(max(${membersTable.adrNr}), 0)::int` })
      .from(membersTable);
    let adr = (maxRow?.max ?? 0) + 1;
    for (let i = 0; i < 5; i += 1) {
      const [m] = await db()
        .insert(membersTable)
        .values({ adrNr: adr++, nachname: `${MARKER}-${i}`, memberNo: `${MARKER}-${i}` })
        .returning({ id: membersTable.id });
      if (m) ids.push(m.id);
    }
  });

  afterAll(async () => {
    for (const id of ids) await db().delete(membersTable).where(eq(membersTable.id, id));
  });

  it("pages keyset-style with no overlap and covers all members", async () => {
    const seen = new Set<string>();
    let cursor: string | null = null;
    let lastId = "";
    let guard = 0;
    do {
      const page: { rows: { id: string }[]; nextCursor: string | null } = await call(
        appRouter.members.bulkExport,
        { cursor, limit: 2 },
        { context: ctx("readonly") },
      );
      for (const r of page.rows) {
        expect(seen.has(r.id)).toBe(false); // no overlap across pages
        expect(r.id > lastId).toBe(true); // strictly ascending keyset
        seen.add(r.id);
        lastId = r.id;
      }
      cursor = page.nextCursor;
      guard += 1;
    } while (cursor && guard < 10000);

    for (const id of ids) expect(seen.has(id)).toBe(true);
  });
});

describe.skipIf(!onTestDb)("data_quality list cap and cursor (integration)", () => {
  it("exposes the cap value and a nextCursor", async () => {
    const res = (await call(
      appRouter.dataQuality.list,
      { category: "fehlende_email" },
      { context: ctx("vorstand") },
    )) as { cap: number; nextCursor: string | null; capped: boolean };
    expect(res.cap).toBe(500);
    // Under the cap in a small test DB.
    expect(res.nextCursor).toBeNull();
    expect(res.capped).toBe(false);
  });
});

describe.skipIf(!onTestDb)("api key readonly default (integration)", () => {
  const roId = `mcp-hard-ro-${Date.now()}`;
  const rwId = `mcp-hard-rw-${Date.now()}`;
  const adminId = `mcp-hard-admin-${Date.now()}`;

  function adminContext(): AppContext {
    const session = {
      session: { id: adminId, userId: adminId },
      user: { id: adminId, email: "admin@test.local", role: "admin" },
    } as unknown as Session;
    return {
      db: db(),
      session,
      headers: new Headers(),
      tenant: { key: "svu", databaseUrl: "" },
      requestId: "mcp-hard-admin",
    };
  }

  beforeAll(async () => {
    await db()
      .insert(users)
      .values([
        {
          id: roId,
          name: "RO",
          email: `${roId}@test.local`,
          emailVerified: true,
          role: "readonly",
        },
        {
          id: rwId,
          name: "RW",
          email: `${rwId}@test.local`,
          emailVerified: true,
          role: "vorstand",
        },
        {
          id: adminId,
          name: "Admin",
          email: `${adminId}@test.local`,
          emailVerified: true,
          role: "admin",
        },
      ])
      .onConflictDoNothing();
  });

  afterAll(async () => {
    for (const id of [roId, rwId, adminId]) {
      await db().delete(apikeys).where(eq(apikeys.referenceId, id));
      await db().delete(users).where(eq(users.id, id));
    }
  });

  it("rejects a write-capable user without an explicit opt-in", async () => {
    await expect(
      call(
        appRouter.apiKeys.create,
        { name: "rw-default", userId: rwId },
        { context: adminContext() },
      ),
    ).rejects.toBeInstanceOf(ORPCError);
  });

  it("allows a readonly user by default", async () => {
    const created = (await call(
      appRouter.apiKeys.create,
      { name: "ro-key", userId: roId },
      { context: adminContext() },
    )) as { key: string };
    expect(created.key).toBeTruthy();
  });

  it("allows a write-capable user with the explicit opt-in", async () => {
    const created = (await call(
      appRouter.apiKeys.create,
      { name: "rw-key", userId: rwId, allowWrite: true },
      { context: adminContext() },
    )) as { key: string };
    expect(created.key).toBeTruthy();
  });
});
