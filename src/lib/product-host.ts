/** Normalises a request host for comparisons, including local ports. */
export function normalizeProductHost(host: string | null | undefined): string | null {
  if (!host) return null;
  const trimmed = host.trim().toLowerCase();
  if (!trimmed) return null;
  if (trimmed.startsWith("[")) {
    return trimmed.slice(1, trimmed.indexOf("]")).trim() || null;
  }
  return (trimmed.split(":")[0] ?? trimmed).trim() || null;
}

/** The product website owns the apex and its conventional www alias. */
export function isPublicProductHost(
  host: string | null | undefined,
  productDomain = "kontor2.com",
): boolean {
  const normalized = normalizeProductHost(host);
  const domain = normalizeProductHost(productDomain);
  return Boolean(normalized && domain && (normalized === domain || normalized === `www.${domain}`));
}

const PUBLIC_PRODUCT_PATHS = new Set([
  "/",
  "/impressum",
  "/datenschutz",
  "/robots.txt",
  "/sitemap.xml",
]);

/** Only these pages are published on the product apex. App routes stay tenant-only. */
export function isPublicProductPath(pathname: string): boolean {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return PUBLIC_PRODUCT_PATHS.has(normalized) || normalized.startsWith("/api/");
}
