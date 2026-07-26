import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "~/server/db/client";
import { loadTenants } from "~/server/tenants/load";
import { deprovisionTenant, provisionTenant } from "~/server/tenants/provision";
import { tenantUrlFromName } from "~/server/tenants/url";

/**
 * Beweist das Provisioning gegen echtes Postgres: CREATE DATABASE + Migrationen +
 * tenants-Zeile, und dass der Loader den neuen Verein über den Klartext
 * database_name auflöst. Läuft nur gegen die Wegwerf-Test-DB.
 */
const onTestDb = process.env.DATABASE_URL?.includes("svuwv_test") ?? false;
const adminUrl = process.env.DATABASE_URL ?? "";

const KEY = "it-prov-x"; // Subdomain-Label: nur a-z/0-9/'-'
const DB_NAME = "it_prov_x"; // PG-Identifier: a-z/0-9/'_'

describe.skipIf(!onTestDb)("tenant provisioning (integration)", () => {
  beforeAll(async () => {
    await deprovisionTenant(adminUrl, { key: KEY, databaseName: DB_NAME }).catch(() => {});
  });
  afterAll(async () => {
    await deprovisionTenant(adminUrl, { key: KEY, databaseName: DB_NAME }).catch(() => {});
  });

  it("legt DB + Migrationen + tenants-Zeile an und löst über database_name auf", async () => {
    const provisioned = await provisionTenant(adminUrl, {
      key: KEY,
      displayName: "Verein X",
      databaseName: DB_NAME,
    });
    expect(provisioned.bootstrapToken.length).toBeGreaterThanOrEqual(32);

    // tenants-Zeile: database_name gesetzt, database_url leer (kein Krypto nötig).
    const rows = (await db().execute(
      sql`select database_name, database_url, status from tenants where key = ${KEY}`,
    )) as unknown as Array<{ database_name: string | null; database_url: unknown; status: string }>;
    expect(rows[0]?.database_name).toBe(DB_NAME);
    expect(rows[0]?.database_url).toBeNull();
    expect(rows[0]?.status).toBe("active");

    // Die neue DB ist migriert: Drizzle-Journal hat Einträge.
    const target = postgres(tenantUrlFromName(adminUrl, DB_NAME), { max: 1, onnotice: () => {} });
    try {
      const j =
        (await target`select count(*)::int as n from drizzle.__drizzle_migrations`) as unknown as Array<{
          n: number;
        }>;
      expect(j[0]?.n ?? 0).toBeGreaterThan(0);
      const setupRows = (await target`
        select token_hash, consumed_at from setup_bootstrap_tokens where id = 1
      `) as unknown as Array<{ token_hash: string; consumed_at: Date | null }>;
      expect(setupRows[0]?.token_hash).toBe(
        createHash("sha256").update(provisioned.bootstrapToken).digest("hex"),
      );
      expect(setupRows[0]?.consumed_at).toBeNull();
    } finally {
      await target.end();
    }

    // Der Loader liefert den neuen Verein mit der aus database_name gebauten URL.
    const tenants = await loadTenants();
    const t = tenants.find((x) => x.key === KEY);
    expect(t?.databaseUrl).toBe(tenantUrlFromName(adminUrl, DB_NAME));
  });

  it("ist idempotent (zweiter Lauf wirft nicht)", async () => {
    await expect(
      provisionTenant(adminUrl, { key: KEY, displayName: "Verein X neu", databaseName: DB_NAME }),
    ).resolves.toMatchObject({ bootstrapToken: expect.any(String) });
  });
});
