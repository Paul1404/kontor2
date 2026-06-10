/**
 * Shared field validators and normalizers for member data.
 *
 * The SAME rules run in two places so they cannot drift (issue #80):
 *  - the import pipeline (`translateLinearMember`) normalizes on write and the
 *    batch report counts problems before a batch lands, and
 *  - the server-side member edit form (`buildMemberPatch`) rejects the same bad
 *    inputs.
 *
 * Validators are pure and side-effect free; they return a level plus a short
 * German message. Absence (null/empty) is never an error here — required-ness
 * is a separate concern. Normalizers return the cleaned value (or null).
 */

import { validateIban } from "~/server/sepa/iban";

export type FieldLevel = "ok" | "warning" | "error";
export type FieldResult = { level: FieldLevel; message?: string };

const OK: FieldResult = { level: "ok" };

function isBlank(value: string | null | undefined): value is null | undefined | "" {
  return value == null || value.trim() === "";
}

/** Country codes treated as domestic for PLZ rules. */
const DOMESTIC = new Set(["", "de", "d", "deutschland", "germany"]);

function isDomestic(land: string | null | undefined): boolean {
  return DOMESTIC.has((land ?? "").trim().toLowerCase());
}

// --- Validators ------------------------------------------------------------

/**
 * Reject an email without exactly one `@` and a dotted domain. Catches a
 * comma-instead-of-dot typo like `user@web,de` (domain has no dot).
 */
export function validateEmail(value: string | null | undefined): FieldResult {
  if (isBlank(value)) return OK;
  const v = value.trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) {
    return { level: "error", message: "E-Mail ungültig (kein @ oder keine Domain)." };
  }
  return OK;
}

/** ISO 13616 mod-97 IBAN check (delegates to the shared SEPA validator). */
export function validateIbanField(value: string | null | undefined): FieldResult {
  if (isBlank(value)) return OK;
  if (!validateIban(value)) {
    return { level: "error", message: "IBAN ungültig (Prüfsumme fehlerhaft)." };
  }
  return OK;
}

/** BIC must be 8 or 11 chars: 6 letters, 2 alphanumerics, optional 3 more. */
export function validateBic(value: string | null | undefined): FieldResult {
  if (isBlank(value)) return OK;
  const v = value.trim().toUpperCase();
  if (!/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(v)) {
    return { level: "error", message: "BIC ungültig (8 oder 11 Zeichen erwartet)." };
  }
  return OK;
}

/**
 * Domestic PLZ must be exactly 5 digits. An optional `expectedOrt` cross-check
 * (PLZ -> Ort) downgrades a mismatch to a warning rather than an error.
 */
export function validatePlz(
  value: string | null | undefined,
  opts: { land?: string | null; expectedOrt?: string | null; actualOrt?: string | null } = {},
): FieldResult {
  if (isBlank(value)) return OK;
  const v = value.trim();
  if (isDomestic(opts.land) && !/^\d{5}$/.test(v)) {
    return { level: "error", message: "PLZ unplausibel (genau fünf Ziffern erwartet)." };
  }
  if (
    !isBlank(opts.expectedOrt) &&
    !isBlank(opts.actualOrt) &&
    opts.expectedOrt.trim().toLowerCase() !== opts.actualOrt.trim().toLowerCase()
  ) {
    return { level: "warning", message: `Ort passt nicht zur PLZ (erwartet ${opts.expectedOrt}).` };
  }
  return OK;
}

/** Count digits in a phone string (ignoring +, spaces, separators). */
export function phoneDigitCount(value: string | null | undefined): number {
  if (isBlank(value)) return 0;
  return value.replace(/\D/g, "").length;
}

/** Reject an area-code-only phone: 1-5 digits, no subscriber part. */
export function validatePhone(value: string | null | undefined): FieldResult {
  if (isBlank(value)) return OK;
  const digits = phoneDigitCount(value);
  if (digits >= 1 && digits <= 5) {
    return { level: "error", message: "Telefonnummer unvollständig (nur Vorwahl)." };
  }
  return OK;
}

/** Geburtsdatum must not be in the future and must give an age <= 110. */
export function validateGeburtsdatum(value: Date | string | null | undefined): FieldResult {
  if (value == null || value === "") return OK;
  const d = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(d.getTime())) {
    return { level: "error", message: "Geburtsdatum ungültig." };
  }
  const now = new Date();
  if (d.getTime() > now.getTime()) {
    return { level: "error", message: "Geburtsdatum liegt in der Zukunft." };
  }
  const age = (now.getTime() - d.getTime()) / (365.2425 * 24 * 60 * 60 * 1000);
  if (age > 110) {
    return { level: "error", message: "Geburtsdatum unplausibel (Alter über 110 Jahre)." };
  }
  return OK;
}

// --- Normalizers -----------------------------------------------------------

/** Trim and collapse runs of internal whitespace to a single space; "" -> null. */
export function collapseWhitespace(value: string | null | undefined): string | null {
  if (value == null) return null;
  const v = value.replace(/\s+/g, " ").trim();
  return v === "" ? null : v;
}

