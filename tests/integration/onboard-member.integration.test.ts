import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "~/server/db/client";
import { auditLogTable } from "~/server/db/schema/audit";
import { users } from "~/server/db/schema/auth";
import { membersTable } from "~/server/db/schema/members";
import { memberSnapshotsTable } from "~/server/db/schema/snapshots";
import { onboardMember } from "~/server/domain/member/onboard";

// A real user row: `appendAudit` writes `actor_id` with a foreign key to
// `users`, exactly as the production callers do with a session user id.
const ACTOR_ID = "integration-test-actor";

/**
 * Integration coverage for the shared `onboardMember` helper, which both the
 * manual onboarding wizard and application approval rely on. Exercises the real
 * database: member-number minting, the audit entry, and the initial snapshot.
 *
 * Runs only against the throwaway test database (bun run test:int). The guard
 * keeps it from ever touching a real database if invoked by mistake.
 */
const onTestDb = process.env.DATABASE_URL?.includes("svuwv_test") ?? false;

describe.skipIf(!onTestDb)("onboardMember (integration)", () => {
  const createdIds: string[] = [];

  beforeAll(async () => {
    await db()
      .insert(users)
      .values({
        id: ACTOR_ID,
        name: "Integration Test",
        email: "integration-actor@test.local",
        emailVerified: true,
        role: "admin",
      })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    for (const id of createdIds) {
      await db().delete(membersTable).where(eq(membersTable.id, id));
    }
  });

  it("creates a member with a minted number, an audit entry and a snapshot", async () => {
    const nachname = `IntegrationTest-${Date.now()}`;
    const result = await db().transaction((tx) =>
      onboardMember(tx, {
        patch: { vorname: "Test", nachname, eintritt: new Date() },
        isKontakt: false,
        status: "aktiv",
        abteilungen: [],
        fallbackEintritt: new Date().toISOString().slice(0, 10),
        contract: null,
        sepa: null,
        actorId: ACTOR_ID,
        actorEmail: "test@example.com",
        requestId: null,
      }),
    );
    createdIds.push(result.id);

    expect(result.memberNo).toMatch(/^M-/);
    expect(result.ref).toBe(result.memberNo);

    const [member] = await db()
      .select({ id: membersTable.id, nachname: membersTable.nachname, status: membersTable.status })
      .from(membersTable)
      .where(eq(membersTable.id, result.id))
      .limit(1);
    expect(member?.nachname).toBe(nachname);
    expect(member?.status).toBe("aktiv");

    const audit = await db()
      .select({ id: auditLogTable.id })
      .from(auditLogTable)
      .where(and(eq(auditLogTable.entityType, "member"), eq(auditLogTable.entityId, result.id)));
    expect(audit.length).toBeGreaterThan(0);

    const snapshot = await db()
      .select({ id: memberSnapshotsTable.id })
      .from(memberSnapshotsTable)
      .where(eq(memberSnapshotsTable.memberId, result.id));
    expect(snapshot.length).toBeGreaterThan(0);
  });

  it("mints a K-number for a contact", async () => {
    const result = await db().transaction((tx) =>
      onboardMember(tx, {
        patch: { vorname: "Kontakt", nachname: `IntegrationKontakt-${Date.now()}` },
        isKontakt: true,
        status: "aktiv",
        abteilungen: [],
        fallbackEintritt: new Date().toISOString().slice(0, 10),
        contract: null,
        sepa: null,
        actorId: ACTOR_ID,
        actorEmail: "test@example.com",
        requestId: null,
      }),
    );
    createdIds.push(result.id);
    expect(result.kontaktNo).toMatch(/^K-/);
    expect(result.memberNo).toBeNull();
  });
});
