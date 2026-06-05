/**
 * Canonical member domain model and the normalizations that turn Linear's
 * legacy shape into clean domain values.
 *
 * This module is the single source of truth for: deriving a member's status,
 * resolving a display name and a canonical reference, and interpreting the
 * legacy flag columns (text "J"/""/"0" instead of booleans). Procedures,
 * dunning, SEPA and reports should read these helpers rather than
 * reinterpreting raw Linear columns inline.
 *
 * Pure module: no database or importer dependencies, so it stays cheap to
 * import and easy to test.
 */

/** A member's lifecycle status, derived from dates + the legacy A/P flag. */
export type MemberStatus = "aktiv" | "passiv" | "ausgetreten" | "verstorben";

/** Minimal fields needed to render a member's name. */
export type MemberNameParts = {
  vorname: string | null;
  nachname: string | null;
  kurzname: string | null;
  firma1: string | null;
  /** Legacy human-readable Mitgliedsnummer (Linear `MITGLNR`). */
  mitglnr?: string | null;
  /** Legacy address number (Linear `AdrNr`); the real unique key. */
  adrNr?: number;
};

/** Fields needed to decide a member's lifecycle status. */
export type MemberStatusParts = {
  austritt: Date | string | null;
  verstorbenAm: Date | string | null;
  /** Legacy active/passive flag (Linear `AktivPasiv`): "A", "P", or null. */
  aktivPasiv: string | null;
};

/**
 * Interpret Linear's free-form yes/no text columns as a boolean. Linear stored
 * single-letter codes loosely, so "J"/"Y"/"1" mean yes, "N"/"0"/"" mean no,
 * and anything else is unknown (null).
 */
export function yesNoToBool(value: string | boolean | null | undefined): boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value;
  const s = value.trim().toUpperCase();
  if (s === "Y" || s === "J" || s === "1") return true;
  if (s === "N" || s === "0" || s === "") return false;
  return null;
}

/**
 * Whether a member's `mahnSperre` (dunning block) flag suppresses dunning.
 * The legacy Linear column is free-form; an empty/whitespace-only value and the
 * sentinel "0" mean "not blocked", anything else means blocked. Trimming
 * matters: a stray space must not silently block all dunning.
 */
export function isDunningBlocked(mahnSperre: string | null | undefined): boolean {
  if (!mahnSperre) return false;
  const v = mahnSperre.trim();
  return v !== "" && v !== "0";
}

/** Age in whole years at `asOf`, or null when the birthdate is missing/invalid. */
export function ageAt(birth: Date | string | null | undefined, asOf: Date): number | null {
  if (!birth) return null;
  const b = birth instanceof Date ? birth : new Date(birth);
  if (!Number.isFinite(b.getTime())) return null;
  let age = asOf.getUTCFullYear() - b.getUTCFullYear();
  const monthDelta = asOf.getUTCMonth() - b.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && asOf.getUTCDate() < b.getUTCDate())) {
    age -= 1;
  }
  return age;
}

/** True when the member is under 18 at `asOf` (false if birthdate unknown). */
export function isMinorAt(birth: Date | string | null | undefined, asOf: Date): boolean {
  const age = ageAt(birth, asOf);
  return age !== null && age < 18;
}

/**
 * Canonical, human-facing reference for a member. Prefer the Mitgliedsnummer;
 * legacy payer/contact rows without one fall back to "A" + the address number.
 */
export function memberRef(parts: {
  mitglnr?: string | null;
  mitgliedsnummer?: string | null;
  adrNr: number;
}): string {
  const nr = parts.mitgliedsnummer ?? parts.mitglnr;
  const trimmed = nr?.trim();
  if (trimmed) return trimmed;
  return `A${parts.adrNr}`;
}

/**
 * Render a member's display name with the same fallback chain the app has
 * always used: full name, then Kurzname, then Firma, then a numeric reference.
 */
export function memberDisplayName(m: MemberNameParts): string {
  const full = [m.vorname, m.nachname].filter(Boolean).join(" ").trim();
  if (full) return full;
  return m.kurzname ?? m.firma1 ?? `Mitglied ${m.mitglnr ?? m.adrNr ?? ""}`.trim();
}

/**
 * Collapse the legacy status signals into one canonical status. Precedence
 * mirrors the list/stats filters: a recorded death wins, then an exit date,
 * then the active/passive flag. Presence of `austritt`/`verstorbenAm` decides
 * exit/death regardless of whether the date is in the future, matching the
 * existing `isNull(austritt)` filters in the members procedures.
 */
export function deriveStatus(m: MemberStatusParts): MemberStatus {
  if (m.verstorbenAm !== null && m.verstorbenAm !== undefined) return "verstorben";
  if (m.austritt !== null && m.austritt !== undefined) return "ausgetreten";
  if ((m.aktivPasiv ?? "").trim().toUpperCase() === "P") return "passiv";
  return "aktiv";
}

/** A "live" member for counts/lists: still a member, neither exited nor deceased. */
export function isActiveStatus(status: MemberStatus): boolean {
  return status === "aktiv" || status === "passiv";
}

/** Trim a legacy text value to a non-empty string, or null. */
function cleanText(value: string | null | undefined): string | null {
  const t = value?.trim();
  return t && t.length > 0 ? t : null;
}

/** The four normalized columns derived from legacy member fields. */
export type DerivedCleanColumns = {
  mitgliedsnummer: string | null;
  email: string | null;
  status: MemberStatus;
  dunningBlocked: boolean;
};

