/**
 * Linear's `mgsolln` has a PK of (AdrNr, Jahr, VertragNr, Art, Zeitraum) so
 * the same year can carry multiple "Zeitraum" rows per contract (e.g.
 * quarterly billing). The app's `soll_stellungen` is unique on
 * (contract_id, billing_year), so we sum across Zeitraums before insert.
 *
 * Kept as a pure function so the arithmetic can be unit-tested without
 * standing up a DB.
 */
import type { SollStellungMapped } from "~/server/importer/linear-mapper";

export type AggregatedSollStellung = {
  contractId: string;
  memberId: string;
  billingYear: number;
  falligkeitsdatum: Date | null;
  amount: string;
  paidAmount: string;
  openAmount: string;
  mahnstufe: number;
  linearGuid: string | null;
  rowCount: number;
};

export type ResolveContract = (
  adrNr: number,
  vertragNr: string,
) => { contractId: string; memberId: string } | null;

/**
 * Aggregates mgsolln rows into (contract, year) buckets. Unresolved
 * (adrNr, vertragNr) pairs are collected in `missing`; the caller decides
 * whether to log a warning or fail the import.
 */
export function aggregateMgsolln(
  rows: SollStellungMapped[],
  resolveContract: ResolveContract,
): {
  aggregated: AggregatedSollStellung[];
  missing: Array<{ adrNr: number; vertragNr: string }>;
} {
  const agg = new Map<string, AggregatedSollStellung & {
    amountCents: bigint;
    paidCents: bigint;
    openCents: bigint;
  }>();
  const missing: Array<{ adrNr: number; vertragNr: string }> = [];

  for (const m of rows) {
    const lookup = resolveContract(m.adrNr, m.vertragNr);
    if (!lookup) {
      missing.push({ adrNr: m.adrNr, vertragNr: m.vertragNr });
      continue;
    }
    const key = `${lookup.contractId}|${m.jahr}`;
    const existing = agg.get(key);
    if (existing) {
      existing.amountCents += toCents(m.betrag);
      existing.paidCents += toCents(m.bezahlt);
      existing.openCents += toCents(m.offen);
      existing.mahnstufe = Math.max(existing.mahnstufe, m.mahnstufe);
      existing.rowCount += 1;
      if (!existing.falligkeitsdatum && m.falligkeitsdatum) {
        existing.falligkeitsdatum = m.falligkeitsdatum;
      }
    } else {
      agg.set(key, {
        contractId: lookup.contractId,
        memberId: lookup.memberId,
        billingYear: m.jahr,
        falligkeitsdatum: m.falligkeitsdatum,
        amount: "0",
        paidAmount: "0",
        openAmount: "0",
        amountCents: toCents(m.betrag),
        paidCents: toCents(m.bezahlt),
        openCents: toCents(m.offen),
        mahnstufe: m.mahnstufe,
        linearGuid: m.guid,
        rowCount: 1,
      });
    }
  }

  const aggregated: AggregatedSollStellung[] = [];
  for (const v of agg.values()) {
    aggregated.push({
      contractId: v.contractId,
      memberId: v.memberId,
      billingYear: v.billingYear,
      falligkeitsdatum: v.falligkeitsdatum,
      amount: fromCents(v.amountCents),
      paidAmount: fromCents(v.paidCents),
      openAmount: fromCents(v.openCents),
      mahnstufe: v.mahnstufe,
      linearGuid: v.linearGuid,
      rowCount: v.rowCount,
    });
  }
  return { aggregated, missing };
}

/**
 * Status derivation: a row is `paid` once the open balance is at or below
 * zero. Otherwise `open` (the existing app status enum doesn't have a
 * "partially paid" value, and downstream Mahnwesen treats anything > 0 as
 * collectable).
 */
export function statusFor(openAmount: string): "open" | "paid" {
  return toCents(openAmount) <= 0n ? "paid" : "open";
}

function toCents(v: string | null): bigint {
  if (!v) return 0n;
  const [intp = "0", fracp = ""] = v.split(".");
  const frac = `${fracp}00000000`.slice(0, 8);
  const sign = intp.startsWith("-") ? -1n : 1n;
  const intAbs = intp.replace(/^-/, "");
  return sign * (BigInt(intAbs || "0") * 100_000_000n + BigInt(frac || "0"));
}

function fromCents(c: bigint): string {
  const sign = c < 0n ? "-" : "";
  const abs = c < 0n ? -c : c;
  const intp = (abs / 100_000_000n).toString();
  const frac = (abs % 100_000_000n).toString().padStart(8, "0");
  return `${sign}${intp}.${frac}`;
}
