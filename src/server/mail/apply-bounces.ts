import { and, desc, eq, gte, isNull, lte, ne, sql } from "drizzle-orm";
import type { DB } from "~/server/db/client";
import { memberNotDeleted } from "~/server/db/member-filters";
import { emailLogTable } from "~/server/db/schema/email-log";
import { membersTable } from "~/server/db/schema/members";
import { memberTasksTable } from "~/server/db/schema/tasks";
import { type DsnRecipient, describeBounce, isPermanent } from "~/server/mail/dsn";
import type { BounceReport } from "~/server/mail/read-bounces";

/** How far back to look for the sent mail when a report quotes no Message-ID. */
const FALLBACK_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const TASK_TITLE = "E-Mail nicht zustellbar";

export type BounceOutcome = {
  scanned: number;
  /** Reports that named at least one failed recipient. */
  failures: number;
  matchedLogRows: number;
  markedMembers: number;
  tasksCreated: number;
};

/**
 * Find the log row a bounce belongs to. The Message-ID is exact and preferred;
 * without one, fall back to the newest matching mail to that address before the
 * report arrived. The fallback can only ever be a best guess, so it is bounded
 * by a window rather than reaching arbitrarily far back.
 */
async function findLogRow(
  db: DB,
  report: BounceReport,
  recipient: string,
): Promise<{ id: string; entityType: string | null; entityId: string | null } | null> {
  if (report.originalMessageId) {
    const [row] = await db
      .select({
        id: emailLogTable.id,
        entityType: emailLogTable.entityType,
        entityId: emailLogTable.entityId,
      })
      .from(emailLogTable)
      .where(eq(emailLogTable.messageId, report.originalMessageId))
      .limit(1);
    if (row) return row;
  }
  const [row] = await db
    .select({
      id: emailLogTable.id,
      entityType: emailLogTable.entityType,
      entityId: emailLogTable.entityId,
    })
    .from(emailLogTable)
    .where(
      and(
        sql`lower(${emailLogTable.recipient}) = ${recipient}`,
        eq(emailLogTable.status, "sent"),
        lte(emailLogTable.createdAt, report.receivedAt),
        gte(emailLogTable.createdAt, new Date(report.receivedAt.getTime() - FALLBACK_WINDOW_MS)),
      ),
    )
    .orderBy(desc(emailLogTable.createdAt))
    .limit(1);
  return row ?? null;
}

/**
 * Record delivery failure reports: correct the log row, flag the member whose
 * address is unreachable, and raise a Wiedervorlage so the case lands on a
 * worklist instead of only in a protocol nobody opens.
 *
 * Safe to run repeatedly. A row already marked bounced is left alone, and a
 * member who already has an open task does not collect a second one.
 */
export async function applyBounces(
  db: DB,
  reports: BounceReport[],
  opts: { actorEmail?: string | null } = {},
): Promise<BounceOutcome> {
  const outcome: BounceOutcome = {
    scanned: reports.length,
    failures: 0,
    matchedLogRows: 0,
    markedMembers: 0,
    tasksCreated: 0,
  };

  for (const report of reports) {
    const failed = report.recipients.filter(
      (r): r is DsnRecipient => r.action === "failed" && Boolean(r.recipient),
    );
    if (failed.length === 0) continue;
    outcome.failures += 1;

    for (const recipient of failed) {
      const reason = describeBounce(recipient);
      const code = [recipient.status, recipient.diagnostic].filter(Boolean).join(" · ") || null;

      const logRow = await findLogRow(db, report, recipient.recipient);
      if (logRow) {
        const updated = await db
          .update(emailLogTable)
          .set({ status: "bounced", bouncedAt: report.receivedAt, bounceCode: code })
          .where(and(eq(emailLogTable.id, logRow.id), ne(emailLogTable.status, "bounced")))
          .returning({ id: emailLogTable.id });
        outcome.matchedLogRows += updated.length;
      }

      // A permanent failure condemns the address; a temporary one (a full
      // mailbox) is recorded on the mail but must not brand the member.
      if (!isPermanent(recipient)) continue;

      const members = await db
        .select({ id: membersTable.id, undeliverableAt: membersTable.emailUndeliverableAt })
        .from(membersTable)
        .where(and(sql`lower(${membersTable.email}) = ${recipient.recipient}`, memberNotDeleted()));

      for (const member of members) {
        await db
          .update(membersTable)
          .set({
            emailUndeliverableAt: report.receivedAt,
            emailUndeliverableReason: reason,
            updatedAt: new Date(),
          })
          .where(eq(membersTable.id, member.id));
        if (!member.undeliverableAt) outcome.markedMembers += 1;

        const [existing] = await db
          .select({ id: memberTasksTable.id })
          .from(memberTasksTable)
          .where(
            and(
              eq(memberTasksTable.memberId, member.id),
              eq(memberTasksTable.title, TASK_TITLE),
              eq(memberTasksTable.status, "open"),
            ),
          )
          .limit(1);
        if (existing) continue;

        await db.insert(memberTasksTable).values({
          memberId: member.id,
          title: TASK_TITLE,
          notes: `${recipient.recipient}: ${reason}. Bitte eine gültige Adresse erfragen oder den Postweg nutzen.`,
          createdByEmail: opts.actorEmail ?? null,
        });
        outcome.tasksCreated += 1;
      }
    }
  }

  return outcome;
}

/**
 * Clear the undeliverable flag. A new address has not failed yet, so keeping
 * the warning would train operators to ignore it.
 */
export async function clearUndeliverable(db: DB, memberId: string): Promise<void> {
  await db
    .update(membersTable)
    .set({ emailUndeliverableAt: null, emailUndeliverableReason: null })
    .where(and(eq(membersTable.id, memberId), isNull(membersTable.deletedAt)));
}
