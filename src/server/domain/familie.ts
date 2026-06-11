import { ageAt } from "~/server/domain/member";

/**
 * Kindesalter-Grenze der Beitragsordnung: ab 18 zählt jemand nicht mehr als
 * "Kind" einer Familienmitgliedschaft. Nur Heuristik für Vorschläge; die
 * Rolle bleibt im UI frei änderbar.
 */
export const KIND_MAX_ALTER = 18;

/** Rollenvorschlag für einen Familien-Kandidaten: unter 18 Kind, sonst Partner. */
export function rolleVorschlag(
  geburtsdatum: Date | string | null,
  asOf: Date = new Date(),
): "partner" | "kind" {
  const alter = ageAt(geburtsdatum, asOf);
  return alter != null && alter < KIND_MAX_ALTER ? "kind" : "partner";
}

/** Anzeigename-Vorschlag: "Familie <Nachname>", ohne Nachname schlicht "Familie". */
export function familienNameVorschlag(nachname: string | null | undefined): string {
  const n = nachname?.trim();
  return n ? `Familie ${n}` : "Familie";
}
