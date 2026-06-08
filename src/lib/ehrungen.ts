/**
 * Client-safe Ehrungen constants and label helpers, shared by the report page,
 * the member card and the server procedures. No server imports, so it can cross
 * the boundary in either direction. Free of em/en dashes per the house style.
 */

/** Standard Vereinsjubiläen offered by the report, in years of membership. */
export const STANDARD_JUBILAEEN = [25, 40, 50, 60, 70, 75] as const;

/**
 * Common Sonderehrungen suggested in the member form. Free text is still
 * allowed; these only seed a datalist so the wording stays consistent.
 */
export const SONDEREHRUNG_VORSCHLAEGE = [
  "Ehrenmitglied",
  "Ehrenvorsitzender",
  "Goldene Ehrennadel",
  "Silberne Ehrennadel",
  "Bronzene Ehrennadel",
  "Vereinsnadel in Gold",
  "Vereinsnadel in Silber",
  "Vereinsnadel in Bronze",
] as const;

/** The default certificate/list title for a membership anniversary. */
export function jubilaeumTitel(jahre: number): string {
  return `${jahre} Jahre Mitgliedschaft`;
}
