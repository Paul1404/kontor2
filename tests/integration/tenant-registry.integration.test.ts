import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "~/server/db/client";
import { tenantsTable } from "~/server/db/schema/tenants";
import { loadTenants } from "~/server/tenants/load";
import { findTenantByKey, listTenants } from "~/server/tenants/registry";

/**
 * Beweist die Control-Plane-Quelle gegen eine echte DB: eine `tenants`-Zeile
 * (mit verschlüsselter `database_url`) wird über den Loader in die Registry
 * gespeist, taucht in `listTenants`/`findTenantByKey` auf, und der primäre Verein
 * aus der Tabelle wird zugunsten von `DATABASE_URL` ignoriert. Läuft nur gegen
 * die Wegwerf-Test-DB.
 */
const onTestDb = process.env.DATABASE_URL?.includes("svuwv_test") ?? false;

const KEYS = ["it_verein_x", "it_primary_shadow"];

describe.skipIf(!onTestDb)("tenant registry control-plane source (integration)", () => {
  beforeAll(async () => {
    await db().delete(tenantsTable).where(inArray(tenantsTable.key, KEYS));
    await db()
      .insert(tenantsTable)
      .values([
        { key: "it_verein_x", databaseUrl: "postgres://db/it_verein_x", displayName: "Verein X" },
        // Eine Zeile mit dem Primär-Schlüssel muss vom DATABASE_URL-Primär überstimmt werden.
        { key: process.env.PRIMARY_TENANT_KEY ?? "svu", databaseUrl: "postgres://db/shadow" },
      ]);
  });

  afterAll(async () => {
    await db()
      .delete(tenantsTable)
      .where(inArray(tenantsTable.key, [...KEYS, process.env.PRIMARY_TENANT_KEY ?? "svu"]));
  });

  it("speist Tabellen-Vereine ein und entschlüsselt die database_url", async () => {
    const tenants = await loadTenants();
    const x = tenants.find((t) => t.key === "it_verein_x");
    expect(x?.databaseUrl).toBe("postgres://db/it_verein_x"); // encryptedText round-trip
    expect(x?.displayName).toBe("Verein X");
    expect(findTenantByKey("it_verein_x")?.databaseUrl).toBe("postgres://db/it_verein_x");
  });

  it("der Primär bleibt aus DATABASE_URL, nicht aus der Tabelle", async () => {
    await loadTenants();
    const primaryKey = process.env.PRIMARY_TENANT_KEY ?? "svu";
    const primary = listTenants().find((t) => t.key === primaryKey);
    expect(primary?.databaseUrl).toBe(process.env.DATABASE_URL);
    expect(primary?.databaseUrl).not.toBe("postgres://db/shadow");
  });
});
