import { and, count, eq, gte, isNotNull, isNull, sql } from "drizzle-orm";
import * as v from "valibot";
import { memberNotDeleted } from "~/server/db/member-filters";
import { abteilungenTable, memberAbteilungenTable } from "~/server/db/schema/abteilungen";
import { membersTable } from "~/server/db/schema/members";
import { authedProc } from "~/server/orpc/base";
import { CACHE_NS, cached } from "~/server/search/cache";

function startOfMonth(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

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
          .where(and(notDeleted, isNull(membersTable.austritt), isNull(membersTable.verstorbenAm))),
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
            and ${membersTable.austritt} is null
            and ${membersTable.verstorbenAm} is null
        ) t
        group by bucket
        order by bucket
      `),
        // Gender from the explicit `geschlecht` enum column. Members whose
        // column is NULL (shouldn't happen post-backfill, but defensive)
        // fall into "unbekannt".
        context.db.execute<{ gender: string; c: number }>(sql`
        select gender, count(*)::int as c from (
          select case ${membersTable.geschlecht}::text
            when 'm' then 'männlich'
            when 'w' then 'weiblich'
            when 'd' then 'divers'
            else 'unbekannt'
          end as gender
          from ${membersTable}
          where ${memberNotDeleted()}
            and ${membersTable.austritt} is null
            and ${membersTable.verstorbenAm} is null
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
            and ${membersTable.austritt} is null
            and ${membersTable.verstorbenAm} is null
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
            and ${membersTable.austritt} is null
            and ${membersTable.verstorbenAm} is null
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
};
