import { formatDate } from "~/lib/format";

/** Badge variants used to render a member's lifecycle status. */
export type MemberStatusVariant = "success" | "secondary" | "warning" | "destructive";

export type MemberStatusFields = {
  status?: string | null;
  austritt?: string | Date | null;
  verstorbenAm?: string | Date | null;
  deletedAt?: string | Date | null;
};

export type MemberStatusView = {
  label: string;
  variant: MemberStatusVariant;
  /** True when notice has been given but the leave date is still in the future. */
  pendingExit: boolean;
};

function asDate(value: string | Date | null | undefined): Date | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
}

/**
 * How a member's lifecycle status should render as a badge, as of `asOf`
 * (default now). Mirrors the server's date-aware `deriveStatus`: a member with
 * a *future* Austritt is shown as "Kündigt zum …" (still a member), not
 * "Ausgetreten". Death and soft-delete take precedence, then a due exit, then
 * the passive/active flag.
 */
export function memberStatusView(m: MemberStatusFields, asOf: Date = new Date()): MemberStatusView {
  if (asDate(m.deletedAt)) {
    return { label: "Gelöscht", variant: "destructive", pendingExit: false };
  }

  const verstorben = asDate(m.verstorbenAm);
  if (m.status === "verstorben" || (verstorben && verstorben.getTime() <= asOf.getTime())) {
    return { label: "Verstorben", variant: "secondary", pendingExit: false };
  }

  const austritt = asDate(m.austritt);
  if (austritt && austritt.getTime() > asOf.getTime()) {
    return { label: `Kündigt zum ${formatDate(austritt)}`, variant: "warning", pendingExit: true };
  }
  if (m.status === "ausgetreten" || (austritt && austritt.getTime() <= asOf.getTime())) {
    return { label: "Ausgetreten", variant: "warning", pendingExit: false };
  }
  if (m.status === "passiv") {
    return { label: "Passiv", variant: "secondary", pendingExit: false };
  }
  return { label: "Aktiv", variant: "success", pendingExit: false };
}
