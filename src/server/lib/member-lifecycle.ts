/**
 * Pure planning logic for the member lifecycle: leaving the club (Austritt)
 * and reversing it (Reaktivierung). The procedures in
 * `~/server/orpc/procedures/members.ts` execute these plans inside a single
 * transaction; keeping the decision logic here (no DB, no side effects) makes
 * the cascade rules testable in isolation.
 *
 * Date handling: the leave date is a calendar day (`YYYY-MM-DD`). Department
 * memberships store that day directly (Drizzle `date` column = string).
 * Contracts and SEPA mandates store timestamps, so we compare on the UTC day
 * only. The reversal matches on the same day so it touches exactly the rows a
 * prior cascade closed, and leaves rows that were closed on a different date
 * (e.g. a single department the member quit earlier) untouched.
 */

/** UTC calendar day of a timestamp or date string, or null. */
export function toIsoDay(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (typeof value === "string") {
    // Already a YYYY-MM-DD (or ISO timestamp) — take the first 10 chars when
    // they form a valid date, otherwise parse.
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : null;
  }
  return Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : null;
}

export type AbteilungRow = {
  abteilungId: string;
  eintrittsdatum: string;
  austrittsdatum: string | null;
};

export type ContractRow = {
  id: string;
  gekuendZum: Date | string | null;
  vertragEnde?: Date | string | null;
};

export type SepaRow = {
  id: string;
  isDeleted?: boolean | null;
  widerrufenAm: Date | string | null;
  gultigBis?: Date | string | null;
};

// --- Austritt -------------------------------------------------------------

export type AustrittPlanInput = {
  /** Leave date as YYYY-MM-DD. */
  austrittDatum: string;
  abteilungen: AbteilungRow[];
  contracts: ContractRow[];
  sepa: SepaRow[];
  /** When false, SEPA mandates are left untouched. */
  revokeSepa: boolean;
  /**
   * Restrict the department closing to this set. `null`/omitted closes every
   * still-open membership.
   */
  abteilungIds?: string[] | null;
};

export type AustrittPlan = {
  /** Department memberships to close (set austrittsdatum = leave date). */
  abteilungClose: { abteilungId: string; eintrittsdatum: string }[];
  /** Contract ids to terminate (gekuendZum/vertragEnde = leave date). */
  contractClose: string[];
  /** SEPA mandate ids to revoke (widerrufenAm/gultigBis = leave date). */
  sepaRevoke: string[];
};

/**
 * Decide which dependent rows a member's Austritt should close. Only
 * still-open rows are affected; anything already ended is left as-is so a
 * second run is a no-op and earlier, deliberate closings are preserved.
 */
export function planAustrittCascade(input: AustrittPlanInput): AustrittPlan {
  const restrict = input.abteilungIds == null ? null : new Set(input.abteilungIds);

  const abteilungClose = input.abteilungen
    .filter((a) => a.austrittsdatum == null && (restrict == null || restrict.has(a.abteilungId)))
    .map((a) => ({ abteilungId: a.abteilungId, eintrittsdatum: a.eintrittsdatum }));

  const contractClose = input.contracts.filter((c) => c.gekuendZum == null).map((c) => c.id);

  const sepaRevoke = input.revokeSepa
    ? input.sepa.filter((s) => !s.isDeleted && s.widerrufenAm == null).map((s) => s.id)
    : [];

  return { abteilungClose, contractClose, sepaRevoke };
}

// --- Reaktivierung --------------------------------------------------------

export type ReactivatePlanInput = {
  /** The member's current austritt day (YYYY-MM-DD) that is being reversed. */
  austrittDatum: string;
  abteilungen: AbteilungRow[];
  contracts: ContractRow[];
  sepa: SepaRow[];
};

export type ReactivatePlan = {
  abteilungReopen: { abteilungId: string; eintrittsdatum: string }[];
  /** clearVertragEnde marks contracts whose vertragEnde also fell on the day. */
  contractReopen: { id: string; clearVertragEnde: boolean }[];
  /** clearGultigBis marks mandates whose gultigBis also fell on the day. */
  sepaReopen: { id: string; clearGultigBis: boolean }[];
};

/**
 * Decide which rows a Reaktivierung should reopen: exactly those the matching
 * Austritt closed, identified by the shared leave day. Rows closed on a
 * different day are left untouched.
 */
export function planReactivateCascade(input: ReactivatePlanInput): ReactivatePlan {
  const day = input.austrittDatum;

  const abteilungReopen = input.abteilungen
    .filter((a) => toIsoDay(a.austrittsdatum) === day)
    .map((a) => ({ abteilungId: a.abteilungId, eintrittsdatum: a.eintrittsdatum }));

  const contractReopen = input.contracts
    .filter((c) => toIsoDay(c.gekuendZum) === day)
    .map((c) => ({ id: c.id, clearVertragEnde: toIsoDay(c.vertragEnde) === day }));

  const sepaReopen = input.sepa
    .filter((s) => toIsoDay(s.widerrufenAm) === day)
    .map((s) => ({ id: s.id, clearGultigBis: toIsoDay(s.gultigBis) === day }));

  return { abteilungReopen, contractReopen, sepaReopen };
}
