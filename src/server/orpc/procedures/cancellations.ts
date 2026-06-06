import { randomUUID } from "node:crypto";
import { ORPCError } from "@orpc/server";
import { desc, eq } from "drizzle-orm";
import * as v from "valibot";
import { appendAudit } from "~/server/audit/log";
import { allocateDocRef } from "~/server/db/doc-ref";
import { cancellationLettersTable } from "~/server/db/schema/cancellations";
import { membersTable } from "~/server/db/schema/members";
import { organizationSettingsTable } from "~/server/db/schema/organization-settings";
import { authedProc, vorstandProc } from "~/server/orpc/base";
import { buildCancellationModel } from "~/server/pdf/cancellation-model";
import { clubLogoDataUri } from "~/server/pdf/logo";
import { renderPdfBase64 } from "~/server/pdf/renderer";
import { AustrittsbestaetigungDocument } from "~/server/pdf/templates/austrittsbestaetigung";
import { deleteObject, presignDownload, putObject } from "~/server/s3/client";

const FamilyMember = v.object({
  vorname: v.pipe(v.string(), v.minLength(1)),
  nachname: v.pipe(v.string(), v.minLength(1)),
  geburtsdatum: v.optional(v.nullable(v.string()), null),
  mitgliedsnummer: v.optional(v.nullable(v.string()), null),
});

const GenerateInput = v.object({
  memberId: v.pipe(v.string(), v.minLength(1)),
  austrittDatum: v.pipe(v.string(), v.minLength(1)),
  abteilung: v.optional(v.nullable(v.string()), null),
  empfaengerAbweichend: v.optional(v.boolean(), false),
  empfaenger: v.optional(
    v.nullable(
      v.object({
        anrede: v.optional(v.nullable(v.string()), null),
        vorname: v.optional(v.nullable(v.string()), null),
        nachname: v.optional(v.nullable(v.string()), null),
        strasse: v.optional(v.nullable(v.string()), null),
        plz: v.optional(v.nullable(v.string()), null),
        ort: v.optional(v.nullable(v.string()), null),
      }),
    ),
    null,
  ),
  isFamily: v.optional(v.boolean(), false),
  familienmitglieder: v.optional(v.array(FamilyMember), []),
});

