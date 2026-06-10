import { and, isNull, or, type SQL, sql } from "drizzle-orm";
import { KEINE_ABTEILUNG_NAME } from "~/lib/abteilung-filter";
import { abteilungenTable, memberAbteilungenTable } from "~/server/db/schema/abteilungen";
import { membersTable } from "~/server/db/schema/members";

/**
 * The canonical "this member is not soft-deleted" condition.
 *
 * The legacy Linear `geloscht` flag is folded into the app's single `deletedAt`
 * (at import and via a one-time backfill), so checking `deletedAt` alone is
 * authoritative. Use this everywhere instead of hand-writing the old dual
 * filter (`deletedAt IS NULL AND coalesce(geloscht,false)=false`); when the
 * legacy column is finally dropped, nothing here needs to change.
 */
export function memberNotDeleted() {
  return isNull(membersTable.deletedAt);
}

/**
 * "This member has not exited yet, as of today."
 *
 * An Austritt date is the first day the person is no longer a member, so a
 * *future* leave date still counts as active (they have only given notice).
 * This mirrors the Bestandserhebung convention (`austritt > stichtag::date`)
 * with the Stichtag fixed to today. Use it for every "current member" filter so
 * a scheduled exit is treated consistently across lists, stats, and the
 * dashboard, instead of the old immediate `isNull(austritt)`.
 */
export function memberNotExited(): SQL {
  return or(
    isNull(membersTable.austritt),
    sql`${membersTable.austritt}::date > current_date`,
  ) as SQL;
}

/** Inverse of {@link memberNotExited}: the Austritt has taken effect. */
export function memberHasExited(): SQL {
  return sql`${membersTable.austritt} is not null and ${membersTable.austritt}::date <= current_date`;
}

/** "This member is not (yet) deceased, as of today." Deaths are facts and
 *  normally not future-dated, but gating by date keeps it symmetric with
 *  {@link memberNotExited} and harmless for a mistakenly future date. */
export function memberNotDeceased(): SQL {
  return or(
    isNull(membersTable.verstorbenAm),
    sql`${membersTable.verstorbenAm}::date > current_date`,
  ) as SQL;
}

/** Inverse of {@link memberNotDeceased}: the death has taken effect. */
export function memberHasDied(): SQL {
  return sql`${membersTable.verstorbenAm} is not null and ${membersTable.verstorbenAm}::date <= current_date`;
}

/**
 * "Still a member today": not soft-deleted, not exited, not deceased. The
 * single source of truth for the "Aktive Mitglieder" definition shared by the
 * member list, the overview stats strip, and the dashboard.
 */
export function memberIsCurrent(): SQL {
  return and(memberNotDeleted(), memberNotExited(), memberNotDeceased()) as SQL;
}

/**
 * "Notice given, exit still in the future": a member who has a leave date that
 * has not yet arrived and is not deceased. Drives the "Gekündigt" list filter
 * and the dashboard's pending-exits count.
 */
export function memberHasPendingExit(): SQL {
  return sql`${membersTable.austritt} is not null and ${membersTable.austritt}::date > current_date and ${membersTable.verstorbenAm} is null`;
}

/**
 * "Has an active membership in a real Abteilung": at least one
 * `member_abteilungen` row that is still open (no Austritt, or a future one)
 * and whose department is not the canonical "Keine Abteilung" sentinel. This
 * is the single source of truth for aktiv vs passiv: a live member with an
 * active Sparte is aktiv, one without is passiv. Derived on read, never stored,
 * so the distinction cannot drift from the Abteilung data.
 */
export function memberHasRealAbteilung(): SQL {
  return sql`exists (
    select 1 from ${memberAbteilungenTable} ma
    join ${abteilungenTable} a on a.id = ma.abteilung_id
    where ma.member_id = ${membersTable.id}
      and (ma.austrittsdatum is null or ma.austrittsdatum > current_date)
      and a.name <> ${KEINE_ABTEILUNG_NAME}
  )` as SQL;
}

/**
 * The derived "passiv" segment: a live member (not exited, not deceased) with
 * no active real Abteilung. Use this everywhere the old stored `status =
 * 'passiv'` filter was used, so list, stats, export, Rundschreiben and the
 * member badge all agree.
 */
export function memberIsPassiv(): SQL {
  return and(memberNotExited(), memberNotDeceased(), sql`not ${memberHasRealAbteilung()}`) as SQL;
}
