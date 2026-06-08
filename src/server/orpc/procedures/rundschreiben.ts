import { ORPCError } from "@orpc/server";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import * as v from "valibot";
import { type MergeVars, renderTemplate, SAMPLE_VARS } from "~/lib/rundschreiben";
import { getMailer } from "~/server/auth/send-invite";
import type { DB } from "~/server/db/client";
import { memberNotDeleted } from "~/server/db/member-filters";
import { memberAbteilungenTable } from "~/server/db/schema/abteilungen";
import { membersTable } from "~/server/db/schema/members";
import { organizationSettingsTable } from "~/server/db/schema/organization-settings";
import { rundschreibenRecipientsTable, rundschreibenTable } from "~/server/db/schema/rundschreiben";
import { altMitgliedsnummer, memberDisplayName, memberRef } from "~/server/domain/member";
import { vorstandProc } from "~/server/orpc/base";
import { clubLogoDataUri } from "~/server/pdf/logo";
import { renderPdfBase64 } from "~/server/pdf/renderer";
import { SerienbriefDocument } from "~/server/pdf/templates/serienbrief";

/** Hard cap so a single send cannot fan out unbounded in one request. */
const MAX_RECIPIENTS = 2000;

const FilterInput = v.object({
  status: v.optional(v.picklist(["lebende", "aktiv", "passiv", "alle"]), "lebende"),
  abteilungId: v.optional(v.nullable(v.string()), null),
});

type Filter = v.InferOutput<typeof FilterInput>;

type RecipientRow = {
  id: string;
  anrede: string | null;
  vorname: string | null;
  nachname: string | null;
  kurzname: string | null;
  firma1: string | null;
  email: string | null;
  memberNo: string | null;
  kontaktNo: string | null;
  mitgliedsnummer: string | null;
  adrNr: number;
  strasse: string | null;
  hausnummer: string | null;
  plz: string | null;
  ort: string | null;
};

async function loadSegment(db: DB, filter: Filter): Promise<RecipientRow[]> {
  const conditions = [memberNotDeleted()];
  if (filter.status === "lebende") {
    conditions.push(inArray(membersTable.status, ["aktiv", "passiv"]));
  } else if (filter.status === "aktiv") {
    conditions.push(eq(membersTable.status, "aktiv"));
  } else if (filter.status === "passiv") {
    conditions.push(eq(membersTable.status, "passiv"));
  }
  if (filter.abteilungId) {
    conditions.push(
      sql`exists (select 1 from ${memberAbteilungenTable} ma
        where ma.member_id = ${membersTable.id}
          and ma.abteilung_id = ${filter.abteilungId}
          and ma.austrittsdatum is null)`,
    );
  }
  return (await db
    .select({
      id: membersTable.id,
      anrede: membersTable.anrede,
      vorname: membersTable.vorname,
      nachname: membersTable.nachname,
      kurzname: membersTable.kurzname,
      firma1: membersTable.firma1,
      email: membersTable.email,
      memberNo: membersTable.memberNo,
      kontaktNo: membersTable.kontaktNo,
      mitgliedsnummer: membersTable.mitgliedsnummer,
      adrNr: membersTable.adrNr,
      strasse: membersTable.strasse,
      hausnummer: membersTable.hausnummer,
      plz: membersTable.plz,
      ort: membersTable.ort,
    })
    .from(membersTable)
    .where(and(...conditions))
    .orderBy(membersTable.nachname, membersTable.vorname)) as RecipientRow[];
}

function hasEmail(r: RecipientRow): boolean {
  return !!(r.email?.trim() && r.email.includes("@"));
}

function varsFor(r: RecipientRow): MergeVars {
  return {
    anrede: r.anrede ?? "",
    vorname: r.vorname ?? "",
    nachname: r.nachname ?? "",
    name: memberDisplayName(r),
    mitgliedsnummer: memberRef(r),
  };
}

