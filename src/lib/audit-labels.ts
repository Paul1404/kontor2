import { formatDate, formatDateTime } from "~/lib/format";

/**
 * Human-readable labels for the DB column names that show up in audit
 * diffs. Anything not in this map falls back to the column name (just
 * cosmetic — the audit log stays self-explanatory).
 */
const FIELD_LABELS: Record<string, string> = {
  // member
  anrede: "Anrede",
  titel1: "Titel",
  titel2: "Titelzusatz",
  vorname: "Vorname",
  nachname: "Nachname",
  geborene: "Geburtsname",
  geburtsname: "Geburtsname",
  geburtsdatum: "Geburtsdatum",
  geburtsort: "Geburtsort",
  strasse: "Straße",
  hausnummer: "Hausnummer",
  plz: "PLZ",
  ort: "Ort",
  land: "Land",
  telefon1: "Telefon",
  telefon2: "Mobil",
  eMailName: "E-Mail",
  www: "Website",
  firma1: "Firma",
  funktion: "Funktion",
  spender: "Spender",
  adresszusatz: "Adresszusatz",
  geschlecht: "Geschlecht",
  sportart: "Sportart",
  verbandName: "Verband",
  verbandNr: "Verband-Nr.",
  inaktiv: "Inaktiv",
  eintritt: "Eintritt",
  austritt: "Austritt",
  verstorbenAm: "Verstorben am",
  aktivPasiv: "Status (A/P)",
  bank1: "Bank",
  bic1: "BIC",
  iban1: "IBAN",
  iban1Last4: "IBAN (letzte 4)",
  abwKontoInh: "Kontoinhaber (abweichend)",
  mandatsrefenz: "Mandatsreferenz",
  mitglnr: "Mitgliedsnummer",
  adrNr: "AdrNr",
  notes: "Notizen",
  deletedAt: "Gelöscht am",
  // contracts
  vertragNr: "Vertragsnummer",
  art: "Art",
  artName: "Bezeichnung",
  betrag: "Betrag",
  aufnahmegeb: "Aufnahmegebühr",
  sollstellung: "Sollstellung",
  vertragBegin: "Vertragsbeginn",
  vertragEnde: "Vertragsende",
  gekuendAm: "Gekündigt am",
  gekuendZum: "Gekündigt zum",
  // sepa
  mandatsNr: "Mandatsreferenz",
  lastschriftart: "Lastschriftart",
  typ: "Typ",
  status: "Status",
  unterschriftDatum: "Unterschrift",
  gueltigAb: "Gültig ab",
  gultigBis: "Gültig bis",
  widerrufenAm: "Widerrufen am",
  isDeleted: "Gelöscht",
  angelegtAm: "Angelegt am",
  // fee type
  bezeichnung: "Bezeichnung",
  abteilung: "Abteilung",
  betrag1: "Betrag",
  kontoname: "Konto",
  valuta: "Valuta",
  nichAktiv: "Inaktiv",
};

const HIDDEN_FIELDS = new Set(["updatedAt", "createdAt", "lastImportedAt", "importBatchId"]);

const DATE_FIELDS = new Set([
  "geburtsdatum",
  "eintritt",
  "austritt",
  "verstorbenAm",
  "deletedAt",
  "vertragBegin",
  "vertragEnde",
  "gekuendAm",
  "gekuendZum",
  "unterschriftDatum",
  "gueltigAb",
  "gultigBis",
  "widerrufenAm",
  "angelegtAm",
]);

export function fieldLabel(name: string): string {
  return FIELD_LABELS[name] ?? name;
}

export function isHiddenField(name: string): boolean {
  return HIDDEN_FIELDS.has(name);
}

/**
 * Render an audit-log value into a string a human can skim. Dates are
 * formatted, booleans become Ja/Nein, null/empty become "—".
 */
export function formatAuditValue(field: string, value: unknown): string {
  if (value == null || value === "") return "—";
  if (typeof value === "boolean") return value ? "Ja" : "Nein";
  if (typeof value === "number") return String(value);
  if (DATE_FIELDS.has(field)) {
    if (field === "deletedAt") return formatDateTime(value as string);
    return formatDate(value as string);
  }
  if (field === "aktivPasiv") {
    return value === "A" ? "Aktiv" : value === "P" ? "Passiv" : String(value);
  }
  if (field === "geschlecht") {
    return value === "m"
      ? "Männlich"
      : value === "w"
        ? "Weiblich"
        : value === "d"
          ? "Divers"
          : value === "unbekannt"
            ? "Unbekannt"
            : String(value);
  }
  if (field === "spender") return value === "J" ? "Ja" : "Nein";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

const ENTITY_LABELS: Record<string, string> = {
  member: "Mitglied",
  member_attachment: "Anhang",
  contract: "Vertrag",
  sepa_mandate: "SEPA-Mandat",
  fee_type: "Beitragsart",
  organization_settings: "Vereinseinstellungen",
  abteilung: "Abteilung",
  relationship: "Beziehung",
};

export function entityLabel(name: string): string {
  return ENTITY_LABELS[name] ?? name;
}

const ACTION_LABELS: Record<string, string> = {
  create: "Angelegt",
  update: "Geändert",
  delete: "Gelöscht",
  restore: "Wiederhergestellt",
};

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}
