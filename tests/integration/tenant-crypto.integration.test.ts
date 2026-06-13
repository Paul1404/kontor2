import { eq, sql } from "drizzle-orm";
import { pgTable, uuid } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runWithTenantKeyring } from "~/server/crypto/tenant-crypto";
import { db } from "~/server/db/client";
import { encryptedText } from "~/server/db/types";

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
});
