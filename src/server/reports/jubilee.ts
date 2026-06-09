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
 *
 * A Feb 29 entry has no Feb 29 in a non-leap jubilee year. We clamp to the
 * last day of the anniversary month (Feb 28) instead of letting `Date.UTC`
 * silently roll the date over into March, which would shift the cut-off by a
 * day and could wrongly include or exclude a member whose exit falls right on
 * the boundary.
 */
export function jubileeDateFor(eintritt: Date, jubilee: number): Date {
  const year = eintritt.getUTCFullYear() + jubilee;
  const month = eintritt.getUTCMonth();
  const lastOfMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(eintritt.getUTCDate(), lastOfMonth);
  return new Date(Date.UTC(year, month, day));
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
