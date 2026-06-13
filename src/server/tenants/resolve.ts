import { logger } from "~/server/lib/logger";
import { listTenants, type Tenant } from "~/server/tenants/registry";

/** Produkt-Domain, unter der Vereine als Subdomain wohnen (`<key>.kontor2.com`).
 * Zur Aufrufzeit gelesen, damit sie ohne Rebuild konfigurierbar bleibt. */
function productDomain(): string {
  return process.env.PRODUCT_DOMAIN ?? "kontor2.com";
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
 * auf den primären Mandanten zurück. Ein kaputtes `TENANTS_JSON` betrifft nur
 * die Auflösung zusätzlicher Vereine -- der primäre bleibt unberührt.
 */
export function resolveTenantFromHost(host: string | null | undefined): Tenant {
  const primary = primaryTenant();
  if (!host) return primary;
  const h = (host.split(":")[0] ?? host).trim().toLowerCase();
  const suffix = `.${productDomain()}`;
  if (h.endsWith(suffix)) {
    // Linkestes Label ist der Mandanten-Schlüssel; tiefere Verschachtelung egal.
    const key = h.slice(0, -suffix.length).split(".")[0];
    if (key && key !== primary.key) {
      try {
        const match = listTenants().find((t) => t.key === key);
        if (match) return match;
      } catch (err) {
        // Kaputtes TENANTS_JSON darf den primären Mandanten nicht ausknocken.
        logger.warn("tenant resolution fell back to primary", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
  return primary;
}
