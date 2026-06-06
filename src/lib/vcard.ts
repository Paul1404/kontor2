/**
 * Build a minimal vCard 3.0 from a member. vCard 3.0 (RFC 2426) is the
 * format that iOS Contacts and macOS Contacts accept without complaints;
 * 4.0 works for Android but breaks the cleartext-name display on some
 * older Apple builds.
 *
 * Line folding (RFC 2425 §5.8.1, 75-char limit) is skipped: real-world
 * member fields are short and folding adds more risk of breaking sniffer
 * heuristics than it solves.
 */
export type VCardInput = {
  vorname?: string | null;
  nachname?: string | null;
  titel?: string | null;
  firma?: string | null;
  funktion?: string | null;
  email?: string | null;
  telefon?: string | null;
  mobil?: string | null;
  strasse?: string | null;
  hausnummer?: string | null;
  plz?: string | null;
  ort?: string | null;
  land?: string | null;
  geburtsdatum?: string | Date | null;
  website?: string | null;
  mitgliedsnummer?: string | null;
};

function escapeVcard(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

function line(key: string, value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return `${key}:${escapeVcard(trimmed)}`;
}

function isoDateOnly(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const d = typeof value === "string" ? new Date(value) : value;
  if (!Number.isFinite(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function buildVCard(m: VCardInput): string {
  const nachname = (m.nachname ?? "").trim();
  const vorname = (m.vorname ?? "").trim();
  const titel = (m.titel ?? "").trim();
  const fullName = [titel, vorname, nachname].filter(Boolean).join(" ").trim() || "Unbekannt";

  // N: FamilyName;GivenName;AdditionalNames;Prefixes;Suffixes
  const n = `${escapeVcard(nachname)};${escapeVcard(vorname)};;${escapeVcard(titel)};`;

  // ADR: PO Box;Extended;Street;City;Region;PostalCode;Country
  const street = `${m.strasse ?? ""} ${m.hausnummer ?? ""}`.trim();
  const hasAddr = street || m.plz || m.ort;
  const adr = hasAddr
    ? `;;${escapeVcard(street)};${escapeVcard(m.ort ?? "")};;${escapeVcard(m.plz ?? "")};${escapeVcard(m.land ?? "")}`
    : null;

  const bday = isoDateOnly(m.geburtsdatum ?? null);
  const note = m.mitgliedsnummer ? `Mitgliedsnummer: ${m.mitgliedsnummer}` : null;

  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN:${escapeVcard(fullName)}`,
    `N:${n}`,
    line("ORG", m.firma),
    line("TITLE", m.funktion),
    m.email ? `EMAIL;TYPE=INTERNET:${escapeVcard(m.email.trim())}` : null,
    m.telefon ? `TEL;TYPE=VOICE:${escapeVcard(m.telefon.trim())}` : null,
    m.mobil ? `TEL;TYPE=CELL:${escapeVcard(m.mobil.trim())}` : null,
    adr ? `ADR;TYPE=HOME:${adr}` : null,
    bday ? `BDAY:${bday}` : null,
    line("URL", m.website),
    line("NOTE", note),
    "END:VCARD",
  ].filter((l): l is string => l != null);

  // vCard requires CRLF line endings per RFC 2426 §2.4.2.
  return `${lines.join("\r\n")}\r\n`;
}

export function vcardFilename(m: VCardInput): string {
  const safe =
    [m.vorname, m.nachname]
      .filter(Boolean)
      .join("-")
      .replace(/[^a-zA-Z0-9_-]+/g, "_") || `mitglied-${m.mitgliedsnummer ?? "unbekannt"}`;
  return `${safe}.vcf`;
}
