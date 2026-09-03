import { randomUUID } from "node:crypto";
import { ORPCError } from "@orpc/server";
import { and, desc, eq } from "drizzle-orm";
import * as v from "valibot";
import { normalizeTenantPolicy } from "~/lib/tenant-settings";
import { appendAudit } from "~/server/audit/log";
import { allocateDocRef } from "~/server/db/doc-ref";
import { memberNotDeleted } from "~/server/db/member-filters";
import { attachmentsTable, pendingUploadsTable } from "~/server/db/schema/attachments";
import { cancellationLettersTable } from "~/server/db/schema/cancellations";
import { memberCancellationsTable } from "~/server/db/schema/member-cancellations";
import { membersTable } from "~/server/db/schema/members";
import { organizationSettingsTable } from "~/server/db/schema/organization-settings";
import { executeAustritt } from "~/server/domain/austritt";
import { isValidEvidence } from "~/server/domain/document-evidence";
import { memberRef } from "~/server/domain/member";
import { computeCancellationDate } from "~/server/lib/cancellation-frist";
import { authedProc, vorstandProc } from "~/server/orpc/base";
import { buildCancellationModel } from "~/server/pdf/cancellation-model";
import { resolveClubLogo } from "~/server/pdf/logo";
import { renderPdfBase64 } from "~/server/pdf/renderer";
import { AustrittsbestaetigungDocument } from "~/server/pdf/templates/austrittsbestaetigung";
import {
  deleteObject,
  getObject,
  headObject,
  presignDownload,
  putObject,
} from "~/server/s3/client";
import { invalidateMemberCaches } from "~/server/search/cache";

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

const Day = v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/));

/** Human wording for the configured Austrittstermin rule. */
function describeDateMode(mode: "anytime" | "month_end" | "year_end"): string {
  if (mode === "year_end") return "Austritt nur zum Jahresende";
  if (mode === "month_end") return "Austritt nur zum Monatsende";
  return "Austritt zu jedem Datum";
}

