import { ORPCError } from "@orpc/server";
import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import * as v from "valibot";
import { membersTable } from "~/server/db/schema/members";
import { memberTasksTable } from "~/server/db/schema/tasks";
import { memberDisplayName, memberRef } from "~/server/domain/member";
import { authedProc, vorstandProc } from "~/server/orpc/base";

const TitleInput = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(200));
const NotesInput = v.optional(v.nullable(v.pipe(v.string(), v.maxLength(2000))));
// Accept an ISO yyyy-mm-dd date or null.
const DueInput = v.optional(
  v.nullable(v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/, "Datum muss YYYY-MM-DD sein."))),
);

export const tasksRouter = {
  /** Open and recently completed Wiedervorlagen for one member. */
  listForMember: authedProc
    .input(v.object({ memberId: v.string() }))
    .handler(async ({ context, input }) => {
      const rows = await context.db
        .select()
        .from(memberTasksTable)
        .where(eq(memberTasksTable.memberId, input.memberId))
        .orderBy(
          // Open first, then by due date (soonest first, undated last), newest last.
          asc(memberTasksTable.status),
          sql`${memberTasksTable.dueDate} asc nulls last`,
          desc(memberTasksTable.createdAt),
        )
        .limit(50);
      return rows;
    }),

  create: vorstandProc
    .input(
      v.object({
        memberId: v.string(),
        title: TitleInput,
        notes: NotesInput,
        dueDate: DueInput,
      }),
    )
    .handler(async ({ context, input }) => {
      const [member] = await context.db
        .select({ id: membersTable.id })
        .from(membersTable)
        .where(eq(membersTable.id, input.memberId))
        .limit(1);
      if (!member) throw new ORPCError("NOT_FOUND", { message: "Mitglied nicht gefunden." });
      const [row] = await context.db
        .insert(memberTasksTable)
        .values({
          memberId: input.memberId,
          title: input.title,
          notes: input.notes ?? null,
          dueDate: input.dueDate ?? null,
          createdBy: context.session!.user.id,
          createdByEmail: context.session!.user.email,
        })
        .returning();
      return row;
    }),

  setStatus: vorstandProc
    .input(v.object({ id: v.string(), status: v.picklist(["open", "done"]) }))
    .handler(async ({ context, input }) => {
      const done = input.status === "done";
      const [row] = await context.db
        .update(memberTasksTable)
        .set({
          status: input.status,
          completedAt: done ? new Date() : null,
          completedByEmail: done ? context.session!.user.email : null,
        })
        .where(eq(memberTasksTable.id, input.id))
        .returning();
      if (!row) throw new ORPCError("NOT_FOUND", { message: "Aufgabe nicht gefunden." });
      return row;
    }),

  remove: vorstandProc.input(v.object({ id: v.string() })).handler(async ({ context, input }) => {
    await context.db.delete(memberTasksTable).where(eq(memberTasksTable.id, input.id));
    return { ok: true };
  }),

  /** All open tasks across members, soonest due first, for the worklist page. */
  worklist: authedProc.handler(async ({ context }) => {
    const rows = await context.db
      .select({
        id: memberTasksTable.id,
        title: memberTasksTable.title,
        notes: memberTasksTable.notes,
        dueDate: memberTasksTable.dueDate,
        createdAt: memberTasksTable.createdAt,
        createdByEmail: memberTasksTable.createdByEmail,
        memberId: membersTable.id,
        memberNo: membersTable.memberNo,
        kontaktNo: membersTable.kontaktNo,
        mitgliedsnummer: membersTable.mitgliedsnummer,
        adrNr: membersTable.adrNr,
        vorname: membersTable.vorname,
        nachname: membersTable.nachname,
        kurzname: membersTable.kurzname,
        firma1: membersTable.firma1,
      })
      .from(memberTasksTable)
      .innerJoin(membersTable, eq(membersTable.id, memberTasksTable.memberId))
      .where(eq(memberTasksTable.status, "open"))
      .orderBy(sql`${memberTasksTable.dueDate} asc nulls last`, desc(memberTasksTable.createdAt))
      .limit(500);
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      notes: r.notes,
      dueDate: r.dueDate,
      createdAt: r.createdAt,
      createdByEmail: r.createdByEmail,
      memberId: r.memberId,
      reference: memberRef(r),
      name: memberDisplayName(r),
    }));
  }),

  /** Counts for the sidebar badge: open total and overdue (due date in the past). */
  counts: authedProc.handler(async ({ context }) => {
    const [open] = await context.db
      .select({ c: count() })
      .from(memberTasksTable)
      .where(eq(memberTasksTable.status, "open"));
    const [overdue] = await context.db
      .select({ c: count() })
      .from(memberTasksTable)
      .where(
        and(
          eq(memberTasksTable.status, "open"),
          sql`${memberTasksTable.dueDate} is not null and ${memberTasksTable.dueDate} < current_date`,
        ),
      );
    return { open: open?.c ?? 0, overdue: overdue?.c ?? 0 };
  }),
};
