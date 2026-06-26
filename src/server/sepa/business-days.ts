/**
 * TARGET2 business-day helpers for SEPA collection dates. The interbank SEPA
 * system settles on TARGET2 days: Monday to Friday except New Year, Good
 * Friday, Easter Monday, Labour Day (1 May), and 25/26 December. A SEPA Core
 * direct debit needs roughly one business day of lead time, so a freshly
 * generated file becomes stale once that date passes; these helpers compute the
 * next valid collection date so the operator can bump it with one click.
 */

const pad = (n: number) => String(n).padStart(2, "0");
const toIso = (d: Date) =>
  `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const parse = (iso: string) => new Date(`${iso}T00:00:00Z`);

/** Gregorian Easter Sunday (Meeus/Jones/Butcher), as {month, day}. */
function easterSunday(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

/** Set of TARGET2 holiday ISO dates for a given year. */
function targetHolidays(year: number): Set<string> {
  const { month, day } = easterSunday(year);
  const easter = new Date(Date.UTC(year, month - 1, day));
  const shift = (base: Date, days: number) => {
    const x = new Date(base);
    x.setUTCDate(x.getUTCDate() + days);
    return toIso(x);
  };
  return new Set([
    `${year}-01-01`, // New Year
    shift(easter, -2), // Good Friday
    shift(easter, 1), // Easter Monday
    `${year}-05-01`, // Labour Day
    `${year}-12-25`, // Christmas Day
    `${year}-12-26`, // St. Stephen's Day
  ]);
}

/** True when `iso` (YYYY-MM-DD) is a TARGET2 settlement day. */
export function isTargetBusinessDay(iso: string): boolean {
  const d = parse(iso);
  if (Number.isNaN(d.getTime())) return false;
  const dow = d.getUTCDay();
  if (dow === 0 || dow === 6) return false;
  return !targetHolidays(d.getUTCFullYear()).has(iso);
}

/**
 * The earliest valid collection date: `from` advanced by `leadDays` TARGET2
 * business days (SEPA Core needs ~1). Returns YYYY-MM-DD.
 */
export function nextCollectionDate(fromIso: string, leadDays = 1): string {
  let d = parse(fromIso);
  let added = 0;
  while (added < Math.max(1, leadDays)) {
    d = new Date(d);
    d.setUTCDate(d.getUTCDate() + 1);
    if (isTargetBusinessDay(toIso(d))) added += 1;
  }
  return toIso(d);
}
