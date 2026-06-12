import { createFileRoute } from "@tanstack/react-router";

/**
 * Dynamisches Web-App-Manifest: Name, Theme-Farbe und Icon kommen aus dem
 * Branding. Mit konfiguriertem Logo zeigt die installierte PWA dieses Logo und
 * den eigenen Vereinsnamen, sonst die gebündelten Standardwerte.
 *
 * Servercode lazy im Handler (siehe api/rpc.$.ts).
 */
async function handle(): Promise<Response> {
  let name = "Vereinsverwaltung";
  let themeColor = "#dc2626";
  let icons: Array<Record<string, string>> = [
    { src: "/favicon.svg", type: "image/svg+xml", sizes: "any" },
    { src: "/icon-192.png", type: "image/png", sizes: "192x192" },
    { src: "/icon-512.png", type: "image/png", sizes: "512x512" },
    { src: "/icon-512.png", type: "image/png", sizes: "512x512", purpose: "maskable" },
  ];
  try {
    const [{ db }, { organizationSettingsTable }, { normalizeHex }] = await Promise.all([
      import("~/server/db/client"),
      import("~/server/db/schema/organization-settings"),
      import("~/lib/branding-color"),
    ]);
    const [row] = await db()
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
