/**
 * Pure server helpers for the Ehrungsverwaltung. No DB or IO, so the title and
 * year derivations stay unit-testable and the procedure layer can rely on one
 * source of truth. The client-safe constants and the title label live in
 * `~/lib/ehrungen` so the report page and member card share them. Free of em/en
 * dashes per the house style.
 */

import { jubilaeumTitel } from "~/lib/ehrungen";

export { jubilaeumTitel };

/**
 * Resolve the stored title for a recorded honor. A blank title is allowed only
 * for a Vereinsjubiläum, where it falls back to the standard wording; a
 * Sonderehrung must name itself.
 */
export function resolveEhrungTitel(
  kind: "vereinsjubilaeum" | "sonderehrung",
  rawTitel: string,
  jubilaeumJahre: number | null,
): string | null {
  const titel = rawTitel.trim();
  if (titel) return titel;
  if (kind === "vereinsjubilaeum" && jubilaeumJahre != null) return jubilaeumTitel(jubilaeumJahre);
  return null;
}

/** Calendar year of an ISO `yyyy-mm-dd` date, or NaN when malformed. */
export function yearOfIso(iso: string): number {
  return Number.parseInt(iso.slice(0, 4), 10);
}

/**
 * The honor year used for grouping and the report cross-reference. An explicit
 * value (the report passes the jubilee year) wins; otherwise it is the year the
 * honor was handed over.
 */
export function resolveEhrungJahr(explicit: number | null, verliehenAm: string): number {
  if (explicit != null) return explicit;
  return yearOfIso(verliehenAm);
}
