import { and, count, eq, gte, isNotNull, isNull, sql } from "drizzle-orm";
import * as v from "valibot";
import { memberNotDeceased, memberNotDeleted, memberNotExited } from "~/server/db/member-filters";
import { abteilungenTable, memberAbteilungenTable } from "~/server/db/schema/abteilungen";
import { membersTable } from "~/server/db/schema/members";
import { authedProc } from "~/server/orpc/base";
import { CACHE_NS, cached } from "~/server/search/cache";

function startOfMonth(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/**
 * Effective gender code ('m' | 'w' | 'd' | 'unbekannt') for a member row.
 *
 * The explicit `geschlecht` column is the source of truth, but the legacy base
 * was migrated with a blunt rule (only an exact "Herr"/"Frau" mapped, the rest
 * became 'unbekannt'), so most rows read 'unbekannt' even when their Anrede is
 * a clear marker. Rather than depend on a one-off backfill having been run in
 * production, we fall back to deriving from the Anrede at query time whenever
 * the column is null or 'unbekannt'. This mirrors `deriveGeschlecht` and keeps
 * the dashboard honest: a real, untranslatable Anrede still reads 'unbekannt'.
 */
const effectiveGender = sql`case
  when ${membersTable.geschlecht}::text in ('m', 'w', 'd') then ${membersTable.geschlecht}::text
  when lower(btrim(${membersTable.anrede})) in ('herr', 'hr', 'hr.', 'herrn')
       or lower(btrim(${membersTable.anrede})) like 'herr %' then 'm'
  when lower(btrim(${membersTable.anrede})) in ('frau', 'fr', 'fr.')
       or lower(btrim(${membersTable.anrede})) like 'frau %' then 'w'
  when lower(btrim(${membersTable.anrede})) = 'divers' then 'd'
  else 'unbekannt'
end`;

export const dashboardRouter = {
  stats: authedProc.input(v.void()).handler(async ({ context }) =>
    // Read-through cached: the KPIs are global (no per-user data) and run ~9
    // aggregations per call. Busted on every member/Abteilung mutation, with
    // a short TTL as a backstop. The `since` (month start) is part of the
    // semantics but not the cache key — at month rollover the stale entry
    // expires within the TTL.
    cached(CACHE_NS.dashboard, "stats", 120, async () => {
      const since = startOfMonth();
      // All counts must exclude soft-deleted members or the dashboard drifts
      // from the member list / fee runs. The legacy Linear `geloscht` flag is
      // folded into the app's single `deletedAt`, so one check is authoritative.
      const notDeleted = memberNotDeleted();
      const [
        [total],
        [aktiv],
        [newThisMonth],
        [austritteThisMonth],
        ageBuckets,
        genderRows,
        birthdaysSoon,
        tenureBuckets,
      ] = await Promise.all([
        context.db.select({ c: count() }).from(membersTable).where(notDeleted),
        context.db
          .select({ c: count() })
          .from(membersTable)
          .where(and(notDeleted, memberNotExited(), memberNotDeceased())),
        context.db
          .select({ c: count() })
          .from(membersTable)
          .where(
            and(notDeleted, isNotNull(membersTable.eintritt), gte(membersTable.eintritt, since)),
          ),
        context.db
          .select({ c: count() })
          .from(membersTable)
          .where(
            and(notDeleted, isNotNull(membersTable.austritt), gte(membersTable.austritt, since)),
          ),
        // Age buckets, computed over current active members. Anyone without a
        // birthday gets bucketed into "unbekannt" so we can show the data
        // gap; useful for nudging the office to backfill records.
        context.db.execute<{ bucket: string; c: number }>(sql`
        select bucket, count(*)::int as c from (
          select case
            when ${membersTable.geburtsdatum} is null then 'unbekannt'
            when extract(year from age(${membersTable.geburtsdatum})) < 18 then '0-17'
            when extract(year from age(${membersTable.geburtsdatum})) < 30 then '18-29'
            when extract(year from age(${membersTable.geburtsdatum})) < 45 then '30-44'
            when extract(year from age(${membersTable.geburtsdatum})) < 60 then '45-59'
            when extract(year from age(${membersTable.geburtsdatum})) < 75 then '60-74'
            else '75+'
          end as bucket
          from ${membersTable}
          where ${memberNotDeleted()}
            and ${memberNotExited()}
            and ${memberNotDeceased()}
        ) t
        group by bucket
        order by bucket
      `),
        // Gender from the effective code (explicit column, else derived from
        // the Anrede). Anything that still can't be resolved reads "unbekannt"
        // so the chart shows the genuine data gap.
        context.db.execute<{ gender: string; c: number }>(sql`
        select gender, count(*)::int as c from (
          select case g
            when 'm' then 'männlich'
            when 'w' then 'weiblich'
            when 'd' then 'divers'
            else 'unbekannt'
          end as gender
          from (
            select ${effectiveGender} as g
            from ${membersTable}
            where ${memberNotDeleted()}
              and ${memberNotExited()}
              and ${memberNotDeceased()}
          ) s
        ) t
        group by gender
        order by case gender
          when 'männlich' then 1
          when 'weiblich' then 2
          when 'divers' then 3
          else 4
        end
      `),
        // Birthdays in the next 30 days. We compute on the next anniversary
        // (year +1 if it has already passed this year) so the list wraps
        // around December → January cleanly.
        context.db.execute<{
          id: string;
          member_no: string | null;
          kontakt_no: string | null;
          mitgliedsnummer: string | null;
          adr_nr: number;
          vorname: string | null;
          nachname: string | null;
          geburtsdatum: Date;
          next_birthday: Date;
          turns: number;
        }>(sql`
        select id, member_no, kontakt_no, mitgliedsnummer, adr_nr, vorname, nachname, geburtsdatum, next_birthday,
               extract(year from age(next_birthday, geburtsdatum))::int as turns
        from (
          select id, member_no, kontakt_no, mitgliedsnummer, adr_nr, vorname, nachname, geburtsdatum,
            case
              when make_date(extract(year from current_date)::int,
                             extract(month from ${membersTable.geburtsdatum})::int,
                             extract(day from ${membersTable.geburtsdatum})::int)
                   >= current_date
              then make_date(extract(year from current_date)::int,
                             extract(month from ${membersTable.geburtsdatum})::int,
                             extract(day from ${membersTable.geburtsdatum})::int)
              else make_date((extract(year from current_date)+1)::int,
                             extract(month from ${membersTable.geburtsdatum})::int,
                             extract(day from ${membersTable.geburtsdatum})::int)
            end as next_birthday
          from ${membersTable}
          where ${memberNotDeleted()}
            and ${memberNotExited()}
            and ${memberNotDeceased()}
            and ${membersTable.geburtsdatum} is not null
        ) t
        where next_birthday <= current_date + interval '30 days'
        order by next_birthday asc
        limit 12
      `),
        // Mitgliedsdauer (Tenure) buckets for active members. Anyone without
        // an Eintritt date is grouped separately.
        context.db.execute<{ bucket: string; c: number }>(sql`
        select bucket, count(*)::int as c from (
          select case
            when ${membersTable.eintritt} is null then 'unbekannt'
            when extract(year from age(${membersTable.eintritt})) < 1 then '< 1 Jahr'
            when extract(year from age(${membersTable.eintritt})) < 5 then '1-4 Jahre'
            when extract(year from age(${membersTable.eintritt})) < 10 then '5-9 Jahre'
            when extract(year from age(${membersTable.eintritt})) < 25 then '10-24 Jahre'
            else '25+ Jahre'
          end as bucket
          from ${membersTable}
          where ${memberNotDeleted()}
            and ${memberNotExited()}
            and ${memberNotDeceased()}
        ) t
        group by bucket
        order by bucket
      `),
      ]);

      const perAbteilung = await context.db
        .select({
          name: abteilungenTable.name,
          c: sql<number>`count(*)::int`,
        })
        .from(memberAbteilungenTable)
        .innerJoin(abteilungenTable, eq(memberAbteilungenTable.abteilungId, abteilungenTable.id))
        .innerJoin(membersTable, eq(membersTable.id, memberAbteilungenTable.memberId))
        .where(and(isNull(memberAbteilungenTable.austrittsdatum), memberNotDeleted()))
        .groupBy(abteilungenTable.name)
        .orderBy(sql`count(*) desc`);

      // postgres-js returns the result array directly from db.execute.
      const ageBucketsArr = ageBuckets as unknown as Array<{ bucket: string; c: number }>;
      const genderArr = genderRows as unknown as Array<{ gender: string; c: number }>;
      const birthdaysArr = birthdaysSoon as unknown as Array<Record<string, unknown>>;
      const tenureArr = tenureBuckets as unknown as Array<{ bucket: string; c: number }>;

      return {
        total: total?.c ?? 0,
        aktiv: aktiv?.c ?? 0,
        newThisMonth: newThisMonth?.c ?? 0,
        austritteThisMonth: austritteThisMonth?.c ?? 0,
        perAbteilung,
        ageBuckets: ageBucketsArr,
        gender: genderArr,
        birthdays: birthdaysArr.map((b) => ({
          id: String(b.id),
          memberNo: (b.member_no as string | null) ?? null,
          kontaktNo: (b.kontakt_no as string | null) ?? null,
          mitgliedsnummer: (b.mitgliedsnummer as string | null) ?? null,
          adrNr: Number(b.adr_nr),
          vorname: (b.vorname as string | null) ?? null,
          nachname: (b.nachname as string | null) ?? null,
          nextBirthday: b.next_birthday as string | Date,
          turns: Number(b.turns),
        })),
        tenure: tenureArr,
      };
    }),
  ),

  /**
   * Trend and finance aggregates for the Auswertungen section: member
   * development over the last ten years, Eintritte/Austritte per year,
   * Beitragsvolumen and Zahlungsquote per billing year, the Mahnstufen-Funnel,
   * the Zahlart split (Lastschrift vs Rechnung) and an age pyramid by gender.
   * Cached longer than the KPIs -- these move slowly and are heavier to compute.
   */
  insights: authedProc.input(v.void()).handler(async ({ context }) =>
    cached(CACHE_NS.dashboard, "insights", 300, async () => {
      const [membersOverTime, revenueRows, funnelRows, zahlartRows, pyramidRows] =
        await Promise.all([
          context.db.execute<{
            year: number;
            aktiv: number;
            eintritte: number;
            austritte: number;
          }>(sql`
        select y::int as year,
          (select count(*) from ${membersTable}
             where deleted_at is null and eintritt is not null
               and extract(year from eintritt) <= y
               and (austritt is null or extract(year from austritt) > y)
               and (verstorben_am is null or extract(year from verstorben_am) > y))::int as aktiv,
          (select count(*) from ${membersTable}
             where deleted_at is null and extract(year from eintritt) = y)::int as eintritte,
          (select count(*) from ${membersTable}
             where deleted_at is null and extract(year from austritt) = y)::int as austritte
        from generate_series(extract(year from current_date)::int - 9,
                             extract(year from current_date)::int) as y
        order by y
      `),
          context.db.execute<{ year: number; soll: number; bezahlt: number; offen: number }>(sql`
        select billing_year as year,
               sum(amount)::float8 as soll,
               sum(paid_amount)::float8 as bezahlt,
               sum(open_amount)::float8 as offen
        from soll_stellungen
        where status <> 'cancelled'
        group by billing_year
        order by billing_year desc
        limit 8
      `),
          context.db.execute<{ mahnstufe: number; anzahl: number; offen: number }>(sql`
        select mahnstufe, count(*)::int as anzahl, coalesce(sum(open_amount), 0)::float8 as offen
        from soll_stellungen
        where status in ('open', 'returned') and open_amount > 0
        group by mahnstufe
        order by mahnstufe
      `),
          context.db.execute<{ lastschrift: number; rechnung: number }>(sql`
        select
          (select count(*) from ${membersTable} m
             where m.deleted_at is null and (m.austritt is null or m.austritt::date > current_date) and m.verstorben_am is null
               and exists (select 1 from contracts c where c.member_id = m.id and c.is_direct_debit = true
                            and c.gekuend_zum is null and (c.vertrag_ende is null or c.vertrag_ende >= current_date)))::int as lastschrift,
          (select count(*) from ${membersTable} m
             where m.deleted_at is null and (m.austritt is null or m.austritt::date > current_date) and m.verstorben_am is null
               and exists (select 1 from contracts c where c.member_id = m.id
                            and c.gekuend_zum is null and (c.vertrag_ende is null or c.vertrag_ende >= current_date))
               and not exists (select 1 from contracts c where c.member_id = m.id and c.is_direct_debit = true
                            and c.gekuend_zum is null and (c.vertrag_ende is null or c.vertrag_ende >= current_date)))::int as rechnung
      `),
          context.db.execute<{ bucket: string; m: number; w: number; d: number }>(sql`
        select bucket,
          sum(case when g = 'm' then 1 else 0 end)::int as m,
          sum(case when g = 'w' then 1 else 0 end)::int as w,
          sum(case when g is null or g not in ('m', 'w') then 1 else 0 end)::int as d
        from (
          select case
            when ${membersTable.geburtsdatum} is null then 'unbekannt'
            when extract(year from age(${membersTable.geburtsdatum})) < 18 then '0-17'
            when extract(year from age(${membersTable.geburtsdatum})) < 30 then '18-29'
            when extract(year from age(${membersTable.geburtsdatum})) < 45 then '30-44'
            when extract(year from age(${membersTable.geburtsdatum})) < 60 then '45-59'
            when extract(year from age(${membersTable.geburtsdatum})) < 75 then '60-74'
            else '75+'
          end as bucket,
          ${effectiveGender} as g
          from ${membersTable}
          where ${memberNotDeleted()}
            and ${memberNotExited()}
            and ${memberNotDeceased()}
        ) t
        group by bucket
      `),
        ]);

      const overTime = membersOverTime as unknown as Array<{
        year: number;
        aktiv: number;
        eintritte: number;
        austritte: number;
      }>;
      const revenue = (
        revenueRows as unknown as Array<{
          year: number;
          soll: number;
          bezahlt: number;
          offen: number;
        }>
      )
        .map((r) => ({
          year: Number(r.year),
          soll: Number(r.soll),
          bezahlt: Number(r.bezahlt),
          offen: Number(r.offen),
        }))
        .sort((a, b) => a.year - b.year);
      const funnel = (
        funnelRows as unknown as Array<{ mahnstufe: number; anzahl: number; offen: number }>
      ).map((r) => ({
        mahnstufe: Number(r.mahnstufe),
        anzahl: Number(r.anzahl),
        offen: Number(r.offen),
      }));
      const zahlart = (
        zahlartRows as unknown as Array<{ lastschrift: number; rechnung: number }>
      )[0] ?? {
        lastschrift: 0,
        rechnung: 0,
      };
      const PYRAMID_ORDER = ["0-17", "18-29", "30-44", "45-59", "60-74", "75+", "unbekannt"];
      const pyramid = (
        pyramidRows as unknown as Array<{ bucket: string; m: number; w: number; d: number }>
      )
        .map((r) => ({ bucket: r.bucket, m: Number(r.m), w: Number(r.w), d: Number(r.d) }))
        .sort((a, b) => PYRAMID_ORDER.indexOf(a.bucket) - PYRAMID_ORDER.indexOf(b.bucket));

      return {
        membersOverTime: overTime.map((r) => ({
          year: Number(r.year),
          aktiv: Number(r.aktiv),
          eintritte: Number(r.eintritte),
          austritte: Number(r.austritte),
        })),
        revenueByYear: revenue,
        dunningFunnel: funnel,
        zahlart: { lastschrift: Number(zahlart.lastschrift), rechnung: Number(zahlart.rechnung) },
        agePyramid: pyramid,
      };
    }),
  ),
};
