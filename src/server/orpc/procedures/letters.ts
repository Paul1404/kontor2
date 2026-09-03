import { ORPCError } from "@orpc/server";
import { and, desc, eq } from "drizzle-orm";
import * as v from "valibot";
import { memberNotDeleted } from "~/server/db/member-filters";
import { attachmentsTable } from "~/server/db/schema/attachments";
import { cancellationLettersTable } from "~/server/db/schema/cancellations";
import { emailLogTable } from "~/server/db/schema/email-log";
import { membersTable } from "~/server/db/schema/members";
import { memberRef } from "~/server/domain/member";
import { EMAIL_KIND } from "~/server/mail/email-log";
import { paragraphsFromText } from "~/server/mail/layout";
import { hasPostalAddress, notifyByPost, recipientLinesFor } from "~/server/mail/notify-by-post";
import { authedProc, vorstandProc } from "~/server/orpc/base";

const Subject = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(120));
const Body = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(20_000));

export const lettersRouter = {
  /**
   * Write one free-text letter to a member. The Serienbrief covers a whole
   * segment; this is the everyday case it never fitted, a single letter to a
   * single person, and it reuses the same DIN 5008 layout rather than leaving
   * the Vorstand to rebuild letterhead and address field in a word processor.
   *
   * Blank lines separate paragraphs, matching the Rundschreiben editor. The
   * text is placed as text, never interpreted as markup.
   */
  create: vorstandProc
    .input(
      v.object({
        memberId: v.pipe(v.string(), v.uuid()),
        subject: Subject,
        body: Body,
        /**
         * Documents to enclose. Named on the letter as an Anlagenvermerk; the
         * files themselves are printed separately and go in the same envelope.
         */
        enclosures: v.optional(
          v.array(
            v.object({
              source: v.picklist(["cancellation_letter", "attachment"]),
              id: v.pipe(v.string(), v.minLength(1)),
            }),
          ),
          [],
        ),
        /** Omit the sign-off when the text already carries one. */
        closing: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(60))), undefined),
        /** Salutation line; empty means the text starts on its own. */
        greeting: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(120))), null),
      }),
    )
    .handler(async ({ context, input }) => {
      const [member] = await context.db
        .select()
        .from(membersTable)
        .where(and(eq(membersTable.id, input.memberId), memberNotDeleted()))
        .limit(1);
      if (!member) throw new ORPCError("NOT_FOUND", { message: "Mitglied nicht gefunden." });
      if (!hasPostalAddress(member)) {
        throw new ORPCError("PRECONDITION_FAILED", {
          message:
            "Für dieses Mitglied ist keine vollständige Anschrift hinterlegt. Bitte zuerst Straße, PLZ und Ort ergänzen.",
        });
      }

      const blocks = paragraphsFromText(input.body);
      if (blocks.length === 0) {
        throw new ORPCError("VALIDATION_FAILED", { message: "Der Brieftext ist leer." });
      }

      // Resolve the enclosure names here rather than trusting labels from the
      // request, and refuse anything that belongs to a different member.
      const enclosures: { source: string; id: string; label: string }[] = [];
      for (const entry of input.enclosures) {
        if (entry.source === "cancellation_letter") {
          const [row] = await context.db
            .select({
              docRef: cancellationLettersTable.docRef,
              memberId: cancellationLettersTable.memberId,
              austrittDatum: cancellationLettersTable.austrittDatum,
            })
            .from(cancellationLettersTable)
            .where(eq(cancellationLettersTable.id, entry.id))
            .limit(1);
          if (!row || row.memberId !== member.id) {
            throw new ORPCError("NOT_FOUND", { message: "Anlage nicht gefunden." });
          }
          enclosures.push({
            ...entry,
            label: `Austrittsbestätigung ${row.docRef ?? ""}`.trim(),
          });
          continue;
        }
        const [row] = await context.db
          .select({ filename: attachmentsTable.filename, memberId: attachmentsTable.memberId })
          .from(attachmentsTable)
          .where(eq(attachmentsTable.id, entry.id))
          .limit(1);
        if (!row || row.memberId !== member.id) {
          throw new ORPCError("NOT_FOUND", { message: "Anlage nicht gefunden." });
        }
        enclosures.push({ ...entry, label: row.filename });
      }

      const letter = await notifyByPost(context.db, {
        kind: EMAIL_KIND.letter,
        recipient: {
          memberId: member.id,
          recipientLines: recipientLinesFor(member),
          reference: memberRef(member),
        },
        subject: input.subject,
        greeting: input.greeting || null,
        blocks,
        closing: input.closing,
        // The protocol stores what was written, so the letter stays readable
        // years later without keeping the PDF around.
        bodyText: [input.greeting, "", input.body].filter(Boolean).join("\n"),
        enclosures: enclosures.map((entry) => entry.label),
        actorEmail: context.session!.user.email,
        requestId: context.requestId ?? null,
      });
      return { ...letter, enclosures };
    }),

  /** Letters written to this member, newest first. */
  listForMember: authedProc
    .input(v.object({ memberId: v.pipe(v.string(), v.uuid()) }))
    .handler(async ({ context, input }) =>
      context.db
        .select({
          id: emailLogTable.id,
          subject: emailLogTable.subject,
          docRef: emailLogTable.detail,
          createdAt: emailLogTable.createdAt,
          actorEmail: emailLogTable.actorEmail,
        })
        .from(emailLogTable)
        .where(
          and(
            eq(emailLogTable.entityType, "member"),
            eq(emailLogTable.entityId, input.memberId),
            eq(emailLogTable.kind, EMAIL_KIND.letter),
          ),
        )
        .orderBy(desc(emailLogTable.createdAt))
        .limit(20),
    ),
};
