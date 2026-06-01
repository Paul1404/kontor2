import { type Column, type SQL, sql } from "drizzle-orm";

/**
 * Single source of truth for "does this contract pay by SEPA direct debit?".
 *
 * Linear Webverein leaves `mgvert.Lastschrift` blank for the common
 * direct-debit case and only populates it to flag exceptions, so a
 * null/empty value must count as direct debit -- not as "unknown". Explicit
 * invoice payers carry `AufRechnung = 'J'` and are never debited.
 *
 * Rules:
 * - `aufRechnung = 'J'` (any case) -> invoice payer -> NOT direct debit.
 * - otherwise: direct debit unless `lastschrift` is explicitly set to a
 *   non-"J" value (e.g. "N").
 *
 * Keep `paysByDirectDebit` (row-level, used by the fee-run builder) and
 * `directDebitSql` (SQL predicate, used by the dunning reconciliation)
 * in lockstep -- they must answer identically for the same data.
 */
export function paysByDirectDebit(
  lastschrift: string | null | undefined,
  aufRechnung: string | null | undefined,
): boolean {
  if ((aufRechnung ?? "").trim().toUpperCase() === "J") return false;
  const ls = (lastschrift ?? "").trim().toUpperCase();
  return ls === "" || ls === "J";
}

/** SQL form of {@link paysByDirectDebit}, for filtering in a query. */
export function directDebitSql(lastschriftCol: Column, aufRechnungCol: Column): SQL {
  return sql`upper(coalesce(trim(${aufRechnungCol}), '')) <> 'J' and coalesce(nullif(upper(trim(${lastschriftCol})), ''), 'J') = 'J'`;
}
