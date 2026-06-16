/**
 * Maps a Datenqualitäts-Befund to the member Stammdaten field an operator
 * should fix, so the cockpit can deep-link into the edit form scrolled to and
 * focused on that field (see MemberStammdatenForm `focusField`, where the
 * inputs carry `id="mf-<field>"`).
 *
 * Only categories with a single obvious field to fill are listed. Categories
 * that need a workflow (merge, Beitragsart, mandate) or are typically just
 * acknowledged have no entry and get no edit deep-link.
 */
const FOKUS_FIELD: Record<string, string> = {
  name_fehlt: "nachname",
  fehlende_adresse: "strasse",
  strasse_ohne_hausnummer: "hausnummer",
  plz_ungueltig: "plz",
  fehlende_email: "email",
  email_ungueltig: "email",
  telefon_nur_vorwahl: "telefon1",
  fehlende_iban: "iban1",
  geburtsdatum_unplausibel: "geburtsdatum",
  geschlecht_unbekannt: "geschlecht",
  eintritt_nach_austritt: "austritt",
  minderjaehrig_ohne_vertretung: "vertreterName",
};

/** The Stammdaten field to focus for a finding, or null when there is none. */
export function fokusFieldFor(category: string): string | null {
  return FOKUS_FIELD[category] ?? null;
}
