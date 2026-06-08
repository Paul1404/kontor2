import { and, between, desc, eq, gte, ilike, lte, or, sql } from "drizzle-orm";
import * as v from "valibot";
import { escapeLike } from "~/server/db/like";
import { appLogTable } from "~/server/db/schema/app-log";
import { logSinkConfig } from "~/server/lib/log-sink-db";
import { logger } from "~/server/lib/logger";
import { adminProc } from "~/server/orpc/base";

const LevelEnum = v.picklist(["info", "warn", "error"]);

const ListInput = v.object({
  page: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1)), 1),
  pageSize: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(200)), 50),
  // The free-text search casts `fields::text` (no index), so cap the term
  // length to keep it from becoming a slow-query vector.
  q: v.optional(v.pipe(v.string(), v.maxLength(200)), ""),
  level: v.optional(v.nullable(LevelEnum), null),
  requestId: v.optional(v.nullable(v.string()), null),
  proc: v.optional(v.nullable(v.string()), null),
  /** Inclusive lower bound, ISO date (YYYY-MM-DD). */
  from: v.optional(v.nullable(v.string()), null),
  /** Inclusive upper bound, ISO date (YYYY-MM-DD). */
  to: v.optional(v.nullable(v.string()), null),
});

const RangeInput = v.object({
  from: v.optional(v.nullable(v.string()), null),
  to: v.optional(v.nullable(v.string()), null),
});

const PurgeInput = v.object({
  /** Delete entries older than N days. `null` clears the whole log. */
  olderThanDays: v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1))), null),
});

function toStartOfDay(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(d.getTime()) ? d : null;
}

function toEndOfDay(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(`${value}T23:59:59.999Z`);
  return Number.isFinite(d.getTime()) ? d : null;
}

/** Shared range predicate for list/stats so both filter identically. */
function rangeConditions(from: string | null, to: string | null) {
  const lo = toStartOfDay(from);
  const hi = toEndOfDay(to);
  const out: ReturnType<typeof eq>[] = [];
  if (lo && hi) out.push(between(appLogTable.createdAt, lo, hi) as never);
  else if (lo) out.push(gte(appLogTable.createdAt, lo) as never);
  else if (hi) out.push(lte(appLogTable.createdAt, hi) as never);
  return out;
}

export const logsRouter = {
  /**
   * Current sink configuration, so the viewer can tell the operator what is
   * being captured and for how long.
   */
  config: adminProc.input(v.void()).handler(() => logSinkConfig()),

  /**
   * Level counts (and the most recent event time) over the selected range.
   * Drives the summary cards above the feed.
   */
  stats: adminProc.input(RangeInput).handler(async ({ context, input }) => {
    const conditions = rangeConditions(input.from, input.to);
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const rows = await context.db
      .select({
        level: appLogTable.level,
        count: sql<number>`count(*)::int`,
        last: sql<string | null>`max(${appLogTable.createdAt})::text`,
      })
      .from(appLogTable)
      .where(where)
      .groupBy(appLogTable.level);

    const byLevel = { info: 0, warn: 0, error: 0 };
    let lastEventAt: string | null = null;
    for (const r of rows) {
      byLevel[r.level] = r.count;
      if (r.last && (!lastEventAt || r.last > lastEventAt)) lastEventAt = r.last;
    }
    return {
      total: byLevel.info + byLevel.warn + byLevel.error,
      info: byLevel.info,
      warn: byLevel.warn,
      error: byLevel.error,
      lastEventAt,
    };
  }),

  /** Paginated, filterable log feed, newest first. */
  list: adminProc.input(ListInput).handler(async ({ context, input }) => {
    const conditions = rangeConditions(input.from, input.to);
    if (input.level) conditions.push(eq(appLogTable.level, input.level) as never);
    if (input.requestId) conditions.push(eq(appLogTable.requestId, input.requestId) as never);
    if (input.proc) conditions.push(eq(appLogTable.proc, input.proc) as never);

    if (input.q.trim()) {
      const like = `%${escapeLike(input.q.trim())}%`;
      conditions.push(
        or(
          ilike(appLogTable.message, like),
          ilike(appLogTable.proc, like),
          ilike(appLogTable.requestId, like),
          ilike(appLogTable.actorEmail, like),
          sql`${appLogTable.fields}::text ilike ${like}`,
        ) as never,
      );
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (input.page - 1) * input.pageSize;
    const [rows, [totalRow]] = await Promise.all([
      context.db
        .select()
        .from(appLogTable)
        .where(where)
        .orderBy(desc(appLogTable.createdAt))
        .limit(input.pageSize)
        .offset(offset),
      context.db.select({ c: sql<number>`count(*)::int` }).from(appLogTable).where(where),
    ]);
    return { rows, total: totalRow?.c ?? 0 };
  }),

  /**
   * Delete log rows. With `olderThanDays` set, only entries past that age are
   * removed; otherwise the whole table is cleared. The action itself is logged.
   */
  purge: adminProc.input(PurgeInput).handler(async ({ context, input }) => {
    const where =
      input.olderThanDays != null
        ? lte(
            appLogTable.createdAt,
            new Date(Date.now() - input.olderThanDays * 24 * 60 * 60 * 1000),
          )
        : undefined;
    const [before] = await context.db
      .select({ c: sql<number>`count(*)::int` })
      .from(appLogTable)
      .where(where);
    await context.db.delete(appLogTable).where(where);
    const deleted = before?.c ?? 0;
    logger.warn("logs.purged", {
      actorEmail: context.session?.user.email ?? null,
      olderThanDays: input.olderThanDays,
      deleted,
    });
    return { deleted };
  }),
};