/**
 * Title-case a name conservatively: only re-case a token that is ALL upper or
 * ALL lower, so deliberately mixed-case names ("McDonald", "von der Heide") are
 * left untouched. Hyphenated parts are cased individually ("hans-peter" ->
 * "Hans-Peter"). German locale so "MÜLLER" -> "Müller".
 */
const NAME_PARTICLES = new Set([
  "von",
  "vom",
  "van",
  "de",
  "der",
  "den",
  "del",
  "di",
  "da",
  "zu",
  "zur",
  "zum",
  "am",
  "auf",
  "und",
]);

export function titleCaseName(value: string | null | undefined): string | null {
  const base = collapseWhitespace(value);
  if (base == null) return null;
  const casePart = (part: string): string => {
    if (part === "") return part;
    const isAllUpper = part === part.toLocaleUpperCase("de-DE");
    const isAllLower = part === part.toLocaleLowerCase("de-DE");
    if (!isAllUpper && !isAllLower) return part;
    const lower = part.toLocaleLowerCase("de-DE");
    return lower.charAt(0).toLocaleUpperCase("de-DE") + lower.slice(1);
  };
  const caseToken = (tok: string): string => {
    // Nobiliary/connecting particles stay lowercase ("von der Heide").
    if (NAME_PARTICLES.has(tok.toLocaleLowerCase("de-DE"))) {
      return tok.toLocaleLowerCase("de-DE");
    }
    return tok.split("-").map(casePart).join("-");
  };
  return base.split(" ").map(caseToken).join(" ");
}

/**
 * Normalize a phone for storage: collapse whitespace, but coerce an
 * area-code-only value (1-5 digits) to null so it is not kept as if reachable.
 */
export function normalizePhone(value: string | null | undefined): string | null {
  if (validatePhone(value).level === "error") return null;
  return collapseWhitespace(value);
}

// --- Batch report (import gate, issue #80) ---------------------------------

/** The subset of member fields the shared validators cover. */
export type MemberFieldInput = {
  mitgliedsnummer?: string | null;
  email?: string | null;
  iban1?: string | null;
  bic1?: string | null;
  plz?: string | null;
  land?: string | null;
  telefon1?: string | null;
  telefon2?: string | null;
  geburtsdatum?: Date | string | null;
};

export type FieldIssue = { field: string; level: "warning" | "error"; message: string };

/** Run every field validator over one record and collect the non-ok results. */
export function validateMemberFields(m: MemberFieldInput): FieldIssue[] {
  const issues: FieldIssue[] = [];
  const push = (field: string, r: FieldResult): void => {
    if (r.level !== "ok") issues.push({ field, level: r.level, message: r.message ?? field });
  };
  push("email", validateEmail(m.email));
  push("iban1", validateIbanField(m.iban1));
  push("bic1", validateBic(m.bic1));
  push("plz", validatePlz(m.plz, { land: m.land }));
  push("telefon1", validatePhone(m.telefon1));
  push("telefon2", validatePhone(m.telefon2));
  push("geburtsdatum", validateGeburtsdatum(m.geburtsdatum));
  return issues;
}

export type BatchReport = {
  /** Records inspected. */
  total: number;
  /** Records with at least one issue. */
  flaggedRecords: number;
  errors: number;
  warnings: number;
  /** Per-field error/warning counts. */
  byField: Record<string, { error: number; warning: number }>;
  /** Mitgliedsnummern that occur on more than one record in the batch. */
  duplicateMitgliedsnummern: string[];
};

/**
 * Full pre-commit report over a staging batch (issue #80): per-field counts
 * plus cross-record duplicate Mitgliedsnummer detection. The import surfaces
 * this so a bad batch is visible before it lands.
 */
export function summarizeBatch(records: MemberFieldInput[]): BatchReport {
  const byField: Record<string, { error: number; warning: number }> = {};
  let errors = 0;
  let warnings = 0;
  let flaggedRecords = 0;
  const seen = new Map<string, number>();

  for (const rec of records) {
    const issues = validateMemberFields(rec);
    if (issues.length > 0) flaggedRecords += 1;
    for (const issue of issues) {
      let bucket = byField[issue.field];
      if (!bucket) {
        bucket = { error: 0, warning: 0 };
        byField[issue.field] = bucket;
      }
      bucket[issue.level] += 1;
      if (issue.level === "error") errors += 1;
      else warnings += 1;
    }
    const nr = rec.mitgliedsnummer?.trim();
    if (nr) seen.set(nr, (seen.get(nr) ?? 0) + 1);
  }

  const duplicateMitgliedsnummern = [...seen.entries()]
    .filter(([, count]) => count > 1)
    .map(([nr]) => nr)
    .sort();

  return {
    total: records.length,
    flaggedRecords,
    errors,
    warnings,
    byField,
    duplicateMitgliedsnummern,
  };
}
