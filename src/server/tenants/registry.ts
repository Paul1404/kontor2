/**
 * Mandanten-Registry: die eine Wahrheit, welche Vereine es gibt und auf welche
 * Datenbank jeder zeigt. Backup, Migration und der Per-Request-DB-Resolver
 * teilen sich diese Liste -- so muss eine neue Verein-DB nur an EINER Stelle
 * bekannt gemacht werden.
 *
 * Quellen, in dieser Vorrang-Reihenfolge:
 *   1. der **primäre** Verein -- immer synchron aus `DATABASE_URL`,
 *   2. die `tenants`-Tabelle (Control-Plane), eingespeist über einen
 *      In-Memory-Cache (siehe Loader-DI unten),
 *   3. `TENANTS_JSON` als backward-compatible Fallback.
 *
 * Dieses Modul bleibt bewusst abhängigkeitsfrei (nur `process.env` + Logger):
 * der DB-Lookup wird per Dependency Injection (`registerTenantLoader`) von
 * `~/server/tenants/load` eingehängt. So bleibt der heiße Resolver-Pfad synchron
 * und das schlanke Backup-Skript kann die Registry nutzen, ohne zwingend den
 * vollen DB-Graphen zu ziehen.
 */

import { logger } from "~/server/lib/logger";

export type Tenant = {
  /** Stabiler Schlüssel, z. B. "svu". Taucht in Dateinamen und Subdomains auf. */
  key: string;
  databaseUrl: string;
  /** Anzeigename aus der Control-Plane; nur für nicht-primäre Vereine gesetzt. */
  displayName?: string;
};

/** Wie lange ein Tabellen-Snapshot frisch gilt, bevor im Hintergrund neu geladen wird. */
const CACHE_TTL_MS = 60_000;

// --- In-Memory-Cache der DB-Tabellen-Vereine (NICHT der Primär) -------------
let dbSnapshot: Tenant[] = [];
let fetchedAt = 0;
let loader: (() => Promise<Tenant[]>) | null = null;
let inflight: Promise<void> | null = null;

/**
 * Hängt den Control-DB-Loader ein (von `~/server/tenants/load`). Solange keiner
 * registriert ist -- etwa in reinen Unit-Tests -- bleibt die Registry rein
 * env-basiert und stellt nie eine DB-Verbindung her.
 */
export function registerTenantLoader(fn: () => Promise<Tenant[]>): void {
  loader = fn;
}

/** Der zuletzt geladene Tabellen-Snapshot (leer bei Cold-Start / ohne Loader). */
export function cachedDbTenants(): Tenant[] {
  return dbSnapshot;
}

/**
 * Lädt die Tabellen-Vereine neu und aktualisiert den Cache. Parallel-Aufrufe
 * teilen sich denselben In-Flight-Lauf. Fehler werden geschluckt (geloggt) und
 * der bisherige Snapshot bleibt stehen -- der Primär-Fallback trägt den
 * Request-Pfad weiter.
 */
export function refreshTenantsFromDb(): Promise<void> {
  if (!loader) return Promise.resolve();
  if (inflight) return inflight;
  const run = loader;
  inflight = (async () => {
    try {
      dbSnapshot = await run();
      fetchedAt = Date.now();
    } catch (err) {
      logger.warn("tenant registry refresh failed; keeping cached/primary view", {
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Verwirft den Cache und stößt sofort einen Neuladen an (für C2/C4-Schreibpfade). */
export function invalidateTenantCache(): void {
  fetchedAt = 0;
  void refreshTenantsFromDb();
}

/** Feuert im Hintergrund ein TTL-Reload, sobald der Snapshot abgelaufen ist. */
function maybeRefresh(): void {
  if (!loader) return;
  if (Date.now() - fetchedAt > CACHE_TTL_MS) void refreshTenantsFromDb();
}

// --- Env-Quellen ------------------------------------------------------------

/** Der primäre Verein direkt aus `DATABASE_URL`, oder `null` wenn keiner gesetzt ist. */
function primaryFromEnv(): Tenant | null {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return null;
  return { key: process.env.PRIMARY_TENANT_KEY ?? "svu", databaseUrl };
}

/**
 * Parst `TENANTS_JSON`. Wirft bei ungültigem JSON / falscher Form, damit eine
 * kaputte Konfiguration in `listTenants()` und in Skripten sichtbar wird. Der
 * heiße Resolver-Pfad (`findTenantByKey`) fängt diesen Fehler dagegen ab.
 */
function parseTenantsJson(): Tenant[] {
  const extra = process.env.TENANTS_JSON;
  if (!extra?.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(extra);
  } catch (e) {
    throw new Error(`TENANTS_JSON ist kein gültiges JSON: ${(e as Error).message}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error("TENANTS_JSON muss ein Array sein.");
  }
  return parsed.map((raw) => {
    const t = raw as { key?: unknown; databaseUrl?: unknown };
    if (typeof t.key !== "string" || typeof t.databaseUrl !== "string") {
      throw new Error("Jeder TENANTS_JSON-Eintrag braucht 'key' und 'databaseUrl' (Strings).");
    }
    return { key: t.key, databaseUrl: t.databaseUrl };
  });
}

/** Vereint die Quellen nach Vorrang (erster Treffer pro Schlüssel gewinnt). */
function merge(...sources: Tenant[][]): Tenant[] {
  const out: Tenant[] = [];
  const seen = new Set<string>();
  for (const list of sources) {
    for (const t of list) {
      if (seen.has(t.key)) continue;
      seen.add(t.key);
      out.push(t);
    }
  }
  return out;
}

// --- Öffentliche, synchrone API ---------------------------------------------

/**
 * Alle bekannten Vereine, gemerged aus Primär (DATABASE_URL), Tabellen-Cache und
 * `TENANTS_JSON` -- in dieser Vorrang-Reihenfolge. Synchron: liest den
 * vorhandenen Cache und stößt bei Bedarf ein Hintergrund-Reload an, blockiert
 * aber nie. Wirft, wenn `TENANTS_JSON` gesetzt aber kaputt ist (Konfig-Fehler).
 */
export function listTenants(): Tenant[] {
  maybeRefresh();
  const primary = primaryFromEnv();
  return merge(primary ? [primary] : [], dbSnapshot, parseTenantsJson());
}

/**
 * Toleranter Schlüssel-Lookup für den heißen Resolver-Pfad. Wirft NIE: ein
 * kaputtes `TENANTS_JSON` wird geschluckt, damit es nur die Auflösung
 * zusätzlicher Vereine degradiert, nie den Primär ausknockt. Der Primär selbst
 * wird hier nicht behandelt -- den löst `primaryTenant()` separat auf.
 */
export function findTenantByKey(key: string): Tenant | undefined {
  maybeRefresh();
  const fromDb = dbSnapshot.find((t) => t.key === key);
  if (fromDb) return fromDb;
  try {
    return parseTenantsJson().find((t) => t.key === key);
  } catch {
    return undefined;
  }
}

export function resolveTenant(key: string): Tenant {
  const found = listTenants().find((t) => t.key === key);
  if (!found) {
    const known = listTenants()
      .map((t) => t.key)
      .join(", ");
    throw new Error(`Unbekannter Mandant "${key}". Bekannt: ${known || "(keine)"}.`);
  }
  return found;
}
