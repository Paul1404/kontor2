/**
 * Round-number birthdays worth highlighting: 25, then every 5 years from 50.
 * Honors common Vereinsverwaltung conventions.
 */
export function isRoundBirthday(age: number): boolean {
  if (!Number.isFinite(age) || age < 0) return false;
  if (age === 25) return true;
  return age >= 50 && age % 5 === 0;
}

/**
 * Age the member reaches *during* the given year. Computed as
 * `year - YEAR(birthDate)` — the actual day in the year is irrelevant
 * for birthday-list purposes (we already filter to the chosen month).
 */
export function ageInYear(birthDate: Date, year: number): number {
  return year - birthDate.getUTCFullYear();
}
