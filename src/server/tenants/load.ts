/**
 * Control-DB-Loader für die Mandanten-Registry. Hängt den DB-Lookup per
 * Dependency Injection in `registry.ts` ein (das selbst abhängigkeitsfrei
 * bleibt). Liest die `tenants`-Tabelle aus der Control-DB -- vorerst die
 * Primär-/SVU-DB (`DATABASE_URL`).
 *
 * Der primäre Verein wird hier bewusst herausgefiltert: er kommt immer aus
 * `DATABASE_URL` (`primaryTenant()`), damit der Request-Pfad nie an der Tabelle
 * hängt. Eine Tabellen-Zeile mit dem Primär-Schlüssel ist damit wirkungslos.
 */

import { eq } from "drizzle-orm";
import { db } from "~/server/db/client";
import { tenantsTable } from "~/server/db/schema/tenants";
import {
  listTenants,
  refreshTenantsFromDb,
  registerTenantLoader,
  type Tenant,
} from "~/server/tenants/registry";
import { primaryTenant } from "~/server/tenants/resolve";
import { tenantUrlFromName } from "~/server/tenants/url";

async function loadFromControlDb(): Promise<Tenant[]> {
  const primary = primaryTenant();
  const rows = await db()
    .select({
      key: tenantsTable.key,
      databaseName: tenantsTable.databaseName,
      databaseUrl: tenantsTable.databaseUrl,
      displayName: tenantsTable.displayName,
    })
    .from(tenantsTable)
    .where(eq(tenantsTable.status, "active"));
  const out: Tenant[] = [];
  for (const r of rows) {
    if (r.key === primary.key) continue; // Primär kommt aus DATABASE_URL, nie aus der Tabelle.
    // Vorrang: expliziter databaseUrl-Override (Fremd-Instanz), sonst aus dem
    // databaseName auf der Primär-Instanz konstruiert.
    const databaseUrl =
      r.databaseUrl ||
      (r.databaseName ? tenantUrlFromName(primary.databaseUrl, r.databaseName) : "");
    if (!databaseUrl) continue; // sollte durch den CHECK nie passieren.
    out.push({ key: r.key, databaseUrl, displayName: r.displayName ?? undefined });
  }
  return out;
}

let registered = false;

/**
 * Registriert den Control-DB-Loader (idempotent) und stößt ein einmaliges
 * Hintergrund-Reload an. Synchron und billig -- gedacht für den Boot-Guard im
 * Request-Pfad (`createContext`). Bis das erste Reload durch ist, trägt der
 * Primär- bzw. `TENANTS_JSON`-Fallback die Auflösung.
 */
export function ensureTenantRegistryLoader(): void {
  if (registered) return;
  registerTenantLoader(loadFromControlDb);
  registered = true;
  void refreshTenantsFromDb();
}

/**
 * Wie `ensureTenantRegistryLoader`, wartet aber das Reload ab und gibt die
 * fertige Liste zurück. Für Skripte (Backup/Restore) und Boot-Warmup, die die
 * vollständige Liste synchron weiterverwenden wollen.
 */
export async function loadTenants(): Promise<Tenant[]> {
  if (!registered) {
    registerTenantLoader(loadFromControlDb);
    registered = true;
  }
  await refreshTenantsFromDb();
  return listTenants();
}
