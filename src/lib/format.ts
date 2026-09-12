const DE = "de-DE";

/**
 * The single placeholder for an empty/unknown value in any DISPLAY context.
 * This em-dash glyph is the one deliberate dash exception in the house style.
 * Never render "k.A.", "-", "?", "n/a" or a blank string for a missing value.
 * (Form input defaults using `?? ""` are fine; this is about rendered output.)
 */
export const EMPTY_VALUE = "—";

/** Render a value for display, falling back to the empty-value glyph. */
export function orEmpty(value: string | number | null | undefined): string {
  if (value == null) return EMPTY_VALUE;
  const s = String(value).trim();
  return s === "" ? EMPTY_VALUE : s;
}

/**
 * Tidy a free-form phone number for display: trim and collapse runs of
 * whitespace to a single space. Deliberately non-destructive (no regrouping of
 * digits, since German area-code lengths vary), so a stored "0123  /  456" just
 * reads as "0123 / 456". Returns null for empty input.
 */
export function formatPhone(value: string | null | undefined): string | null {
  if (value == null) return null;
  const s = value.trim().replace(/\s+/g, " ");
  return s === "" ? null : s;
}

/** `tel:` href for a phone number, or null if there are too few digits. */
export function telHref(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value.replace(/[^\d+]/g, "");
  return cleaned.replace(/\D/g, "").length >= 3 ? `tel:${cleaned}` : null;
}

// All dates are stored as UTC midnight (Drizzle date columns + our
// ingestion path normalize to that). Render them pinned to the club's
// timezone so a date typed in as 2020-01-15 always shows as 15.01.2020,
// regardless of the user's browser locale.
const TZ = "Europe/Berlin";

export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "";
  const d = typeof value === "string" ? new Date(value) : value;
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleDateString(DE, {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return "";
  const d = typeof value === "string" ? new Date(value) : value;
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleString(DE, {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function utcDateString(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate(),
  ).padStart(2, "0")}`;
}

/**
 * Format a stored date for an `<input type="date">` value (YYYY-MM-DD).
 * For string values take the calendar date verbatim. Round-tripping through
 * `new Date(...).toISOString()` re-interprets a naive timestamp in the local
 * timezone and can shift the day (e.g. "2020-01-15T00:00:00" -> "2020-01-14"
 * west of UTC). Dates are stored as UTC midnight, so read Date objects with
 * the UTC getters.
 */
export function toDateInput(value: string | Date | null | undefined): string {
  if (!value) return "";
  if (typeof value === "string") {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? utcDateString(parsed) : "";
  }
  return Number.isFinite(value.getTime()) ? utcDateString(value) : "";
}

/**
 * Format a stored ISO date (YYYY-MM-DD) as German DD.MM.YYYY for display in a
 * text field. Takes the calendar parts verbatim, so no timezone shift. Blank
 * in, blank out.
 */
export function formatDateInput(value: string | null | undefined): string {
  if (!value) return "";
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : "";
}

/**
 * Parse a hand-typed or pasted date into an ISO YYYY-MM-DD string. Accepts the
 * German form DD.MM.YYYY (also D.M.YY and `.`/`/`/`-` separators) and ISO
 * YYYY-MM-DD. Two-digit years pivot on the current year (00..yy -> 2000s, the
 * rest -> 1900s). Returns "" for blank input and null for anything that is not
 * a real calendar date, so callers can tell "cleared" from "still typing".
 */
export function parseDateInput(text: string | null | undefined): string | null {
  if (text == null) return "";
  const s = text.trim();
  if (s === "") return "";
  let y: number;
  let mo: number;
  let d: number;
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const de = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/);
  if (iso) {
    y = Number(iso[1]);
    mo = Number(iso[2]);
    d = Number(iso[3]);
  } else if (de) {
    const yStr = de[3] ?? "";
    d = Number(de[1]);
    mo = Number(de[2]);
    y = Number(yStr);
    if (yStr.length === 2) {
      const cy = new Date().getFullYear() % 100;
      y = y <= cy ? 2000 + y : 1900 + y;
    }
  } else {
    return null;
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  // Build at UTC midnight and read back to reject impossible dates (e.g. 31.02).
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    return null;
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${y}-${pad(mo)}-${pad(d)}`;
}

export function formatIbanMask(last4: string | null | undefined): string {
  if (!last4) return "";
  // Note: this mask assumes a DE IBAN (22 chars). Non-DE members would
  // get a length-correct but wrong-country mask; acceptable trade-off
  // because the country code is not stored alongside `iban1Last4`.
  return `DE** **** **** **** **** ${last4}`;
}

export function formatCurrency(value: string | number | null | undefined): string {
  if (value == null || value === "") return "";
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "";
  return new Intl.NumberFormat(DE, { style: "currency", currency: "EUR" }).format(n);
}

/**
 * Prepare a stored decimal for an editable field or a non-currency hint.
 * PostgreSQL returns fixed-scale numerics as strings such as `96.00000000`.
 * Keep every significant digit, but remove zero padding without converting
 * through `number`, which could lose precision.
 */
export function formatDecimalInput(value: string | number | null | undefined): string {
  if (value == null || value === "") return "";
  const raw = String(value).trim();
  const match = raw.match(/^([+-]?)(\d+)(?:([.,])(\d+))?$/);
  if (!match) return raw;

  const whole = match[2] ?? "0";
  const fraction = (match[4] ?? "").replace(/0+$/, "");
  const sign = /^0+$/.test(whole) && fraction === "" ? "" : (match[1] ?? "");
  return `${sign}${whole}${fraction ? `${match[3]}${fraction}` : ""}`;
}

/** Human-readable byte size: B, kB (1 decimal), MB (2 decimals). */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function memberStatus(opts: {
  austritt: Date | string | null;
  verstorbenAm: Date | string | null;
  aktiv: string | null;
  aktivPasiv: string | null;
}): "aktiv" | "passiv" | "ausgetreten" | "verstorben" {
  if (opts.verstorbenAm) return "verstorben";
  if (opts.austritt) return "ausgetreten";
  if (opts.aktivPasiv === "P") return "passiv";
  return "aktiv";
}
