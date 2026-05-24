import { and, count, eq, gte, isNotNull, isNull, sql } from "drizzle-orm";
import * as v from "valibot";
import { authedProc } from "~/server/orpc/base";
import { membersTable } from "~/server/db/schema/members";
import { abteilungenTable, memberAbteilungenTable } from "~/server/db/schema/abteilungen";

function startOfMonth(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

export const dashboardRouter = {
  stats: authedProc.input(v.void()).handler(async ({ context }) => {
    const since = startOfMonth();
    const [[total], [aktiv], [newThisMonth], [austritteThisMonth]] = await Promise.all([
      context.db.select({ c: count() }).from(membersTable),
      context.db
        .select({ c: count() })
        .from(membersTable)
        .where(and(isNull(membersTable.austritt), isNull(membersTable.verstorbenAm))),
      context.db
        .select({ c: count() })
        .from(membersTable)
        .where(and(isNotNull(membersTable.eintritt), gte(membersTable.eintritt, since))),
      context.db
        .select({ c: count() })
        .from(membersTable)
        .where(and(isNotNull(membersTable.austritt), gte(membersTable.austritt, since))),
    ]);

    const perAbteilung = await context.db
      .select({
        name: abteilungenTable.name,
        c: sql<number>`count(*)::int`,
      })
      .from(memberAbteilungenTable)
      .innerJoin(abteilungenTable, eq(memberAbteilungenTable.abteilungId, abteilungenTable.id))
      .where(isNull(memberAbteilungenTable.austrittsdatum))
      .groupBy(abteilungenTable.name)
      .orderBy(sql`count(*) desc`);

    return {
      total: total?.c ?? 0,
      aktiv: aktiv?.c ?? 0,
      newThisMonth: newThisMonth?.c ?? 0,
      austritteThisMonth: austritteThisMonth?.c ?? 0,
      perAbteilung,
    };
  }),
};
