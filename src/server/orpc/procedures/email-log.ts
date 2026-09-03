import { ORPCError } from "@orpc/server";
import { and, between, desc, eq, gte, ilike, lte, or, sql } from "drizzle-orm";
import * as v from "valibot";
import type { DB } from "~/server/db/client";
import { escapeLike } from "~/server/db/like";
import { emailLogTable } from "~/server/db/schema/email-log";
import { logger } from "~/server/lib/logger";
import { applyBounces } from "~/server/mail/apply-bounces";
import { loadMailOrganization } from "~/server/mail/branding";
import { inlineLogoForPreview } from "~/server/mail/layout";
import { readBounces } from "~/server/mail/read-bounces";
import { findSentMessage } from "~/server/mail/read-sent-mail";
import { reconstructSentMessage } from "~/server/mail/reconstruct-sent-mail";
import { adminProc } from "~/server/orpc/base";

const StatusEnum = v.picklist(["sent", "failed", "skipped", "bounced"]);

const ListInput = v.object({
  page: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1)), 1),
  pageSize: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(200)), 50),
  q: v.optional(v.pipe(v.string(), v.maxLength(200)), ""),
  status: v.optional(v.nullable(StatusEnum), null),
  kind: v.optional(v.nullable(v.string()), null),
  from: v.optional(v.nullable(v.string()), null),
  to: v.optional(v.nullable(v.string()), null),
});

const RangeInput = v.object({
  from: v.optional(v.nullable(v.string()), null),
  to: v.optional(v.nullable(v.string()), null),
});

