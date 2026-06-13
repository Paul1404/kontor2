/**
 * Provisioning eines neuen Vereins (Control-Plane C2a): eigene DB in der Primär-
 * Instanz anlegen, auf den aktuellen Schemastand migrieren, `tenants`-Zeile
 * eintragen. Bewusst eigenständig (postgres-js + Drizzle-Migrator direkt, KEINE
 * App-`db()`, KEINE Krypto): die DB-Identität wird als Klartext `database_name`
 * gespeichert, daher wird kein APP_SECRET gebraucht. So läuft dasselbe sowohl im
 * `provision-tenant`-Skript (via `railway run`) als auch im Integrationstest.
 *
 * Voraussetzung: der PG-User der `adminUrl` ist Superuser (CREATE DATABASE).
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { tenantUrlFromName } from "~/server/tenants/url";

/** Subdomain-Label. */
export const TENANT_KEY_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
/** Sicherer PG-Identifier (wird gequotet eingesetzt). */
export const DB_NAME_RE = /^[a-z0-9_]+$/;

const MIGRATIONS_FOLDER = "./drizzle/migrations";

export type ProvisionInput = {
  /** Verein-Schlüssel = Subdomain-Label. */
  key: string;
  /** Anzeigename für die Verwaltung. */
  displayName: string;
  /** DB-Name in der Primär-Instanz. Default: `key`. */
  databaseName?: string;
  /** Primär-Schlüssel (zum Schutz vor Selbst-Provisionierung). Default "svu". */
  primaryKey?: string;
};

function validate(key: string, dbName: string, primaryKey: string): void {
  if (!TENANT_KEY_RE.test(key)) {
    throw new Error(`Ungültiger Schlüssel "${key}" (erlaubt: a-z, 0-9, '-').`);
  }
  if (!DB_NAME_RE.test(dbName)) {
    throw new Error(`Ungültiger DB-Name "${dbName}" (erlaubt: a-z, 0-9, '_').`);
  }
  if (key === primaryKey) {
    throw new Error(`"${key}" ist der Primär-Schlüssel -- nicht provisionierbar.`);
  }
}

/**
 * Legt die Verein-DB an (idempotent), migriert sie und schreibt die tenants-Zeile.
 * `adminUrl` muss auf die Primär-/Control-DB zeigen (dort lebt die tenants-Tabelle).
 */
export async function provisionTenant(adminUrl: string, input: ProvisionInput): Promise<void> {
  const dbName = input.databaseName ?? input.key;
  validate(input.key, dbName, input.primaryKey ?? "svu");

  // 1. CREATE DATABASE (tolerant, falls bereits vorhanden -- 42P04).
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`CREATE DATABASE "${dbName}"`);
  } catch (err) {
    if ((err as { code?: string }).code !== "42P04") throw err;
  } finally {
    await admin.end();
  }

  // 2. Migrationen auf die neue DB (idempotent via Drizzle-Journal).
  const target = postgres(tenantUrlFromName(adminUrl, dbName), { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(target), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await target.end();
  }

  // 3. tenants-Zeile (Klartext database_name, keine verschlüsselte URL).
  const control = postgres(adminUrl, { max: 1, onnotice: () => {} });
  try {
    await control`
      insert into tenants (key, database_name, display_name, status)
      values (${input.key}, ${dbName}, ${input.displayName}, 'active')
      on conflict (key) do update
        set database_name = excluded.database_name,
            display_name = excluded.display_name,
            status = 'active',
            updated_at = now()
    `;
  } finally {
    await control.end();
  }
}

/** Entfernt die tenants-Zeile und droppt die DB (für Aufräumen/Tests). */
export async function deprovisionTenant(
  adminUrl: string,
  input: { key: string; databaseName?: string },
): Promise<void> {
  const dbName = input.databaseName ?? input.key;
  if (!DB_NAME_RE.test(dbName)) throw new Error(`Ungültiger DB-Name "${dbName}".`);

  // tenants-Zeile zuerst, damit der Resolver nicht auf eine gleich gelöschte DB zeigt.
  const control = postgres(adminUrl, { max: 1, onnotice: () => {} });
  try {
    await control`delete from tenants where key = ${input.key}`;
  } finally {
    await control.end();
  }
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  } finally {
    await admin.end();
  }
}
