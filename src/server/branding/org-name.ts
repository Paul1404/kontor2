import type { DB } from "~/server/db/client";
import { organizationSettingsTable } from "~/server/db/schema/organization-settings";

/**
 * Der konfigurierte Anzeigename des Vereins für member-facing Texte
 * (PDF-Footer, Mail-Betreffs, Seitentitel): Anzeigename, sonst voller
 * Vereinsname, sonst ein neutraler Fallback. Resilient -- wirft nie, damit ein
 * Render oder Versand niemals an der Marke scheitert.
 */
export async function orgDisplayName(db: DB): Promise<string> {
  try {
    const [org] = await db
      .select({
        anzeigename: organizationSettingsTable.anzeigename,
        vereinsname: organizationSettingsTable.vereinsname,
      })
      .from(organizationSettingsTable)
      .limit(1);
    return org?.anzeigename?.trim() || org?.vereinsname?.trim() || "Vereinsverwaltung";
  } catch {
    return "Vereinsverwaltung";
  }
}