export const rundschreibenRouter = {
  /** Count of reachable (email) and postal-only recipients for a segment. */
  preview: vorstandProc
    .input(v.object({ filter: FilterInput }))
    .handler(async ({ context, input }) => {
      const rows = await loadSegment(context.db, input.filter);
      const withEmail = rows.filter(hasEmail);
      const withoutEmail = rows.filter((r) => !hasEmail(r));
      return {
        total: rows.length,
        withEmail: withEmail.length,
        withoutEmail: withoutEmail.length,
        sample: withEmail.slice(0, 6).map((r) => ({ name: memberDisplayName(r), email: r.email })),
      };
    }),

  /** Postal-only members (no usable email) with their address, for a Serienbrief. */
  postalList: vorstandProc
    .input(v.object({ filter: FilterInput }))
    .handler(async ({ context, input }) => {
      const rows = await loadSegment(context.db, input.filter);
      return rows
        .filter((r) => !hasEmail(r))
        .map((r) => ({
          reference: memberRef(r),
          name: memberDisplayName(r),
          anrede: r.anrede,
          strasse: [r.strasse, r.hausnummer].filter(Boolean).join(" "),
          plz: r.plz,
          ort: r.ort,
        }));
    }),

  /** Combined Serienbrief PDF: one DIN 5008 letter per postal-only member. */
  serienbrief: vorstandProc
    .input(
      v.object({
        subject: v.pipe(v.string(), v.minLength(1)),
        body: v.pipe(v.string(), v.minLength(1)),
        filter: FilterInput,
      }),
    )
    .handler(async ({ context, input }) => {
      const rows = (await loadSegment(context.db, input.filter)).filter((r) => !hasEmail(r));
      if (rows.length === 0) {
        throw new ORPCError("PRECONDITION_FAILED", {
          message: "Keine Mitglieder ohne E-Mail im gewählten Segment.",
        });
      }
      const [org] = await context.db.select().from(organizationSettingsTable).limit(1);
      const vereinsname = org?.vereinsname ?? "Verein";
      const senderLine = [
        vereinsname,
        org?.anschriftStrasse,
        [org?.anschriftPlz, org?.anschriftOrt].filter(Boolean).join(" "),
      ]
        .filter(Boolean)
        .join(" · ");
      const datum = new Date().toLocaleDateString("de-DE", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });

      const letters = rows.map((r) => {
        const vars = varsFor(r);
        const name = memberDisplayName(r);
        const recipientLines = [
          [r.anrede, name].filter(Boolean).join(" ").trim() || name,
          [r.strasse, r.hausnummer].filter(Boolean).join(" "),
          [r.plz, r.ort].filter(Boolean).join(" "),
        ].filter((l) => l.trim().length > 0);
        const reference = memberRef(r);
        return {
          recipientLines,
          reference,
          referenceLabel: r.memberNo ? "Mitgliedsnr." : "Kontaktnr.",
          legacyMitgliedsnummer: altMitgliedsnummer(r.mitgliedsnummer, reference),
          datum,
          subject: renderTemplate(input.subject, vars),
          paragraphs: renderTemplate(input.body, vars)
            .split(/\n\s*\n/)
            .map((p) => p.trim())
            .filter((p) => p.length > 0),
        };
      });

      const { base64 } = await renderPdfBase64(
        SerienbriefDocument({
          club: { vereinsname, senderLine, logoDataUri: clubLogoDataUri() },
          letters,
        }),
      );
      return {
        filename: `serienbrief-${new Date().toISOString().slice(0, 10)}-${letters.length}-schreiben.pdf`,
        base64,
        count: letters.length,
      };
    }),

  /** Send a test mail with sample merge values to the current user. */
  sendTest: vorstandProc
    .input(
      v.object({
        subject: v.pipe(v.string(), v.minLength(1)),
        body: v.pipe(v.string(), v.minLength(1)),
      }),
    )
    .handler(async ({ context, input }) => {
      const to = context.session!.user.email;
      const mailer = await getMailer();
      if (!mailer) {
        throw new ORPCError("PRECONDITION_FAILED", {
          message: "SMTP ist nicht konfiguriert. Bitte unter Einstellungen > SMTP einrichten.",
        });
      }
      const subject = `[Test] ${renderTemplate(input.subject, SAMPLE_VARS)}`;
      const text = renderTemplate(input.body, SAMPLE_VARS);
      try {
        await mailer.send({ to, subject, text });
      } catch (err) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: `Testmail fehlgeschlagen: ${(err as Error).message}`,
        });
      }
      return { ok: true, to };
    }),

  /** Send the Rundschreiben to every segment member with an email, logging each. */
  send: vorstandProc
    .input(
      v.object({
        subject: v.pipe(v.string(), v.minLength(1)),
        body: v.pipe(v.string(), v.minLength(1)),
        filter: FilterInput,
        // The recipient count the user saw in the confirm dialog. If the segment
        // drifted since, we refuse to send rather than blast a different group.
        expectedRecipients: v.optional(v.number()),
      }),
    )
    .handler(async ({ context, input }) => {
      const mailer = await getMailer();
      if (!mailer) {
        throw new ORPCError("PRECONDITION_FAILED", {
          message: "SMTP ist nicht konfiguriert. Bitte unter Einstellungen > SMTP einrichten.",
        });
      }
      const rows = (await loadSegment(context.db, input.filter)).filter(hasEmail);
      if (rows.length === 0) {
        throw new ORPCError("PRECONDITION_FAILED", {
          message: "Keine Empfänger mit E-Mail-Adresse im gewählten Segment.",
        });
      }
      if (input.expectedRecipients != null && input.expectedRecipients !== rows.length) {
        throw new ORPCError("CONFLICT", {
          message: `Die Empfängerzahl hat sich geändert (jetzt ${rows.length}). Bitte die Vorschau erneut prüfen.`,
        });
      }
      if (rows.length > MAX_RECIPIENTS) {
        throw new ORPCError("VALIDATION_FAILED", {
          message: `Zu viele Empfänger (${rows.length}). Bitte das Segment enger fassen (max. ${MAX_RECIPIENTS}).`,
        });
      }

      const [run] = await context.db
        .insert(rundschreibenTable)
        .values({
          subject: input.subject,
          body: input.body,
          filter: { ...input.filter, includeExited: input.filter.status === "alle" },
          recipientCount: rows.length,
          createdBy: context.session!.user.id,
          createdByEmail: context.session!.user.email,
        })
        .returning({ id: rundschreibenTable.id });
      if (!run) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Anlage fehlgeschlagen." });
      }

      // Sequential send: the SMTP server rate-limits us, and a small Verein's
      // segment is in the hundreds. Each outcome is logged individually so a
      // partial failure is visible and never silently swallowed.
      let sent = 0;
      let failed = 0;
      const recipientRows: (typeof rundschreibenRecipientsTable.$inferInsert)[] = [];
      for (const r of rows) {
        const vars = varsFor(r);
        const to = r.email!.trim();
        try {
          await mailer.send({
            to,
            subject: renderTemplate(input.subject, vars),
            text: renderTemplate(input.body, vars),
          });
          sent += 1;
          recipientRows.push({
            rundschreibenId: run.id,
            memberId: r.id,
            email: to,
            name: vars.name,
            status: "sent",
          });
        } catch (err) {
          failed += 1;
          recipientRows.push({
            rundschreibenId: run.id,
            memberId: r.id,
            email: to,
            name: vars.name,
            status: "failed",
            error: (err as Error).message.slice(0, 500),
          });
        }
      }

      // Chunk the recipient log insert to stay well under parameter limits.
      for (let i = 0; i < recipientRows.length; i += 200) {
        await context.db
          .insert(rundschreibenRecipientsTable)
          .values(recipientRows.slice(i, i + 200));
      }
      await context.db
        .update(rundschreibenTable)
        .set({ sentCount: sent, failedCount: failed })
        .where(eq(rundschreibenTable.id, run.id));

      return { id: run.id, total: rows.length, sent, failed };
    }),

  /** Past Rundschreiben, newest first. */
  list: vorstandProc.handler(async ({ context }) => {
    return await context.db
      .select({
        id: rundschreibenTable.id,
        subject: rundschreibenTable.subject,
        recipientCount: rundschreibenTable.recipientCount,
        sentCount: rundschreibenTable.sentCount,
        failedCount: rundschreibenTable.failedCount,
        createdByEmail: rundschreibenTable.createdByEmail,
        createdAt: rundschreibenTable.createdAt,
      })
      .from(rundschreibenTable)
      .orderBy(desc(rundschreibenTable.createdAt))
      .limit(50);
  }),

  /** One past Rundschreiben with its per-recipient log. */
  get: vorstandProc.input(v.object({ id: v.string() })).handler(async ({ context, input }) => {
    const [run] = await context.db
      .select()
      .from(rundschreibenTable)
      .where(eq(rundschreibenTable.id, input.id))
      .limit(1);
    if (!run) throw new ORPCError("NOT_FOUND", { message: "Rundschreiben nicht gefunden." });
    const recipients = await context.db
      .select({
        email: rundschreibenRecipientsTable.email,
        name: rundschreibenRecipientsTable.name,
        status: rundschreibenRecipientsTable.status,
        error: rundschreibenRecipientsTable.error,
      })
      .from(rundschreibenRecipientsTable)
      .where(eq(rundschreibenRecipientsTable.rundschreibenId, input.id))
      .orderBy(rundschreibenRecipientsTable.status, rundschreibenRecipientsTable.name);
    return { run, recipients };
  }),
};
