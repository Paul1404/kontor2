/**
 * Pure helpers that classify a membership application by type and age
 * category. Ported from the svums form logic (`ApplicationForm.tsx`) and
 * `services/fees.py`. Kept free of DB/IO so they are unit-testable.
 *
 * Age category uses the Stichtag (Jan 1 of the current year); the "is this a
 * minor / adult" gate that drives kind/einzel detection uses the real age as
 * of today, matching svums exactly.
 */

export type AntragKategorie =
  | "kind"
  | "jugendlich"
  | "junger_erwachsener"
  | "erwachsener"
  | "familie";

export type Antragstyp = "einzel" | "kind" | "familie";

/** Parse a `YYYY-MM-DD` string into a UTC date, avoiding timezone drift. */
export function parseISODate(value: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return new Date(Number.NaN);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

/** Jan 1 of the given year (defaults to the current year). */
export function stichtag(year: number = new Date().getUTCFullYear()): Date {
  return new Date(Date.UTC(year, 0, 1));
}

/** Whole years between two dates (UTC), never negative-rounding. */
export function ageAt(geburtsdatum: Date, reference: Date): number {
  let age = reference.getUTCFullYear() - geburtsdatum.getUTCFullYear();
  const beforeBirthday =
    reference.getUTCMonth() < geburtsdatum.getUTCMonth() ||
    (reference.getUTCMonth() === geburtsdatum.getUTCMonth() &&
      reference.getUTCDate() < geburtsdatum.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

/** Actual age today (validation), not the Stichtag category age. */
export function realAge(geburtsdatum: Date, today: Date = new Date()): number {
  return ageAt(geburtsdatum, today);
}

/**
 * Age category at the Stichtag. `familie` short-circuits because a family
 * application is a flat tariff regardless of the applicant's age.
 */
export function categoryFromAge(geburtsdatum: Date, isFamilie = false): AntragKategorie {
  if (isFamilie) return "familie";
  const age = ageAt(geburtsdatum, stichtag());
  if (age < 14) return "kind";
  if (age < 18) return "jugendlich";
  if (age < 25) return "junger_erwachsener";
  return "erwachsener";
}

/**
 * Auto-detect the application type from the person composition, exactly as
 * the public form does: a minor applicant is always `kind` (guardian
 * required); an adult with at least one child AND a partner is `familie`;
 * everything else is `einzel`.
 */
export function detectAntragstyp(opts: {
  geburtsdatum: Date;
  hasChildren: boolean;
  hasPartner: boolean;
  today?: Date;
}): Antragstyp {
  if (realAge(opts.geburtsdatum, opts.today) < 18) return "kind";
  if (opts.hasChildren && opts.hasPartner) return "familie";
  return "einzel";
}

/** Resolve the membership category for an application type + applicant DOB. */
export function mitgliedschaftTypFor(antragstyp: Antragstyp, geburtsdatum: Date): AntragKategorie {
  if (antragstyp === "familie") return "familie";
  return categoryFromAge(geburtsdatum, false);
}
