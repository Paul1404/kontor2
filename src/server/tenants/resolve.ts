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

/**
 * Bildet den eingehenden Request-Host auf einen Mandanten ab.
 * `<key>.kontor2.com` löst auf den Mandanten mit diesem Schlüssel auf; alles
 * andere (Apex, www, die alte Verein-Domain, eine unbekannte Subdomain) fällt
 * auf den primären Mandanten zurück. Die Auflösung zusätzlicher Vereine läuft
 * über `findTenantByKey` (Tabellen-Cache + `TENANTS_JSON`-Fallback) und wirft
 * nie -- ein kaputtes `TENANTS_JSON` degradiert nur Extra-Vereine, der primäre
 * bleibt unberührt.
 */
export function resolveTenantFromHost(host: string | null | undefined): Tenant {
  const primary = primaryTenant();
  if (!host) return primary;
  const h = (host.split(":")[0] ?? host).trim().toLowerCase();
  const suffix = `.${productDomain()}`;
  if (h.endsWith(suffix)) {
    // Linkestes Label ist der Mandanten-Schlüssel; tiefere Verschachtelung egal.
    const key = h.slice(0, -suffix.length).split(".")[0];
    // Console-Subdomain -> Operator-Realm (Control-DB), kein Verein.
    if (key === consoleSubdomain()) return operatorTenant();
    if (key && key !== primary.key) {
      const match = findTenantByKey(key);
      if (match) return match;
    }
  }
  return primary;
}
