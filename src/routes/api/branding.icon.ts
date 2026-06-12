import { createFileRoute } from "@tanstack/react-router";

/**
 * Liefert das konfigurierte Logo als Bilddatei -- für Favicon, Apple-Touch-Icon
 * und das Web-Manifest. Kein Resize: der Browser skaliert das Logo selbst, das
 * spart die schwere sharp-Abhängigkeit zur Laufzeit. Ohne konfiguriertes Logo
 * 404, dann verweist der Kopf auf das gebündelte Standard-Favicon.
 *
 * Servercode wird lazy im Handler geladen (siehe api/rpc.$.ts), damit der
 * Servergraph nicht ins Browser-Bundle wandert.
 */
async function handle(): Promise<Response> {
  const [{ db }, { organizationSettingsTable }] = await Promise.all([
    import("~/server/db/client"),
    import("~/server/db/schema/organization-settings"),
  ]);
  const [row] = await db()
    .select({ logo: organizationSettingsTable.logo })
    .from(organizationSettingsTable)
    .limit(1);
  const logo = row?.logo;
  const m = logo ? /^data:(image\/[a-z.+-]+);base64,(.+)$/i.exec(logo) : null;
  if (!m) {
    return new Response("Kein Logo konfiguriert.", { status: 404 });
  }
  const bytes = Buffer.from(m[2]!, "base64");
  return new Response(bytes, {
    headers: {
      "content-type": m[1]!,
      // Inhalt ist über ?v=<hash> versioniert, daher lange cachebar.
      "cache-control": "public, max-age=86400, immutable",
    },
  });
}

export const Route = createFileRoute("/api/branding/icon")({
  server: { handlers: { GET: handle } },
});
