import { desc, sql } from "drizzle-orm";
import * as v from "valibot";
import { vorstandProc } from "~/server/orpc/base";
import { auditLogTable } from "~/server/db/schema/audit";

const ListInput = v.object({
  page: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1)), 1),
  pageSize: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(200)), 50),
});

export const auditRouter = {
  list: vorstandProc.input(ListInput).handler(async ({ context, input }) => {
    const offset = (input.page - 1) * input.pageSize;
    const [rows, [totalRow]] = await Promise.all([
      context.db
        .select()
        .from(auditLogTable)
        .orderBy(desc(auditLogTable.createdAt))
        .limit(input.pageSize)
        .offset(offset),
      context.db.select({ c: sql<number>`count(*)::int` }).from(auditLogTable),
    ]);
    return { rows, total: totalRow?.c ?? 0 };
  }),
};
