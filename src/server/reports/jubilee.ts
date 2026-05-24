/**
 * The year in which a member reaches the given anniversary (e.g. 25 years of
 * membership). For an `eintritt` of 2000-02-15 and jubilee `25`, returns 2025.
 */
export function jubileeYearFor(eintritt: Date, jubilee: number): number {
  return eintritt.getUTCFullYear() + jubilee;
}

/**
 * The exact calendar date of the jubilee — month and day come from the
 * original `eintritt`. Used to decide whether the member was still active
 * when the jubilee fell due.
 */
export function jubileeDateFor(eintritt: Date, jubilee: number): Date {
  return new Date(
    Date.UTC(eintritt.getUTCFullYear() + jubilee, eintritt.getUTCMonth(), eintritt.getUTCDate()),
  );
}

/**
 * A member is excluded from a jubilee list if their `austritt` or
 * `verstorbenAm` falls before the jubilee date itself — they did not live
 * to reach the anniversary as a member of the club.
 */
export function isExcludedFromJubilee(
  member: { austritt: Date | null; verstorbenAm: Date | null },
  jubileeDate: Date,
): boolean {
  if (member.austritt && member.austritt.getTime() < jubileeDate.getTime()) return true;
  if (member.verstorbenAm && member.verstorbenAm.getTime() < jubileeDate.getTime()) return true;
  return false;
}
