import { describe, expect, it } from "vitest";
import { fokusFieldFor } from "~/lib/dq-fix-fields";

// The Stammdaten fields the member edit form exposes via id="mf-<field>".
const KNOWN_FIELDS = new Set([
  "nachname",
  "strasse",
  "hausnummer",
  "plz",
  "email",
  "telefon1",
  "iban1",
  "geburtsdatum",
  "geschlecht",
  "austritt",
  "vertreterName",
]);

describe("fokusFieldFor", () => {
  it("maps each guided finding to a focusable Stammdaten field", () => {
    const guided = [
      "name_fehlt",
      "fehlende_adresse",
      "strasse_ohne_hausnummer",
      "plz_ungueltig",
      "fehlende_email",
      "email_ungueltig",
      "telefon_nur_vorwahl",
      "fehlende_iban",
      "geburtsdatum_unplausibel",
      "beziehung_gleiches_geburtsdatum",
      "geschlecht_unbekannt",
      "eintritt_nach_austritt",
      "minderjaehrig_ohne_vertretung",
    ];
    for (const c of guided) {
      const field = fokusFieldFor(c);
      expect(field, c).not.toBeNull();
      expect(KNOWN_FIELDS.has(field as string), `${c} -> ${field}`).toBe(true);
    }
  });

  it("returns null for findings without a single obvious field", () => {
    // Workflow / acknowledge-only categories get no edit deep-link.
    for (const c of [
      "moegliche_dubletten",
      "mitgliedsnummer_kollision",
      "mahnsperre_gesetzt",
      "email_mehrfach",
      "lastschrift_ohne_mandat",
      "name_reihenfolge_vertauscht",
      "vertrag_betrag_null",
    ]) {
      expect(fokusFieldFor(c), c).toBeNull();
    }
  });
});