const PurgeInput = v.object({
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

function rangeConditions(from: string | null, to: string | null) {
  const lo = toStartOfDay(from);
  const hi = toEndOfDay(to);
  const out: ReturnType<typeof eq>[] = [];
  if (lo && hi) out.push(between(emailLogTable.createdAt, lo, hi) as never);
  else if (lo) out.push(gte(emailLogTable.createdAt, lo) as never);
  else if (hi) out.push(lte(emailLogTable.createdAt, hi) as never);
  return out;
}

/**
 * The archive stores the message exactly as sent, logo included as a `cid:`
 * reference. No browser can resolve that, so a stored mail would always render
 * with a hole where the crest belongs. Swapping in the club's current logo is
 * cosmetic identity, not message content; a club that later changes its logo
 * will see the new one on old mail, which beats a broken image on all of them.
 */
async function displayableHtml(db: DB, html: string): Promise<string> {
  return inlineLogoForPreview(html, await loadMailOrganization(db));
}

export const emailLogRouter = {
  /** Status counts (+ last send) over the range, and the kinds present for filtering. */
  stats: adminProc.input(RangeInput).handler(async ({ context, input }) => {
    const conditions = rangeConditions(input.from, input.to);
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const [statusRows, kindRows] = await Promise.all([
      context.db
        .select({
          status: emailLogTable.status,
          count: sql<number>`count(*)::int`,
          last: sql<string | null>`max(${emailLogTable.createdAt})::text`,
        })
        .from(emailLogTable)
        .where(where)
        .groupBy(emailLogTable.status),
      context.db
        .selectDistinct({ kind: emailLogTable.kind })
        .from(emailLogTable)
        .orderBy(emailLogTable.kind),
    ]);

    const byStatus = { sent: 0, failed: 0, skipped: 0, bounced: 0 };
    let lastEventAt: string | null = null;
    for (const r of statusRows) {
      byStatus[r.status] = r.count;
      if (r.last && (!lastEventAt || r.last > lastEventAt)) lastEventAt = r.last;
    }
    return {
      total: byStatus.sent + byStatus.failed + byStatus.skipped + byStatus.bounced,
      sent: byStatus.sent,
      failed: byStatus.failed,
      skipped: byStatus.skipped,
      bounced: byStatus.bounced,
      lastEventAt,
      kinds: kindRows.map((r) => r.kind),
    };
  }),

  /** Paginated, filterable mail feed, newest first. */
  list: adminProc.input(ListInput).handler(async ({ context, input }) => {
    const conditions = rangeConditions(input.from, input.to);
    if (input.status) conditions.push(eq(emailLogTable.status, input.status) as never);
    if (input.kind) conditions.push(eq(emailLogTable.kind, input.kind) as never);
    if (input.q.trim()) {
      const like = `%${escapeLike(input.q.trim())}%`;
      conditions.push(
        or(
          ilike(emailLogTable.recipient, like),
          ilike(emailLogTable.subject, like),
          ilike(emailLogTable.kind, like),
          ilike(emailLogTable.actorEmail, like),
          ilike(emailLogTable.detail, like),
        ) as never,
      );
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (input.page - 1) * input.pageSize;
    const [rows, [totalRow]] = await Promise.all([
      context.db
        .select({
          id: emailLogTable.id,
          createdAt: emailLogTable.createdAt,
          kind: emailLogTable.kind,
          status: emailLogTable.status,
          recipient: emailLogTable.recipient,
          subject: emailLogTable.subject,
          detail: emailLogTable.detail,
          actorEmail: emailLogTable.actorEmail,
          hasContent: sql<boolean>`(${emailLogTable.bodyText} is not null or ${emailLogTable.bodyHtml} is not null)`,
        })
        .from(emailLogTable)
        .where(where)
        .orderBy(desc(emailLogTable.createdAt))
        .limit(input.pageSize)
        .offset(offset),
      context.db.select({ c: sql<number>`count(*)::int` }).from(emailLogTable).where(where),
    ]);
    return { rows, total: totalRow?.c ?? 0 };
  }),

  /**
   * Read delivery failure reports from the mailbox and record them: correct the
   * affected log rows, flag members whose address is permanently unreachable,
   * and raise a Wiedervorlage for each. "Versendet" only ever meant the mail
   * server accepted the message, so without this a bounce stays invisible.
   */
  scanBounces: adminProc
    .input(
      v.optional(
        v.object({
          /** How many days back to look. Reports arrive within minutes. */
          days: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(90)), 14),
        }),
        {},
      ),
    )
    .handler(async ({ context, input }) => {
      const days = input?.days ?? 14;
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      let reports: Awaited<ReturnType<typeof readBounces>>;
      try {
        reports = await readBounces(context.db, { since });
      } catch (error) {
        logger.warn("email_log.bounce_scan_failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        throw new ORPCError("PRECONDITION_FAILED", {
          message:
            "Das Postfach konnte nicht gelesen werden. Bitte den IMAP-Zugang unter Einstellungen, E-Mail prüfen.",
        });
      }
      if (reports.mailbox === null) {
        throw new ORPCError("PRECONDITION_FAILED", {
          message: "Für IMAP werden Benutzername und Passwort benötigt.",
        });
      }
      const outcome = await applyBounces(context.db, reports.reports, {
        actorEmail: context.session!.user.email,
      });
      return { ...outcome, days };
    }),

  /** Read-only snapshot of one outbound message. Binary attachments are never returned. */
  get: adminProc
    .input(v.object({ id: v.pipe(v.string(), v.uuid()) }))
    .handler(async ({ context, input }) => {
      const [row] = await context.db
        .select()
        .from(emailLogTable)
        .where(eq(emailLogTable.id, input.id))
        .limit(1);
      if (!row) {
        throw new ORPCError("NOT_FOUND", { message: "E-Mail-Protokolleintrag nicht gefunden." });
      }
      if (row.bodyText || row.bodyHtml) {
        return {
          ...row,
          bodyHtml: row.bodyHtml ? await displayableHtml(context.db, row.bodyHtml) : null,
          contentSource: "archive" as const,
        };
      }
      if (row.status !== "sent" || !row.recipient || !row.subject) {
        return { ...row, contentSource: "none" as const };
      }
      try {
        const reconstructed = await reconstructSentMessage(context.db, {
          kind: row.kind,
          entityType: row.entityType,
          entityId: row.entityId,
          recipient: row.recipient,
          subject: row.subject,
          sentAt: row.createdAt,
        });
        if (reconstructed) {
          return { ...row, ...reconstructed, contentSource: "reconstructed" as const };
        }
      } catch (error) {
        logger.warn("email_log.reconstruction_failed", {
          emailLogId: row.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      let imapUnavailable = false;
      try {
        const sent = await findSentMessage(context.db, {
          recipient: row.recipient,
          subject: row.subject,
          sentAt: row.createdAt,
        });
        if (sent) {
          return {
            ...row,
            bodyText: sent.bodyText,
            bodyHtml: sent.bodyHtml ? await displayableHtml(context.db, sent.bodyHtml) : null,
            attachmentNames: sent.attachmentNames,
            contentSource: "imap" as const,
            imapMailbox: sent.mailbox,
          };
        }
      } catch (error) {
        imapUnavailable = true;
        logger.warn("email_log.imap_lookup_failed", {
          emailLogId: row.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return {
        ...row,
        contentSource: imapUnavailable ? ("unavailable" as const) : ("none" as const),
      };
    }),

  /** Delete mail-log rows older than N days, or clear the whole log. Logged. */
  purge: adminProc.input(PurgeInput).handler(async ({ context, input }) => {
    const where =
      input.olderThanDays != null
        ? lte(
            emailLogTable.createdAt,
            new Date(Date.now() - input.olderThanDays * 24 * 60 * 60 * 1000),
          )
        : undefined;
    const [before] = await context.db
      .select({ c: sql<number>`count(*)::int` })
      .from(emailLogTable)
      .where(where);
    await context.db.delete(emailLogTable).where(where);
    const deleted = before?.c ?? 0;
    logger.warn("email_log.purged", {
      actorEmail: context.session?.user.email ?? null,
      olderThanDays: input.olderThanDays,
      deleted,
    });
    return { deleted };
  }),
};
