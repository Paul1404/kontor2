/**
 * Easter egg data: the genuinely-real "Hall of Shame" of the legacy Linear
 * Webverein database that this app replaced. Every number and column name here
 * was mined from `reference/linear/schema.sql` (the actual production dump),
 * not invented. Rendered by the hidden `/app/museum` route.
 *
 * Kept as static data on purpose: the schema dump is a build-time reference and
 * is not shipped into the runtime container, so we curate the highlights here
 * rather than parse a file at runtime.
 */

export const LEGACY_STATS = {
  /** CREATE TABLE statements in the dump. */
  tables: 198,
  /** Columns summed across every table. */
  totalColumns: 3680,
  /** The single widest table. */
  widestTable: { name: "rechn", columns: 280 },
  /** The members/address table this app mirrors. */
  adresseColumns: 247,
  /** Columns anywhere with "Konto" in the name. */
  kontoColumns: 192,
} as const;

export type Exhibit = {
  /** Short German headline. */
  title: string;
  /** Optional big number / label shown next to the title. */
  stat?: string;
  /** The punchline. German, dry. */
  blurb: string;
  /** Real column or table names as evidence. */
  evidence?: string[];
};

export const LEGACY_EXHIBITS: Exhibit[] = [
  {
    title: "Die Gesamtbilanz",
    stat: "198 Tabellen",
    blurb:
      "198 Tabellen mit zusammen 3.680 Spalten. Eine Vereinsverwaltung, kein Konzern-Rechnungswesen. Dachte man.",
  },
  {
    title: "Die breiteste Tabelle",
    stat: "280 Spalten",
    blurb:
      "Die Tabelle rechn hat 280 Spalten. In einer einzigen Zeile. Niemand hat je alle gesehen.",
    evidence: ["rechn (280)", "adresse (247)", "mandstam (236)"],
  },
  {
    title: "Eine Adresse, 247 Spalten",
    stat: "247 Spalten",
    blurb:
      "Für Name und Anschrift eines Mitglieds reichten 247 Spalten. Wir kommen heute mit rund 50 aus.",
  },
  {
    title: "Sieben Telefonnummern, falsch sortiert",
    blurb:
      "Sieben Telefonspalten. Durchnummeriert als Telefon1, Telefon2, Telefon4, Telefon5, Telefon6, Telefon7. Telefon3 steht ganz woanders, weit hinten. Niemand weiß warum.",
    evidence: ["Telefon1", "Telefon2", "Telefon4", "Telefon5", "Telefon6", "Telefon7", "Telefon3"],
  },
  {
    title: "Sechs Bankverbindungen, im Klartext",
    blurb:
      "Bank1 bis Bank6, BLZ1 bis BLZ6, Konto1 bis Konto6. Plus IBAN1 bis IBAN3 und BIC1 bis BIC3. Verschlüsselt war davon nichts.",
    evidence: ["Bank1…Bank6", "BLZ1…BLZ6", "Konto1…Konto6", "IBAN1…IBAN3", "BIC1…BIC3"],
  },
  {
    title: "Kreditkarte. In der Adresstabelle. Im Klartext.",
    blurb:
      "Kreditkartennummer, Verfallsdatum, Karteninhaber und Kartenname. Vier Spalten, mitten zwischen Postleitzahl und Geburtsort.",
    evidence: ["Kreditkartennummer", "Verfallsdatum", "Kreditkartenhalter", "Kreditkartenname"],
  },
  {
    title: "Das Meisterwerk",
    blurb:
      "Zwei Spalten für dieselbe Einwilligung. Einmal richtig geschrieben, einmal mit Tippfehler. Beide existieren bis heute nebeneinander.",
    evidence: ["EinverstandnisDatenverarbeitung", "EinverstandisDatenverarbeitung"],
  },
  {
    title: "Sperre mit Tippfehler",
    blurb:
      "MahnSperre war korrekt. Daneben Zahl_Spere, einmal das e in der Sperre vergessen. Funktional gemeint, orthografisch gescheitert.",
    evidence: ["MahnSperre", "Zahl_Spere", "Zahl_Kont", "Zahl_Wied", "Zahl_Bem"],
  },
  {
    title: "Zehn namenlose Häkchen",
    blurb:
      "CheckBox1 bis CheckBox10. Was sie bedeuteten, wusste vielleicht eine Person. Die ist längst weg.",
    evidence: ["CheckBox1…CheckBox10", "Attribut1…Attribut3", "FreeBit1", "FreeBit2"],
  },
  {
    title: "Vier Freitextfelder für den Rest",
    blurb:
      "FreeText1 bis FreeText4. Der digitale Schuhkarton für alles, wofür es keine Spalte gab. Es gab fast für alles eine Spalte.",
    evidence: ["FreeText1", "FreeText2", "FreeText3", "FreeText4"],
  },
  {
    title: "Drei Adressen pro Adresse",
    blurb:
      "Neben der Adresse noch ein kompletter Block für Rechnung, einer für Lieferung und einer für Post. Jeweils mit eigener Straße, PLZ und Ort.",
    evidence: ["Strasse_Rech", "Strasse_Lief", "Strasse_Post", "PLZ_Rech_Postf"],
  },
  {
    title: "Konto, überall Konto",
    stat: "192 Spalten",
    blurb:
      "192 Spalten im gesamten Schema tragen Konto im Namen. DEBITORKTO, KREDITORKTO und 190 weitere Verwandte.",
    evidence: ["DEBITORKTO", "KREDITORKTO", "Zahl_Kont", "MaxKont"],
  },
  {
    title: "Der längste Spaltenname",
    stat: "31 Zeichen",
    blurb:
      "EinverstandnisDatenverarbeitung, 31 Zeichen. Dicht gefolgt von den Freistellungsbescheid-Spalten der mandstam-Tabelle.",
    evidence: [
      "FreistellungsbescheidBeantragt",
      "FreistellungsbescheidGultigVon",
      "FreistellungsbescheidGultigBis",
    ],
  },
];
