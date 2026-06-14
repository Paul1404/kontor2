import { createFileRoute } from "@tanstack/react-router";

/**
 * Dynamisches Web-App-Manifest: Name, Theme-Farbe und Icon kommen aus dem
 * Branding. Mit konfiguriertem Logo zeigt die installierte PWA dieses Logo und
 * den eigenen Vereinsnamen, sonst die gebündelten Standardwerte.
 *
 * Servercode lazy im Handler (siehe api/rpc.$.ts).
 */
async function handle({ request }: { request: Request }): Promise<Response> {
  let name = "Kontor2";
  let themeColor = "#335c99";
  // Default: the Kontor2 logo as a scalable SVG (covers all sizes). The
  // bundled PNG icons are the old SVU shield and would otherwise show as the
  // install icon for any Verein without its own logo.
  let icons: Array<Record<string, string>> = [
    { src: "/logo.svg", type: "image/svg+xml", sizes: "any", purpose: "any" },
    { src: "/logo.svg", type: "image/svg+xml", sizes: "any", purpose: "maskable" },
  ];
  try {
    const [
      { dbForTenant },
      { resolveTenantFromHost },
      { organizationSettingsTable },
      { normalizeHex },
    ] = await Promise.all([
      import("~/server/db/client"),
      import("~/server/tenants/resolve"),
      import("~/server/db/schema/organization-settings"),
      import("~/lib/branding-color"),
    ]);
    // Branding des Vereins DIESES Hosts, nicht der Primär-DB.
    const tenant = resolveTenantFromHost(
      request.headers.get("x-forwarded-host") ?? request.headers.get("host"),
    );
    const [row] = await dbForTenant(tenant.databaseUrl)
      .select({
        vereinsname: organizationSettingsTable.vereinsname,
        anzeigename: organizationSettingsTable.anzeigename,
        logo: organizationSettingsTable.logo,
        primaryColor: organizationSettingsTable.primaryColor,
      })
      .from(organizationSettingsTable)
      .limit(1);
    name = row?.anzeigename?.trim() || row?.vereinsname?.trim() || name;
    themeColor = normalizeHex(row?.primaryColor) ?? themeColor;
    if (row?.logo) {
      // Ein Icon genügt: der Browser skaliert das Logo für alle Größen.
      const type = /^data:(image\/[a-z.+-]+);/i.exec(row.logo)?.[1] ?? "image/png";
      icons = [{ src: "/api/branding/icon", type, sizes: "any", purpose: "any" }];
    }
  } catch {
    // Defaults beibehalten.
  }
  const manifest = {
    name,
    short_name: name.length > 12 ? name.slice(0, 12) : name,
    description: `${name} Vereinsverwaltung`,
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: themeColor,
    icons,
  };
  return new Response(JSON.stringify(manifest), {
    headers: {
      "content-type": "application/manifest+json; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}

export const Route = createFileRoute("/api/branding/manifest")({
  server: { handlers: { GET: handle } },
});