/** The legacy member fields the clean columns are derived from. */
export type MemberLegacyFields = {
  mitglnr: string | null;
  eMailName: string | null;
  telefon3?: string | null;
  aktivPasiv: string | null;
  austritt: Date | string | null;
  verstorbenAm: Date | string | null;
  mahnSperre: string | null;
};

/**
 * Compute the clean, normalized member columns from the legacy fields. This is
 * the single rule the app-side write paths (member create/update) use to keep
 * the clean columns in sync whenever a legacy source field changes, mirroring
 * the importer translator and the one-time SQL backfill. Email keeps Linear's
 * `telefon3` fallback; status and the dunning block reuse the canonical
 * `deriveStatus` / `isDunningBlocked` helpers so all three paths agree.
 */
export function deriveCleanColumns(m: MemberLegacyFields): DerivedCleanColumns {
  return {
    mitgliedsnummer: cleanText(m.mitglnr),
    email: cleanText(m.eMailName) ?? cleanText(m.telefon3),
    status: deriveStatus({
      austritt: m.austritt,
      verstorbenAm: m.verstorbenAm,
      aktivPasiv: m.aktivPasiv,
    }),
    dunningBlocked: isDunningBlocked(m.mahnSperre),
  };
}

/**
 * Clean member shape produced by translating a Linear `adresse` row. These are
 * the app-owned domain fields; the verbatim Linear row is preserved separately
 * in `member_source_records`. App-native columns (id, timestamps, geschlecht,
 * notes, vertreter*) are NOT set here -- they are owned by the app, not Linear.
 */
export type CleanMemberInput = {
  /** Linear address number: kept as the import upsert key and URL fallback. */
  adrNr: number;
  mitgliedsnummer: string | null;
  // Name
  anrede: string | null;
  titel1: string | null;
  titel2: string | null;
  vorname: string | null;
  nachname: string | null;
  geborene: string | null;
  geburtsname: string | null;
  genannt: string | null;
  namensvorsatz: string | null;
  namenszusatz: string | null;
  geburtsdatum: Date | null;
  geburtsort: string | null;
  // Address
  strasse: string | null;
  hausnummer: string | null;
  adresszusatz: string | null;
  plz: string | null;
  ort: string | null;
  land: string | null;
  // Contact
  email: string | null;
  telefon1: string | null;
  telefon2: string | null;
  telefon3: string | null;
  www: string | null;
  fax: string | null;
  // Organisation / role
  firma1: string | null;
  firma2: string | null;
  firma3: string | null;
  firma4: string | null;
  kurzname: string | null;
  funktion: string | null;
  abteilung: string | null;
  spender: string | null;
  // Status (normalized)
  status: MemberStatus;
  dunningBlocked: boolean;
  eintritt: Date | null;
  austritt: Date | null;
  verstorbenAm: Date | null;
  /** Linear `Geloscht`. The pipeline folds this into `deletedAt` at import. */
  isDeleted: boolean;
  // Banking / SEPA
  iban1: string | null;
  iban1Last4: string | null;
  bic1: string | null;
  mandatsreferenz: string | null;
  abwKontoInh: string | null;
  // Abweichender Kontoinhaber (KIH)
  strasseKih: string | null;
  plzKih: string | null;
  ortKih: string | null;
  emailKih: string | null;
  adrNrKih: number | null;
};

/**
 * Clean, API-facing read projection of a member. This is the shape oRPC
 * procedures will return once consumers are migrated (no legacy field names,
 * no flag strings, status and identity resolved).
 */
export type MemberView = {
  id: string;
  memberRef: string;
  mitgliedsnummer: string | null;
  adrNr: number;
  displayName: string;
  status: MemberStatus;
  isActive: boolean;
  dunningBlocked: boolean;
  anrede: string | null;
  vorname: string | null;
  nachname: string | null;
  geburtsdatum: string | null;
  email: string | null;
  strasse: string | null;
  hausnummer: string | null;
  plz: string | null;
  ort: string | null;
  eintritt: string | null;
  austritt: string | null;
  verstorbenAm: string | null;
  iban1Last4: string | null;
  bic1: string | null;
  mandatsreferenz: string | null;
};

/** ISO day (YYYY-MM-DD) for a date, or null. */
function isoDay(d: Date | string | null): string | null {
  if (d === null) return null;
  const date = d instanceof Date ? d : new Date(d);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

/** Project a clean member row (clean columns + app metadata) to a `MemberView`. */
export function toMemberView(
  row: CleanMemberInput & { id: string; deletedAt: Date | string | null },
): MemberView {
  return {
    id: row.id,
    memberRef: memberRef(row),
    mitgliedsnummer: row.mitgliedsnummer,
    adrNr: row.adrNr,
    displayName: memberDisplayName({
      vorname: row.vorname,
      nachname: row.nachname,
      kurzname: row.kurzname,
      firma1: row.firma1,
      mitglnr: row.mitgliedsnummer,
      adrNr: row.adrNr,
    }),
    status: row.status,
    isActive: row.deletedAt === null && isActiveStatus(row.status),
    dunningBlocked: row.dunningBlocked,
    anrede: row.anrede,
    vorname: row.vorname,
    nachname: row.nachname,
    geburtsdatum: isoDay(row.geburtsdatum),
    email: row.email,
    strasse: row.strasse,
    hausnummer: row.hausnummer,
    plz: row.plz,
    ort: row.ort,
    eintritt: isoDay(row.eintritt),
    austritt: isoDay(row.austritt),
    verstorbenAm: isoDay(row.verstorbenAm),
    iban1Last4: row.iban1Last4,
    bic1: row.bic1,
    mandatsreferenz: row.mandatsreferenz,
  };
}
