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
  mitgliedsnummer?: string | null;
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
export function memberRef(parts: { mitgliedsnummer?: string | null; adrNr: number }): string {
  const trimmed = parts.mitgliedsnummer?.trim();
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
  return m.kurzname ?? m.firma1 ?? `Mitglied ${m.mitgliedsnummer ?? m.adrNr ?? ""}`.trim();
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

/**
 * The clean member row the importer writes to `members`, produced by
 * `translateLinearMember`. Field names match the (clean) schema columns; the
 * verbatim Linear row is preserved separately in `member_source_records`.
 * App-native columns (id, timestamps, geschlecht, notes, vertreter*) are not
 * set here -- they are owned by the app, not Linear. `isDeleted` is the one
 * exception: it is the `geloscht` signal, folded into `deletedAt` at import.
 */
export type CleanMemberInput = {
  /** Linear address number: the import upsert key and URL fallback. */
  adrNr: number;
  mitgliedsnummer: string | null;
  anrede: string | null;
  titel1: string | null;
  vorname: string | null;
  nachname: string | null;
  geburtsdatum: Date | null;
  geburtsort: string | null;
  kurzname: string | null;
  firma1: string | null;
  funktion: string | null;
  spender: string | null;
  strasse: string | null;
  hausnummer: string | null;
  adresszusatz: string | null;
  plz: string | null;
  ort: string | null;
  land: string | null;
  email: string | null;
  telefon1: string | null;
  telefon2: string | null;
  www: string | null;
  iban1: string | null;
  iban1Last4: string | null;
  bic1: string | null;
  abwKontoInh: string | null;
  eintritt: Date | null;
  austritt: Date | null;
  verstorbenAm: Date | null;
  status: MemberStatus;
  dunningBlocked: boolean;
  abteilung: string | null;
  /** Linear `Geloscht`; folded into `deletedAt` by the importer. */
  isDeleted: boolean;
};
