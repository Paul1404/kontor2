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

import { altMitgliedsnummer, type MemberRefParts, memberRef } from "~/lib/member-ref";

export { altMitgliedsnummer, type MemberRefParts, memberRef };

/** A member's lifecycle status, derived from dates + the legacy A/P flag. */
export type MemberStatus = "aktiv" | "passiv" | "ausgetreten" | "verstorben";

/** Minimal fields needed to render a member's name. */
export type MemberNameParts = MemberRefParts & {
  vorname: string | null;
  nachname: string | null;
  kurzname: string | null;
  firma1: string | null;
};

/** Fields needed to decide a member's lifecycle status. */
export type MemberStatusParts = {
  austritt: Date | string | null;
  verstorbenAm: Date | string | null;
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

/** The explicit gender enum value, independent of the Anrede. */
export type Geschlecht = "m" | "w" | "d" | "unbekannt";

/**
 * Best-effort gender from the free-text Anrede. Linear stored no explicit
 * gender column -- only the Anrede ("Herr"/"Frau") -- so this is the single
 * signal available at import time. Returns the enum value, or null when the
 * Anrede is not a clear gender marker (e.g. "Familie", "Firma", a bare title,
 * or empty). We keep that honest as "unknown" rather than guessing, so the
 * dashboard shows the real data gap instead of inventing a 50/50 split.
 *
 * This is a derivation, not the source of truth: a Vorstand can always correct
 * `geschlecht` in the edit form, and the importer never overwrites a value that
 * is already set.
 */
export function deriveGeschlecht(anrede: string | null | undefined): "m" | "w" | "d" | null {
  const a = (anrede ?? "").trim().toLowerCase();
  if (!a) return null;
  if (a === "herr" || a === "hr" || a === "hr." || a === "herrn" || a.startsWith("herr ")) {
    return "m";
  }
  if (a === "frau" || a === "fr" || a === "fr." || a.startsWith("frau ")) return "w";
  if (a === "divers") return "d";
  return null;
}

/**
 * Render a member's display name with the same fallback chain the app has
 * always used: full name, then Kurzname, then Firma, then a numeric reference.
 */
export function memberDisplayName(m: MemberNameParts): string {
  const full = [m.vorname, m.nachname].filter(Boolean).join(" ").trim();
  if (full) return full;
  return m.kurzname ?? m.firma1 ?? `Mitglied ${memberRef(m)}`.trim();
}

/** A date value (timestamp or YYYY-MM-DD) that has taken effect by `asOf`. */
function takesEffectBy(value: Date | string | null | undefined, asOf: Date): boolean {
  if (value === null || value === undefined) return false;
  const d = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(d.getTime())) return false;
  return d.getTime() <= asOf.getTime();
}

/**
 * Collapse the lifecycle signals into one canonical status as of `asOf`
 * (default: now). Precedence: a death that has occurred wins, then an exit that
 * has taken effect, otherwise the member is live (`aktiv`).
 *
 * The stored status carries only the lifecycle axis. The aktiv-vs-passiv
 * distinction (does the member do sport?) is no longer stored here: it is
 * derived on read from the member's active Abteilungen
 * (`memberHasRealAbteilung` / `memberIsPassiv`), so it cannot drift from the
 * Sparte data. `passiv` therefore never comes out of this function.
 *
 * Crucially, a *future* exit date does not flip the member yet: someone who has
 * given notice effective at year-end is still a live member until that day, so
 * they keep counting in fee runs, dunning, and the Bestandserhebung. The stored
 * status is reconciled to `ausgetreten` once the date arrives (see
 * `reconcileMemberStatuses` in the nightly scheduler). Death dates are facts,
 * never scheduled ahead, but are gated the same way for symmetry.
 */
export function deriveStatus(m: MemberStatusParts, asOf: Date = new Date()): MemberStatus {
  if (takesEffectBy(m.verstorbenAm, asOf)) return "verstorben";
  if (takesEffectBy(m.austritt, asOf)) return "ausgetreten";
  return "aktiv";
}

/**
 * The leave date a member has been given notice for but that has not yet taken
 * effect (`austritt` in the future relative to `asOf`), or null when the member
 * has no pending exit. Such a member is still aktiv/passiv until the date; this
 * is what the UI surfaces as "Kündigt zum …". A death already recorded takes
 * precedence and clears any pending exit.
 */
export function pendingAustrittDate(
  m: Pick<MemberStatusParts, "austritt" | "verstorbenAm">,
  asOf: Date = new Date(),
): Date | null {
  if (takesEffectBy(m.verstorbenAm, asOf)) return null;
  if (m.austritt === null || m.austritt === undefined) return null;
  const d = m.austritt instanceof Date ? m.austritt : new Date(m.austritt);
  if (!Number.isFinite(d.getTime())) return null;
  return d.getTime() > asOf.getTime() ? d : null;
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
