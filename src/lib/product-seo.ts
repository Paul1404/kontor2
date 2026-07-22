export const PRODUCT_ORIGIN = "https://kontor2.com";

export const PRODUCT_TITLE = "Kontor2 | Vereinssoftware für Sportvereine";

export const PRODUCT_DESCRIPTION =
  "Kontor2 verbindet Mitgliederverwaltung, Beiträge, SEPA, Forderungen und Datenschutz in nachvollziehbaren Abläufen für Sportvereine.";

export const PRODUCT_SOCIAL_DESCRIPTION =
  "Vereinssoftware für den echten Verwaltungsalltag. Entwickelt aus der Praxis eines Sportvereins und persönlich als Pilot begleitet.";

export const PRODUCT_PUBLIC_PATHS = ["/", "/impressum", "/datenschutz"] as const;

export function productStructuredData(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${PRODUCT_ORIGIN}/#website`,
        url: `${PRODUCT_ORIGIN}/`,
        name: "Kontor2",
        inLanguage: "de-DE",
        description: PRODUCT_DESCRIPTION,
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${PRODUCT_ORIGIN}/#software`,
        name: "Kontor2",
        url: `${PRODUCT_ORIGIN}/`,
        applicationCategory: "BusinessApplication",
        applicationSubCategory: "Vereinsverwaltung",
        operatingSystem: "Web",
        inLanguage: "de-DE",
        description: PRODUCT_DESCRIPTION,
        audience: {
          "@type": "Audience",
          audienceType: "Sportvereine mit etwa 100 bis 500 Mitgliedern",
        },
        featureList: [
          "Mitgliederverwaltung",
          "Beitragsverwaltung",
          "SEPA-Lastschriften",
          "Forderungen und Mahnwesen",
          "Datenschutzabläufe",
          "Änderungshistorie und Datenqualität",
        ],
      },
    ],
  };
}

export function productRobotsTxt(isPublicHost: boolean): string {
  if (!isPublicHost) return "User-agent: *\nDisallow: /\n";
  return [
    "User-agent: *",
    "Allow: /",
    "Disallow: /api/",
    `Sitemap: ${PRODUCT_ORIGIN}/sitemap.xml`,
    "",
  ].join("\n");
}

export function productSitemapXml(): string {
  const urls = PRODUCT_PUBLIC_PATHS.map(
    (path) => `  <url><loc>${PRODUCT_ORIGIN}${path}</loc></url>`,
  ).join("\n");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    urls,
    "</urlset>",
    "",
  ].join("\n");
}
