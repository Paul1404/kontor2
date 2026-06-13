import { findTenantByKey, type Tenant } from "~/server/tenants/registry";

/** Produkt-Domain, unter der Vereine als Subdomain wohnen (`<key>.kontor2.com`).
 * Zur Aufrufzeit gelesen, damit sie ohne Rebuild konfigurierbar bleibt. */
export function productDomain(): string {
  return process.env.PRODUCT_DOMAIN ?? "kontor2.com";
}

/**
 * Subdomain-Label der Betreiber-Console (`<console>.kontor2.com`, Default
 * "admin"). Reserviert -- kein Verein darf diesen Schlüssel haben.
 */
export function consoleSubdomain(): string {
  return process.env.CONSOLE_SUBDOMAIN ?? "admin";
}

/** Control-Plane-DB-Verbindung (env-only, slim). Fallback: DATABASE_URL. */
function controlDatabaseUrl(): string {
  const url = process.env.CONTROL_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("Kein Mandant konfiguriert (DATABASE_URL gesetzt?).");
  return url;
}

/**
 * Der „Mandant" der Betreiber-Console: KEIN Verein, sondern der Operator-Realm
 * auf der Control-DB. Sein `key` ist die Console-Subdomain, damit Auth-baseURL
 * (`https://<console>.kontor2.com`) und Redis-Namespace sauber getrennt sind.
 * Operatoren sind die Accounts in dieser DB.
 */
export function operatorTenant(): Tenant {
  return { key: consoleSubdomain(), databaseUrl: controlDatabaseUrl() };
}

/** Ob ein Mandant der Operator-/Console-Realm ist (nicht ein Verein). */
export function isOperatorTenant(tenant: Tenant): boolean {
  return tenant.key === consoleSubdomain();
}

/**
 * Der primäre Mandant -- direkt aus `DATABASE_URL`, bewusst OHNE `TENANTS_JSON`
 * zu parsen. So fällt der Request-Pfad selbst bei kaputtem `TENANTS_JSON` nicht
 * aus: der primäre Verein bleibt immer auflösbar.
 */
export function primaryTenant(): Tenant {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("Kein Mandant konfiguriert (DATABASE_URL gesetzt?).");
  }
  return { key: process.env.PRIMARY_TENANT_KEY ?? "svu", databaseUrl };
}

/** Host der konfigurierten Auth-/Alt-Domain (BETTER_AUTH_URL), z. B. die alte
 * Vereins-Domain. Dieser Host bedient weiterhin den Default-Verein. */
function authDomainHost(): string | null {
  const raw = process.env.BETTER_AUTH_URL;
  if (!raw) return null;
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Bildet den eingehenden Request-Host auf einen Mandanten ab.
 *
 * - `<console>.kontor2.com` und alles Unbekannte (apex, www, eine NICHT
 *   registrierte Subdomain, fremde Hosts) -> Betreiber-Realm (Control-DB). Eine
 *   vertippte Subdomain bekommt also die Console-Anmeldung, NICHT mehr still die
 *   Daten des Default-Vereins.
 * - `<key>.kontor2.com` einer registrierten Verein-Subdomain -> dieser Verein
 *   (über `findTenantByKey`, Tabellen-Cache).
 * - Die Auth-/Alt-Domain (BETTER_AUTH_URL-Host) und die Subdomain des
 *   Default-Vereins -> Default-Verein; bei kaltem Cache fällt das synchron auf
 *   `primaryTenant()` (DATABASE_URL) zurück, damit der Default immer auflösbar bleibt.
 */
export function resolveTenantFromHost(host: string | null | undefined): Tenant {
  const primary = primaryTenant();
  // Kein Host (interne/Health-Requests): konservativ der Default-Verein.
  if (!host) return primary;
  const h = (host.split(":")[0] ?? host).trim().toLowerCase();

  // Auth-/Alt-Domain -> Default-Verein (Cold-Start-sicher über primaryTenant).
  if (h === authDomainHost()) return findTenantByKey(primary.key) ?? primary;

  const suffix = `.${productDomain()}`;
  if (h.endsWith(suffix)) {
    // Linkestes Label ist der Mandanten-Schlüssel; tiefere Verschachtelung egal.
    const key = h.slice(0, -suffix.length).split(".")[0];
    if (key === consoleSubdomain()) return operatorTenant();
    if (key) {
      const match = findTenantByKey(key);
      if (match) return match;
      // Default-Verein-Subdomain bei kaltem Cache: synchroner Anker.
      if (key === primary.key) return primary;
    }
  }
  // Unbekannte Subdomain / apex / fremder Host -> Betreiber-Realm, nicht der Default-Verein.
  return operatorTenant();
}