function safeFilenamePart(s: string): string {
  return s
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export const cancellationsRouter = {
  /**
   * Render an Austrittsbestätigung for a member, store the PDF in S3 and a
   * history row, and return the PDF inline (base64) for immediate download.
   * The member identity comes from the DB; only the recipient, family list,
   * Austrittstermin and department line are taken from the request.
   */
  generate: vorstandProc.input(GenerateInput).handler(async ({ context, input }) => {
    const [member] = await context.db
      .select()
      .from(membersTable)
      .where(eq(membersTable.id, input.memberId))
      .limit(1);
    if (!member) throw new ORPCError("NOT_FOUND", { message: "Mitglied nicht gefunden." });

    const [org] = await context.db.select().from(organizationSettingsTable).limit(1);
    if (!org) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Bitte zuerst die Vereinsdaten unter Einstellungen hinterlegen.",
      });
    }

    const model = buildCancellationModel({
      member: {
        anrede: member.anrede,
        vorname: member.vorname,
        nachname: member.nachname,
        strasse: member.strasse,
        plz: member.plz,
        ort: member.ort,
        geburtsdatum: member.geburtsdatum,
        mitgliedsnummer: member.mitgliedsnummer,
      },
      austrittDatum: input.austrittDatum,
      abteilung: input.abteilung,
      empfaengerAbweichend: input.empfaengerAbweichend,
      empfaenger: input.empfaenger,
      isFamily: input.isFamily,
      familienmitglieder: input.familienmitglieder,
      club: {
        vereinsname: org.vereinsname,
        ort: org.anschriftOrt ?? "",
        anschriftStrasse: org.anschriftStrasse,
        anschriftPlz: org.anschriftPlz,
        anschriftOrt: org.anschriftOrt,
        // Membership questions go to mitgliedschaft@ when configured, else the
        // general contact address.
        kontaktEmail: org.mitgliedschaftEmail ?? org.kontaktEmail,
        kontaktTelefon: org.kontaktTelefon,
        datenschutzUrl: org.datenschutzUrl,
        satzungUrl: org.satzungUrl,
        logoDataUri: clubLogoDataUri(),
      },
    });

    const docRef = await allocateDocRef(context.db, "AU", new Date().getUTCFullYear());
    const { base64 } = await renderPdfBase64(AustrittsbestaetigungDocument({ model, docRef }));
    const pdf = Buffer.from(base64, "base64");

    const id = randomUUID();
    const idRef = member.mitgliedsnummer ?? String(member.adrNr);
    const filename = `Austrittsbestaetigung-${docRef}-${safeFilenamePart(idRef)}.pdf`;
    const s3Key = `members/${member.id}/cancellations/${id}/${filename}`;

    await putObject({ key: s3Key, body: pdf, contentType: "application/pdf" });

    try {
      await context.db.transaction(async (tx) => {
        await tx.insert(cancellationLettersTable).values({
          id,
          docRef,
          memberId: member.id,
          displayName: model.displayName,
          austrittDatum: model.austrittDatum,
          mitgliedsnummer: model.combinedMitgliedsnummer || null,
          abteilung: model.abteilung || null,
          isFamily: model.isFamily,
          familienmitglieder: model.familienmitglieder,
          empfaengerAbweichend: model.istEmpfaengerAbweichend,
          s3Key,
          filename,
          createdBy: context.session!.user.id,
        });
        await appendAudit(tx, {
          entityType: "cancellation_letter",
          entityId: id,
          action: "create",
          source: "ui",
          actorId: context.session!.user.id,
          actorEmail: context.session!.user.email,
          changes: {
            docRef: { before: null, after: docRef },
            member: { before: null, after: model.displayName },
            austrittDatum: { before: null, after: model.austrittDatum },
            filename: { before: null, after: filename },
          },
          requestId: context.requestId ?? null,
        });
      });
    } catch (err) {
      // Roll back the orphaned S3 object so a failed insert leaves no litter.
      await deleteObject(s3Key).catch(() => {});
      throw err;
    }

    return { id, docRef, filename, base64 };
  }),

  /** List past Austrittsbestätigungen for a member, newest first. */
  listForMember: authedProc
    .input(v.object({ memberId: v.pipe(v.string(), v.minLength(1)) }))
    .handler(async ({ context, input }) => {
      const rows = await context.db
        .select({
          id: cancellationLettersTable.id,
          docRef: cancellationLettersTable.docRef,
          displayName: cancellationLettersTable.displayName,
          austrittDatum: cancellationLettersTable.austrittDatum,
          mitgliedsnummer: cancellationLettersTable.mitgliedsnummer,
          isFamily: cancellationLettersTable.isFamily,
          empfaengerAbweichend: cancellationLettersTable.empfaengerAbweichend,
          filename: cancellationLettersTable.filename,
          createdAt: cancellationLettersTable.createdAt,
        })
        .from(cancellationLettersTable)
        .where(eq(cancellationLettersTable.memberId, input.memberId))
        .orderBy(desc(cancellationLettersTable.createdAt));
      return rows;
    }),

  /** Presigned download URL for a stored letter. */
  download: authedProc
    .input(v.object({ id: v.pipe(v.string(), v.minLength(1)) }))
    .handler(async ({ context, input }) => {
      const [row] = await context.db
        .select({
          s3Key: cancellationLettersTable.s3Key,
          filename: cancellationLettersTable.filename,
        })
        .from(cancellationLettersTable)
        .where(eq(cancellationLettersTable.id, input.id))
        .limit(1);
      if (!row) throw new ORPCError("NOT_FOUND", { message: "Dokument nicht gefunden." });
      const url = await presignDownload({ key: row.s3Key, filename: row.filename });
      return { url };
    }),
};
