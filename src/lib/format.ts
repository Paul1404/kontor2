const DE = "de-DE";

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
