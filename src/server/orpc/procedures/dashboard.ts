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
    // All four counts must exclude soft-deleted members or the dashboard
    // drifts from the member list as soon as the first soft-delete happens.
    const notDeleted = isNull(membersTable.deletedAt);
    const [[total], [aktiv], [newThisMonth], [austritteThisMonth]] = await Promise.all([
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
    ]);

    const perAbteilung = await context.db
      .select({
        name: abteilungenTable.name,
        c: sql<number>`count(*)::int`,
      })
      .from(memberAbteilungenTable)
      .innerJoin(abteilungenTable, eq(memberAbteilungenTable.abteilungId, abteilungenTable.id))
      .innerJoin(membersTable, eq(membersTable.id, memberAbteilungenTable.memberId))
      .where(and(isNull(memberAbteilungenTable.austrittsdatum), isNull(membersTable.deletedAt)))
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
