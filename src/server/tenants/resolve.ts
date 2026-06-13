import { listTenants, type Tenant } from "~/server/tenants/registry";

/** Produkt-Domain, unter der Vereine als Subdomain wohnen (`<key>.kontor2.com`).
 * Zur Aufrufzeit gelesen, damit sie ohne Rebuild konfigurierbar bleibt. */
function productDomain(): string {
  return process.env.PRODUCT_DOMAIN ?? "kontor2.com";
}

/**
 * Der primäre Mandant (aus `DATABASE_URL`). Fallback für jeden Host, der keine
 * erkannte `<key>.<produkt-domain>`-Subdomain ist.
 */
export function primaryTenant(): Tenant {
  const [first] = listTenants();
  if (!first) {
    throw new Error("Kein Mandant konfiguriert (DATABASE_URL gesetzt?).");
  }
  return first;
}

/**
 * Bildet den eingehenden Request-Host auf einen Mandanten ab.
 * `<key>.kontor2.com` löst auf den Mandanten mit diesem Schlüssel auf; alles
 * andere (Apex, www, die alte Verein-Domain, eine unbekannte Subdomain) fällt
 * auf den primären Mandanten zurück. Bei nur einem konfigurierten Mandanten
 * landet damit jeder Host bei ihm -- verhaltensgleich zu vorher.
 */
export function resolveTenantFromHost(host: string | null | undefined): Tenant {
  if (!host) return primaryTenant();
  const h = (host.split(":")[0] ?? host).trim().toLowerCase();
  const suffix = `.${productDomain()}`;
  if (h.endsWith(suffix)) {
    // Linkestes Label ist der Mandanten-Schlüssel; tiefere Verschachtelung egal.
    const key = h.slice(0, -suffix.length).split(".")[0];
    const match = key ? listTenants().find((t) => t.key === key) : undefined;
    if (match) return match;
  }
  return primaryTenant();
}
