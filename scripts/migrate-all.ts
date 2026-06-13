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
 *   - Danach jeder weitere Verein. Schlägt EINER fehl -> ebenfalls Abbruch, damit
 *     die Schemata aller Vereine im Gleichschritt bleiben. Lieber ein roter
 *     Deploy als ein still zurückgebliebener Verein.
 *
 * WICHTIG -- schlankes Runtime-Image: dieses Skript läuft im `runner`-Image, das
 * nur `dist/`, `scripts/`, `drizzle/` und `node_modules` enthält, NICHT `src/`.
 * Es darf daher weder `~/server/*` importieren noch die verschlüsselte
 * `database_url` aus der `tenants`-Tabelle entschlüsseln. Die Vereinsliste kommt
 * deshalb aus den env-Quellen, die das Image lesen kann: `DATABASE_URL` (Primär)
 * und `TENANTS_JSON`. Die Tabellen-basierte Enumeration beim Deploy gehört zu C2
 * (dort wird die DB-Identität so gespeichert, dass das slim-Skript ohne
 * Entschlüsselung URLs bauen kann -- z. B. ein plaintext-DB-Name bei Vereinen
 * derselben Postgres-Instanz). Bis dahin lebt ein Extra-Verein in TENANTS_JSON.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

type TenantTarget = { key: string; databaseUrl: string };

/**
 * Vereinsliste aus den env-Quellen (Primär + TENANTS_JSON), dedupliziert nach
 * Schlüssel (Primär gewinnt). Bewusst eine schlanke Kopie der Logik aus
 * `src/server/tenants/registry.ts` -- letztere ist im Runtime-Image nicht
 * verfügbar (kein `src/`).
 */
function enumerateTenants(): TenantTarget[] {
  const out: TenantTarget[] = [];
  const primary = process.env.DATABASE_URL;
  if (!primary) {
    console.error("[migrate] DATABASE_URL ist nicht gesetzt");
    process.exit(1);
  }
  out.push({ key: process.env.PRIMARY_TENANT_KEY ?? "svu", databaseUrl: primary });

  const extra = process.env.TENANTS_JSON;
  if (extra?.trim()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(extra);
    } catch (e) {
      // Ein kaputtes TENANTS_JSON darf den Primär-Migrationslauf nicht verhindern.
      console.error(
        `[migrate] TENANTS_JSON ignoriert (kein gültiges JSON): ${(e as Error).message}`,
      );
      return out;
    }
    if (Array.isArray(parsed)) {
      for (const raw of parsed) {
        const t = raw as { key?: unknown; databaseUrl?: unknown };
        if (typeof t.key !== "string" || typeof t.databaseUrl !== "string") {
          console.error("[migrate] TENANTS_JSON-Eintrag ohne key/databaseUrl übersprungen");
          continue;
        }
        if (!out.some((x) => x.key === t.key)) {
          out.push({ key: t.key, databaseUrl: t.databaseUrl });
        }
      }
    } else {
      console.error("[migrate] TENANTS_JSON ist kein Array -- ignoriert");
    }
  }
  return out;
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
  const tenants = enumerateTenants();
  console.log(`[migrate] ${tenants.length} Verein(e): ${tenants.map((t) => t.key).join(", ")}`);

  // Primär zuerst -- harter Abbruch bei Fehler (wie bisher).
  const [primary, ...rest] = tenants;
  if (!primary) {
    console.error("[migrate] kein Verein zu migrieren (DATABASE_URL gesetzt?)");
    process.exit(1);
  }
  try {
    await migrateOne(primary);
  } catch (err) {
    console.error(`[migrate] PRIMÄR (${primary.key}) fehlgeschlagen:`, (err as Error).message);
    process.exit(1);
  }

  // Weitere Vereine -- alle versuchen, Fehler sammeln, am Ende hart abbrechen.
  const failed: string[] = [];
  for (const t of rest) {
    try {
      await migrateOne(t);
    } catch (err) {
      failed.push(t.key);
      console.error(`[migrate] ${t.key} fehlgeschlagen:`, (err as Error).message);
    }
  }
  if (failed.length > 0) {
    console.error(`[migrate] fehlgeschlagene Vereine: ${failed.join(", ")} -- Deploy bricht ab`);
    process.exit(1);
  }

  console.log(`[migrate] fertig: ${tenants.length} Verein(e) migriert`);
}

main().catch((err) => {
  console.error("[migrate] unerwarteter Fehler:", (err as Error).message);
  process.exit(1);
});
