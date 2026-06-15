#!/usr/bin/env bun
/**
 * Production-Migrator über ALLE Vereins-DBs. Läuft als `preDeployCommand` (siehe
 * railway.toml) vor dem Go-Live der neuen Version. Wendet die ausstehenden
 * Drizzle-Migrationen auf jede bekannte Vereins-Datenbank an, damit kein Verein
 * bei einer Schema-Änderung hinterherhinkt (vorher migrierte nur der Primär).
 *
 * Reihenfolge & Abbruch:
 *   - Der Primär (DATABASE_URL) wird ZUERST migriert. Schlägt er fehl -> Abbruch
 *     (Exit 1), der Deploy bricht ab und die alte Version bleibt live. So greift
 *     u. a. der Mitgliedsnummer-Guard aus Migration 0048 weiterhin.
 *   - Erst danach wird die Vereinsliste eingesammelt (auch aus der `tenants`-
 *     Tabelle, die der Primär-Lauf gerade aktualisiert hat).
 *   - Danach jeder weitere Verein. Schlägt EINER fehl -> ebenfalls Abbruch, damit
 *     die Schemata aller Vereine im Gleichschritt bleiben.
 *
 * WICHTIG -- schlankes Runtime-Image: dieses Skript läuft im `runner`-Image, das
 * nur `dist/`, `scripts/`, `drizzle/` und `node_modules` enthält, NICHT `src/`.
 * Es darf daher weder `~/server/*` importieren noch die verschlüsselte
 * `database_url` aus der `tenants`-Tabelle entschlüsseln. Tabellen-Vereine werden
 * deshalb ausschließlich über den KLARTEXT-`database_name` gelesen (Verein als
 * eigene DB in der Primär-Instanz; URL = DATABASE_URL mit getauschtem DB-Namen).
 * Zeilen, die NUR eine verschlüsselte `database_url` haben (Fremd-Instanz), kann
 * der Migrator hier nicht auflösen -- die müssten über TENANTS_JSON laufen; wird
 * gewarnt. Plus weiterhin `TENANTS_JSON` als backward-compatible Quelle.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

type TenantTarget = { key: string; databaseUrl: string };

function primaryKey(): string {
  return process.env.PRIMARY_TENANT_KEY ?? "svu";
}

/** Verein-URL aus der Primär-URL ableiten: nur den DB-Namen (Pfad) tauschen. */
function urlForDbName(primaryUrl: string, databaseName: string): string {
  const u = new URL(primaryUrl);
  u.pathname = `/${databaseName}`;
  return u.toString();
}

/** Extra-Vereine aus TENANTS_JSON (kaputtes JSON wird gewarnt und ignoriert). */
function tenantsFromJson(): TenantTarget[] {
  const extra = process.env.TENANTS_JSON;
  if (!extra?.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(extra);
  } catch (e) {
    console.error(`[migrate] TENANTS_JSON ignoriert (kein gültiges JSON): ${(e as Error).message}`);
    return [];
  }
  if (!Array.isArray(parsed)) {
    console.error("[migrate] TENANTS_JSON ist kein Array -- ignoriert");
    return [];
  }
  const out: TenantTarget[] = [];
  for (const raw of parsed) {
    const t = raw as { key?: unknown; databaseUrl?: unknown };
    if (typeof t.key === "string" && typeof t.databaseUrl === "string") {
      out.push({ key: t.key, databaseUrl: t.databaseUrl });
    } else {
      console.error("[migrate] TENANTS_JSON-Eintrag ohne key/databaseUrl übersprungen");
    }
  }
  return out;
}

/** Control-Plane-DB (Registry + Operatoren); Fallback = Primär. */
function controlUrl(primaryUrl: string): string {
  return process.env.CONTROL_DATABASE_URL || primaryUrl;
}

/**
 * Extra-Vereine aus der `tenants`-Tabelle der Control-DB -- nur über den Klartext
 * `database_name`. Läuft NACH deren Migration, die Tabelle ist also aktuell.
 */
async function tenantsFromTable(controlDbUrl: string, primaryUrl: string): Promise<TenantTarget[]> {
  const sql = postgres(controlDbUrl, { max: 1, onnotice: () => {} });
  try {
    const rows = (await sql`
      select key, database_name
      from tenants
      where status = 'active' and database_name is not null
    `) as unknown as Array<{ key: string; database_name: string }>;
    return rows
      .filter((r) => r.key !== primaryKey())
      .map((r) => ({ key: r.key, databaseUrl: urlForDbName(primaryUrl, r.database_name) }));
  } catch (err) {
    console.error(
      `[migrate] tenants-Tabelle nicht lesbar, nur env-Quellen: ${(err as Error).message}`,
    );
    return [];
  } finally {
    await sql.end();
  }
}

async function migrateOne(target: TenantTarget): Promise<void> {
  const sql = postgres(target.databaseUrl, { max: 1, onnotice: () => {} });
  const db = drizzle(sql);
  try {
    await migrate(db, { migrationsFolder: "./drizzle/migrations" });
    console.log(`[migrate] ${target.key}: ok`);
  } finally {
    await sql.end();
  }
}

async function main() {
  const primaryUrl = process.env.DATABASE_URL;
  if (!primaryUrl) {
    console.error("[migrate] DATABASE_URL ist nicht gesetzt");
    process.exit(1);
  }

  // 1. Primär zuerst -- harter Abbruch bei Fehler (wie bisher).
  try {
    await migrateOne({ key: primaryKey(), databaseUrl: primaryUrl });
  } catch (err) {
    console.error(`[migrate] PRIMÄR (${primaryKey()}) fehlgeschlagen:`, (err as Error).message);
    process.exit(1);
  }

  // 2. Control-Plane-DB (Registry + Operatoren), falls eigenständig. Kritisch ->
  //    harter Abbruch bei Fehler.
  const control = controlUrl(primaryUrl);
  if (control !== primaryUrl) {
    try {
      await migrateOne({ key: "control", databaseUrl: control });
    } catch (err) {
      console.error("[migrate] CONTROL-DB fehlgeschlagen:", (err as Error).message);
      process.exit(1);
    }
  }

  // 3. Weitere Vereine einsammeln (Tabelle gewinnt über TENANTS_JSON; Primär raus).
  const secondaries = new Map<string, string>();
  for (const t of tenantsFromJson()) {
    if (t.key !== primaryKey()) secondaries.set(t.key, t.databaseUrl);
  }
  for (const t of await tenantsFromTable(control, primaryUrl)) {
    secondaries.set(t.key, t.databaseUrl);
  }
  const keys = [...secondaries.keys()];
  console.log(`[migrate] ${1 + keys.length} Verein(e): ${[primaryKey(), ...keys].join(", ")}`);

  // 3. Weitere Vereine migrieren -- alle versuchen, am Ende bei Fehler abbrechen.
  const failed: string[] = [];
  for (const [key, databaseUrl] of secondaries) {
    try {
      await migrateOne({ key, databaseUrl });
    } catch (err) {
      failed.push(key);
      console.error(`[migrate] ${key} fehlgeschlagen:`, (err as Error).message);
    }
  }
  if (failed.length > 0) {
    console.error(`[migrate] fehlgeschlagene Vereine: ${failed.join(", ")} -- Deploy bricht ab`);
    process.exit(1);
  }

  console.log(`[migrate] fertig: ${1 + keys.length} Verein(e) migriert`);
}

main().catch((err) => {
  console.error("[migrate] unerwarteter Fehler:", (err as Error).message);
  process.exit(1);
});
