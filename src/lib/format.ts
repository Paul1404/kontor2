const DE = "de-DE";

export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "";
  const d = typeof value === "string" ? new Date(value) : value;
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleDateString(DE, { year: "numeric", month: "2-digit", day: "2-digit" });
}

export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return "";
  const d = typeof value === "string" ? new Date(value) : value;
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleString(DE, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatIbanMask(last4: string | null | undefined): string {
  if (!last4) return "";
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
