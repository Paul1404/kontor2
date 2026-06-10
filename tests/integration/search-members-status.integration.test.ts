import { call } from "@orpc/server";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Session } from "~/server/auth/auth";
import { db } from "~/server/db/client";
import { membersTable } from "~/server/db/schema/members";
import type { AppContext } from "~/server/orpc/context";
import { appRouter } from "~/server/orpc/router";

/**
 * Regression coverage for issue #76: `search_members` with `status="alle"`
 * silently returned only the living members (same as `status="aktiv"`) because
 * the query builder applied `memberNotExited()` for every status except
 * `ausgetreten`. "alle" must be the full union of all lifecycle states (only
 * soft-deleted rows excluded).
 *
 * Runs only against the throwaway test database (bun run test:int).
 */
const onTestDb = process.env.DATABASE_URL?.includes("svuwv_test") ?? false;

const MARKER = `StatusAlleRegression-${Date.now()}`;

function vorstandContext(): AppContext {
  // The list procedure only reads `session.user.role` via requireAuth; no audit
  // rows are written, so a synthesized session is enough (mirrors mcp/auth.ts).
  const session = {
    session: { id: "test", userId: "test" },
    user: { id: "test", email: "test@test.local", role: "vorstand" },
  } as unknown as Session;
  return {
    db: db(),
    session,
    headers: new Headers(),
    requestId: "search-status-test",
  };
}

describe.skipIf(!onTestDb)("search_members status filter (integration)", () => {
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    const [maxRow] = await db()
      .select({ max: sql<number>`coalesce(max(${membersTable.adrNr}), 0)::int` })
      .from(membersTable);
    let adr = (maxRow?.max ?? 0) + 1;
    const future = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    const past = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    const seed = async (
      key: string,
      row: Partial<typeof membersTable.$inferInsert>,
    ): Promise<void> => {
      const [inserted] = await db()
        .insert(membersTable)
        .values({
          adrNr: adr++,
          nachname: MARKER,
          vorname: key,
          ...row,
        })
        .returning({ id: membersTable.id });
      if (inserted) ids[key] = inserted.id;
    };

    await seed("aktiv", { memberNo: `${MARKER}-A`, status: "aktiv" });
    await seed("gekuendigt", { memberNo: `${MARKER}-G`, austritt: future, status: "aktiv" });
    await seed("ausgetreten", { memberNo: `${MARKER}-X`, austritt: past, status: "ausgetreten" });
    await seed("verstorben", { memberNo: `${MARKER}-V`, verstorbenAm: past, status: "verstorben" });
    await seed("kontakt", { kontaktNo: `${MARKER}-K` });
    await seed("deleted", { memberNo: `${MARKER}-D`, deletedAt: past, status: "aktiv" });
  });

  afterAll(async () => {
    for (const id of Object.values(ids)) {
      await db().delete(membersTable).where(eq(membersTable.id, id));
    }
  });

  type StatusFilter = "aktiv" | "alle" | "ausgetreten" | "verstorben" | "gekuendigt";
  const id = (key: string): string => {
    const v = ids[key];
    if (!v) throw new Error(`missing seeded id: ${key}`);
    return v;
  };

  const listIds = async (status: StatusFilter): Promise<Set<string>> => {
    const res = (await call(
      appRouter.members.list,
      { q: MARKER, status, pageSize: 200 },
      { context: vorstandContext() },
    )) as { rows: { id: string }[] };
    return new Set(res.rows.map((r) => r.id));
  };

  it("returns the full union for status=alle, excluding only soft-deleted rows", async () => {
    const all = await listIds("alle");
    expect(all.has(id("aktiv"))).toBe(true);
    expect(all.has(id("gekuendigt"))).toBe(true);
    expect(all.has(id("ausgetreten"))).toBe(true);
    expect(all.has(id("verstorben"))).toBe(true);
    expect(all.has(id("kontakt"))).toBe(true);
    // Soft-deleted rows stay hidden from every normal view.
    expect(all.has(id("deleted"))).toBe(false);
    expect(all.size).toBe(5);
  });

  it("alle is a strict superset of aktiv (the bug collapsed them)", async () => {
    const all = await listIds("alle");
    const aktiv = await listIds("aktiv");
    // aktiv = living members: excludes the ausgetretenes and verstorbenes Mitglied.
    expect(aktiv.has(id("ausgetreten"))).toBe(false);
    expect(aktiv.has(id("verstorben"))).toBe(false);
    expect(aktiv.has(id("aktiv"))).toBe(true);
    expect(all.size).toBeGreaterThan(aktiv.size);
  });

  it("count(alle) equals the sum of the disjoint lifecycle buckets", async () => {
    const [all, ausgetreten, verstorben, gekuendigt] = await Promise.all([
      listIds("alle"),
      listIds("ausgetreten"),
      listIds("verstorben"),
      listIds("gekuendigt"),
    ]);
    // Within our seeded set: aktiv (living, not pending exit) + gekuendigt
    // (pending exit) + ausgetreten + verstorben + kontakt partition "alle".
    const living = new Set(
      [...all].filter((id) => !ausgetreten.has(id) && !verstorben.has(id) && !gekuendigt.has(id)),
    );
    expect(living.size + gekuendigt.size + ausgetreten.size + verstorben.size).toBe(all.size);
  });
});
