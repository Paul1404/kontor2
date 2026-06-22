import { eq, sql } from "drizzle-orm";
import { pgTable, uuid } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runWithTenantKeyring } from "~/server/crypto/tenant-crypto";
import { db } from "~/server/db/client";
import { membersTable } from "~/server/db/schema/members";
import { memberSnapshotsTable } from "~/server/db/schema/snapshots";
import { encryptedText } from "~/server/db/types";
import { takeMemberSnapshot } from "~/server/snapshots/snapshot";

/**
 * Beweist gegen echtes Postgres, dass der `encryptedText`-Customtype zusammen
 * mit dem Per-Verein-Keyring (AsyncLocalStorage) funktioniert: ein im
 * verein2-Kontext geschriebener Wert ist nur im verein2-Kontext lesbar, NICHT im
 * Default-(Primär-)Kontext. Das deckt das Timing ab, das der Unit-Test nicht kann
 * (toDriver/fromDriver laufen während der Query-Ausführung -- müssen im ALS-Scope
 * liegen). Läuft nur gegen die Wegwerf-Test-DB.
 */
const onTestDb = process.env.DATABASE_URL?.includes("svuwv_test") ?? false;
const SCRATCH = "tenant_crypto_test";

const scratch = pgTable(SCRATCH, {
  id: uuid("id").primaryKey().defaultRandom(),
  secret: encryptedText("secret"),
});

describe.skipIf(!onTestDb)("per-tenant encryptedText round-trip (integration)", () => {
  beforeAll(async () => {
    await db().execute(
      sql`create table if not exists ${sql.identifier(SCRATCH)} (id uuid primary key default gen_random_uuid(), secret bytea)`,
    );
    await db().execute(sql`truncate ${sql.identifier(SCRATCH)}`);
  });
  afterAll(async () => {
    await db().execute(sql`drop table if exists ${sql.identifier(SCRATCH)}`);
  });

  it("schreibt im verein2-Keyring und liest nur dort zurück, nicht im Default", async () => {
    const iban = "DE12500105170648489890";

    // Schreiben im verein2-Kontext -> mit verein2-Schlüssel verschlüsselt.
    const id = await runWithTenantKeyring("verein2", async () => {
      const [row] = await db()
        .insert(scratch)
        .values({ secret: iban })
        .returning({ id: scratch.id });
      return row?.id as string;
    });

    // Lesen im verein2-Kontext -> entschlüsselt korrekt.
    const within = await runWithTenantKeyring("verein2", async () => {
      const [r] = await db().select().from(scratch).where(eq(scratch.id, id));
      return r?.secret;
    });
    expect(within).toBe(iban);

    // Lesen OHNE aktiven Keyring (Default = Primär) -> nicht entschlüsselbar,
    // encryptedText fällt soft auf "" zurück (kein Crash, aber auch kein Klartext).
    const [outside] = await db().select().from(scratch).where(eq(scratch.id, id));
    expect(outside?.secret).toBe("");
  });

  it("snapshot liest verein2-IBAN nur innerhalb des verein2-Keyrings", async () => {
    const iban = "DE89370400440532013000";
    const marker = `tenant-crypto-snapshot-${Date.now()}`;
    let memberId: string | null = null;
    let snapshotId: string | null = null;

    try {
      const inserted = await runWithTenantKeyring("verein2", async () => {
        const [maxRow] = await db()
          .select({ maxAdrNr: sql<number>`coalesce(max(${membersTable.adrNr}), 0)::int` })
          .from(membersTable);
        const [row] = await db()
          .insert(membersTable)
          .values({
            adrNr: (maxRow?.maxAdrNr ?? 0) + 1,
            nachname: marker,
            iban1: iban,
          })
          .returning({ id: membersTable.id });
        return row;
      });
      memberId = inserted?.id ?? null;
      expect(memberId).toBeTruthy();
      if (!memberId) throw new Error("member insert failed");

      const [outside] = await db().select().from(membersTable).where(eq(membersTable.id, memberId));
      expect(outside?.iban1).toBe("");

      const result = await runWithTenantKeyring("verein2", () =>
        takeMemberSnapshot(db(), memberId as string, { trigger: "nightly" }),
      );
      snapshotId = result.snapshotId;
      expect(snapshotId).toBeTruthy();
      if (!snapshotId) throw new Error("snapshot insert failed");

      const [snapshot] = await db()
        .select({ member: memberSnapshotsTable.member })
        .from(memberSnapshotsTable)
        .where(eq(memberSnapshotsTable.id, snapshotId));
      expect((snapshot?.member as Record<string, unknown> | undefined)?.iban1).toBe(iban);
    } finally {
      if (snapshotId) {
        await db().delete(memberSnapshotsTable).where(eq(memberSnapshotsTable.id, snapshotId));
      }
      if (memberId) {
        await db().delete(membersTable).where(eq(membersTable.id, memberId));
      }
    }
  });
});