export const cancellationsRouter = {
  /**
   * Derive the Austrittstermin from the day the written Austrittserklärung
   * arrived, plus the wording the dialog shows next to it. Server-side so the
   * displayed date can never drift from the rule `record` actually enforces.
   */
  previewDate: vorstandProc
    .input(v.object({ noticeReceivedOn: Day }))
    .handler(async ({ context, input }) => {
      const [settings] = await context.db.select().from(organizationSettingsTable).limit(1);
      const plan = computeCancellationDate(settings, input.noticeReceivedOn);
      const policy = normalizeTenantPolicy(settings?.tenantPolicy);
      return {
        ...plan,
        modeLabel: describeDateMode(plan.mode),
        statuteReference: policy.cancellationStatuteReference,
        outstandingClaimsStatuteReference: policy.outstandingClaimsStatuteReference,
        /** True when no rule is configured, so the date is a plain suggestion. */
        unconfigured: plan.mode === "anytime" && plan.noticeDays === 0,
      };
    }),

  /**
   * Record a written Kündigung: store the scan as evidence, derive the
   * Austrittstermin from the day it arrived, run the Austritt cascade and
   * leave an append-only receipt behind. Mirrors the bank-details change
   * workflow, because both turn a piece of paper into a data change that has
   * to stay provable years later.
   *
   * `overrideEffectiveDate` lets an operator deviate from the computed date
   * (Aufhebungsvereinbarung, Kulanz). It requires a reason and is recorded as
   * such, so a deviation is visible instead of silent.
   */
  record: vorstandProc
    .input(
      v.object({
        memberId: v.pipe(v.string(), v.uuid()),
        uploadId: v.pipe(v.string(), v.uuid()),
        noticeReceivedOn: Day,
        overrideEffectiveDate: v.optional(v.nullable(Day), null),
        overrideReason: v.optional(v.nullable(v.pipe(v.string(), v.maxLength(2_000))), null),
        revokeSepa: v.optional(v.boolean(), true),
        note: v.optional(v.nullable(v.pipe(v.string(), v.maxLength(2_000))), null),
        evidenceConfirmed: v.literal(true),
        expectedUpdatedAt: v.string(),
      }),
    )
    .handler(async ({ context, input }) => {
      const receivedAt = new Date(`${input.noticeReceivedOn}T12:00:00Z`);
      if (!Number.isFinite(receivedAt.getTime()) || receivedAt.getTime() > Date.now()) {
        throw new ORPCError("VALIDATION_FAILED", {
          message: "Das Eingangsdatum darf nicht in der Zukunft liegen.",
        });
      }

      const [settings] = await context.db.select().from(organizationSettingsTable).limit(1);
      const plan = computeCancellationDate(settings, input.noticeReceivedOn);
      const overridden =
        input.overrideEffectiveDate != null && input.overrideEffectiveDate !== plan.effectiveDate;
      const overrideReason = input.overrideReason?.trim() || null;
      if (overridden && !overrideReason) {
        throw new ORPCError("VALIDATION_FAILED", {
          message: "Für einen abweichenden Austrittstermin ist eine Begründung nötig.",
        });
      }
      const effectiveDate = overridden ? input.overrideEffectiveDate! : plan.effectiveDate;

      const [candidate] = await context.db
        .select()
        .from(pendingUploadsTable)
        .where(eq(pendingUploadsTable.id, input.uploadId))
        .limit(1);
      if (
        !candidate ||
        candidate.requestedBy !== context.session!.user.id ||
        candidate.memberId !== input.memberId ||
        candidate.kind !== "cancellation_notice" ||
        candidate.expiresAt < new Date()
      ) {
        throw new ORPCError("NOT_FOUND", {
          message: "Die Austrittserklärung ist nicht mehr verfügbar. Bitte erneut hochladen.",
        });
      }

      let metadata: Awaited<ReturnType<typeof headObject>>;
      let bytes: Buffer;
      try {
        [metadata, bytes] = await Promise.all([
          headObject(candidate.s3Key),
          getObject(candidate.s3Key),
        ]);
      } catch {
        throw new ORPCError("PRECONDITION_FAILED", {
          message: "Die Datei wurde nicht vollständig hochgeladen. Bitte erneut versuchen.",
        });
      }
      if (
        metadata.contentLength !== candidate.sizeBytes ||
        metadata.contentType !== candidate.mimeType ||
        bytes.byteLength !== candidate.sizeBytes ||
        !isValidEvidence(bytes, candidate.mimeType)
      ) {
        throw new ORPCError("VALIDATION_FAILED", {
          message: "Die Datei entspricht nicht dem ausgewählten Dateityp.",
        });
      }

      const policy = normalizeTenantPolicy(settings?.tenantPolicy);
      const note = input.note?.trim() || null;

      const result = await context.db.transaction(async (tx) => {
        const [ticket] = await tx
          .select()
          .from(pendingUploadsTable)
          .where(eq(pendingUploadsTable.id, input.uploadId))
          .limit(1)
          .for("update");
        if (
          !ticket ||
          ticket.requestedBy !== context.session!.user.id ||
          ticket.memberId !== input.memberId ||
          ticket.kind !== "cancellation_notice" ||
          ticket.expiresAt < new Date()
        ) {
          throw new ORPCError("CONFLICT", {
            message: "Die Austrittserklärung wurde bereits verwendet oder ist abgelaufen.",
          });
        }

        const [existing] = await tx
          .select({ id: membersTable.id, updatedAt: membersTable.updatedAt })
          .from(membersTable)
          .where(and(eq(membersTable.id, input.memberId), memberNotDeleted()))
          .limit(1)
          .for("update");
        if (!existing) {
          throw new ORPCError("NOT_FOUND", { message: "Mitglied nicht gefunden." });
        }
        const expectedMs = new Date(input.expectedUpdatedAt).getTime();
        if (!Number.isFinite(expectedMs) || existing.updatedAt.getTime() !== expectedMs) {
          throw new ORPCError("CONFLICT", {
            message:
              "Die Mitgliedsdaten wurden zwischenzeitlich geändert. Bitte laden Sie die Seite neu und prüfen Sie die Angaben erneut.",
          });
        }

        const [attachment] = await tx
          .insert(attachmentsTable)
          .values({
            id: ticket.id,
            memberId: ticket.memberId,
            kind: ticket.kind,
            filename: ticket.filename,
            mimeType: ticket.mimeType,
            sizeBytes: ticket.sizeBytes,
            s3Key: ticket.s3Key,
            uploadedBy: context.session!.user.id,
          })
          .returning();
        if (!attachment) {
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: "Austrittserklärung konnte nicht gespeichert werden.",
          });
        }

        const { member, counts, auditId } = await executeAustritt(tx, {
          memberId: input.memberId,
          austrittDatum: effectiveDate,
          reason: "austritt",
          revokeSepa: input.revokeSepa,
          // The Frist runs from the day the letter arrived, not from today.
          referenceDate: receivedAt,
          // A deviation is deliberate and justified; the receipt records it.
          skipFristCheck: overridden,
          actor: { id: context.session!.user.id, email: context.session!.user.email },
          requestId: context.requestId ?? null,
          snapshotNotes: "Kündigung erfasst",
          extraAuditChanges: {
            kuendigungNachweis: {
              before: null,
              after: {
                attachmentId: attachment.id,
                filename: attachment.filename,
                mimeType: attachment.mimeType,
                sizeBytes: attachment.sizeBytes,
              },
            },
            kuendigungEingang: { before: null, after: input.noticeReceivedOn },
            kuendigungBerechneterTermin: { before: null, after: plan.effectiveDate },
            ...(overridden
              ? { kuendigungAbweichung: { before: null, after: overrideReason } }
              : {}),
          },
        });

        await tx.insert(memberCancellationsTable).values({
          memberId: input.memberId,
          evidenceAttachmentId: attachment.id,
          noticeReceivedOn: input.noticeReceivedOn,
          effectiveDate,
          computedEffectiveDate: plan.effectiveDate,
          dateMode: plan.mode,
          noticeDays: plan.noticeDays,
          statuteReference: policy.cancellationStatuteReference,
          overridden,
          overrideReason: overridden ? overrideReason : null,
          sepaRevoked: input.revokeSepa,
          closedAbteilungen: counts.abteilungen,
          closedVertraege: counts.vertraege,
          revokedSepaMandate: counts.sepaMandate,
          note,
          recordedBy: context.session!.user.id,
          recordedByEmail: context.session!.user.email,
          auditId,
        });
        await tx.delete(pendingUploadsTable).where(eq(pendingUploadsTable.id, ticket.id));

        return { mitgliedsnummer: member.mitgliedsnummer, attachmentId: attachment.id, ...counts };
      });

      await invalidateMemberCaches(context.tenant.key);
      return { ok: true, effectiveDate, computedEffectiveDate: plan.effectiveDate, ...result };
    }),

  /** Recorded Kündigungen for a member, newest first. */
  recordedForMember: authedProc
    .input(v.object({ memberId: v.pipe(v.string(), v.uuid()) }))
    .handler(async ({ context, input }) =>
      context.db
        .select({
          id: memberCancellationsTable.id,
          noticeReceivedOn: memberCancellationsTable.noticeReceivedOn,
          effectiveDate: memberCancellationsTable.effectiveDate,
          computedEffectiveDate: memberCancellationsTable.computedEffectiveDate,
          dateMode: memberCancellationsTable.dateMode,
          noticeDays: memberCancellationsTable.noticeDays,
          statuteReference: memberCancellationsTable.statuteReference,
          overridden: memberCancellationsTable.overridden,
          overrideReason: memberCancellationsTable.overrideReason,
          sepaRevoked: memberCancellationsTable.sepaRevoked,
          note: memberCancellationsTable.note,
          recordedAt: memberCancellationsTable.recordedAt,
          recordedByEmail: memberCancellationsTable.recordedByEmail,
          revokedAt: memberCancellationsTable.revokedAt,
          evidenceAttachmentId: memberCancellationsTable.evidenceAttachmentId,
          evidenceFilename: attachmentsTable.filename,
        })
        .from(memberCancellationsTable)
        .innerJoin(
          attachmentsTable,
          eq(attachmentsTable.id, memberCancellationsTable.evidenceAttachmentId),
        )
        .where(eq(memberCancellationsTable.memberId, input.memberId))
        .orderBy(desc(memberCancellationsTable.recordedAt))
        .limit(10),
    ),

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

    const tenantPolicy = normalizeTenantPolicy(org.tenantPolicy);
    const model = buildCancellationModel({
      member: {
        anrede: member.anrede,
        vorname: member.vorname,
        nachname: member.nachname,
        strasse: member.strasse,
        plz: member.plz,
        ort: member.ort,
        geburtsdatum: member.geburtsdatum,
        mitgliedsnummer: memberRef(member),
        legacyMitgliedsnummer: member.mitgliedsnummer,
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
        logoDataUri: resolveClubLogo(org.logo),
        cancellationDateMode: tenantPolicy.cancellationDateMode,
        cancellationNoticeDays: org.kuendigungsfristAktiv ? org.kuendigungsfristTage : 0,
        cancellationStatuteReference: tenantPolicy.cancellationStatuteReference,
        outstandingClaimsStatuteReference: tenantPolicy.outstandingClaimsStatuteReference,
        privacyStatuteReference: tenantPolicy.privacyStatuteReference,
      },
    });

    const docRef = await allocateDocRef(context.db, "AU", new Date().getUTCFullYear());
    const { base64 } = await renderPdfBase64(AustrittsbestaetigungDocument({ model, docRef }));
    const pdf = Buffer.from(base64, "base64");

    const id = randomUUID();
    const idRef = memberRef(member);
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
