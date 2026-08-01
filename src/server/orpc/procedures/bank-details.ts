import { ORPCError } from "@orpc/server";
import { and, desc, eq, isNull } from "drizzle-orm";
import * as v from "valibot";
import { appendAudit, diff } from "~/server/audit/log";
import { lastFour } from "~/server/crypto/encrypt";
import { attachmentsTable, pendingUploadsTable } from "~/server/db/schema/attachments";
import { memberBankDetailChangesTable } from "~/server/db/schema/bank-detail-changes";
import { membersTable } from "~/server/db/schema/members";
import { isValidBankChangeEvidence } from "~/server/domain/bank-change-evidence";
import { vorstandProc } from "~/server/orpc/base";
import { getObject, headObject } from "~/server/s3/client";
import { invalidateMemberCaches } from "~/server/search/cache";
import { normalizeIban, validateIban } from "~/server/sepa/iban";
import { takeMemberSnapshot } from "~/server/snapshots/snapshot";
import { validateBic } from "~/server/validation/member-fields";

const Day = v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/));

function normalizeHolder(value: string | null): string | null {
  const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
  return normalized || null;
}

export const bankDetailsRouter = {
  applyChange: vorstandProc
    .input(
      v.object({
        memberId: v.pipe(v.string(), v.uuid()),
        uploadId: v.pipe(v.string(), v.uuid()),
        iban: v.string(),
        bic: v.optional(v.nullable(v.string()), null),
        accountHolder: v.optional(v.nullable(v.string()), null),
        requestedAt: Day,
        note: v.optional(v.nullable(v.pipe(v.string(), v.maxLength(2_000))), null),
        debitAction: v.picklist(["keep", "suspend"]),
        evidenceConfirmed: v.literal(true),
        expectedUpdatedAt: v.string(),
      }),
    )
    .handler(async ({ context, input }) => {
      const iban = normalizeIban(input.iban);
      if (!validateIban(iban)) {
        throw new ORPCError("VALIDATION_FAILED", {
          message: "IBAN ungültig (Prüfsumme fehlerhaft).",
        });
      }
      const bic = input.bic?.replace(/\s+/g, "").toUpperCase() || null;
      const bicResult = validateBic(bic);
      if (bicResult.level === "error") {
        throw new ORPCError("VALIDATION_FAILED", { message: bicResult.message });
      }
      const requestedAt = new Date(`${input.requestedAt}T12:00:00Z`);
      if (!Number.isFinite(requestedAt.getTime()) || requestedAt.getTime() > Date.now()) {
        throw new ORPCError("VALIDATION_FAILED", {
          message: "Das Eingangsdatum darf nicht in der Zukunft liegen.",
        });
      }

      const [candidate] = await context.db
        .select()
        .from(pendingUploadsTable)
        .where(eq(pendingUploadsTable.id, input.uploadId))
        .limit(1);
      if (
        !candidate ||
        candidate.requestedBy !== context.session!.user.id ||
        candidate.memberId !== input.memberId ||
        candidate.kind !== "bank_details_change" ||
        candidate.expiresAt < new Date()
      ) {
        throw new ORPCError("NOT_FOUND", {
          message: "Der Nachweis ist nicht mehr verfügbar. Bitte laden Sie ihn erneut hoch.",
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
          message: "Der Nachweis wurde nicht vollständig hochgeladen. Bitte erneut versuchen.",
        });
      }
      if (
        metadata.contentLength !== candidate.sizeBytes ||
        metadata.contentType !== candidate.mimeType ||
        bytes.byteLength !== candidate.sizeBytes ||
        !isValidBankChangeEvidence(bytes, candidate.mimeType)
      ) {
        throw new ORPCError("VALIDATION_FAILED", {
          message: "Die Datei entspricht nicht dem ausgewählten Nachweistyp.",
        });
      }

      const accountHolder = normalizeHolder(input.accountHolder);
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
          ticket.kind !== "bank_details_change" ||
          ticket.expiresAt < new Date()
        ) {
          throw new ORPCError("CONFLICT", {
            message: "Der Nachweis wurde bereits verwendet oder ist abgelaufen.",
          });
        }

        const [existing] = await tx
          .select()
          .from(membersTable)
          .where(and(eq(membersTable.id, input.memberId), isNull(membersTable.deletedAt)))
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
        if (normalizeIban(existing.iban1 ?? "") === iban) {
          throw new ORPCError("VALIDATION_FAILED", {
            message: "Die neue IBAN entspricht der bisherigen IBAN.",
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
            message: "Nachweis konnte nicht gespeichert werden.",
          });
        }

        const projected = {
          ...(existing as unknown as Record<string, unknown>),
          iban1: iban,
          iban1Last4: lastFour(iban),
          bic1: bic,
          abwKontoInh: accountHolder,
          directDebitBlocked: input.debitAction === "suspend",
        };
        await tx
          .update(membersTable)
          .set({
            iban1: iban,
            iban1Last4: lastFour(iban),
            bic1: bic,
            abwKontoInh: accountHolder,
            directDebitBlocked: input.debitAction === "suspend",
            updatedAt: new Date(),
          })
          .where(eq(membersTable.id, input.memberId));

        const changes = {
          ...diff(existing as unknown as Record<string, unknown>, projected),
          bankChangeEvidence: {
            before: null,
            after: {
              attachmentId: attachment.id,
              filename: attachment.filename,
              mimeType: attachment.mimeType,
              sizeBytes: attachment.sizeBytes,
            },
          },
          bankChangeRequestedAt: { before: null, after: input.requestedAt },
          bankChangeMandateReviewed: { before: null, after: true },
        };
        const auditId = await appendAudit(tx, {
          entityType: "member",
          entityId: input.memberId,
          action: "update",
          source: "ui",
          actorId: context.session!.user.id,
          actorEmail: context.session!.user.email,
          changes,
          requestId: context.requestId ?? null,
        });

        await tx.insert(memberBankDetailChangesTable).values({
          memberId: input.memberId,
          evidenceAttachmentId: attachment.id,
          requestedAt: input.requestedAt,
          appliedBy: context.session!.user.id,
          appliedByEmail: context.session!.user.email,
          auditId,
          previousIbanLast4: existing.iban1 ? lastFour(existing.iban1) : null,
          newIbanLast4: iban.slice(-4),
          accountHolderChanged: normalizeHolder(existing.abwKontoInh) !== accountHolder,
          debitSuspended: input.debitAction === "suspend",
          note,
        });
        await tx.delete(pendingUploadsTable).where(eq(pendingUploadsTable.id, ticket.id));
        await takeMemberSnapshot(tx, input.memberId, {
          trigger: "mutation",
          actorId: context.session!.user.id,
          actorEmail: context.session!.user.email,
          auditId,
          notes: "Bankverbindung geändert",
        });
        return { attachmentId: attachment.id };
      });

      await invalidateMemberCaches(context.tenant.key);
      return { ok: true, ...result };
    }),

  recentChanges: vorstandProc
    .input(v.object({ memberId: v.pipe(v.string(), v.uuid()) }))
    .handler(async ({ context, input }) =>
      context.db
        .select({
          id: memberBankDetailChangesTable.id,
          requestedAt: memberBankDetailChangesTable.requestedAt,
          appliedAt: memberBankDetailChangesTable.appliedAt,
          appliedByEmail: memberBankDetailChangesTable.appliedByEmail,
          previousIbanLast4: memberBankDetailChangesTable.previousIbanLast4,
          newIbanLast4: memberBankDetailChangesTable.newIbanLast4,
          debitSuspended: memberBankDetailChangesTable.debitSuspended,
          note: memberBankDetailChangesTable.note,
          evidenceAttachmentId: memberBankDetailChangesTable.evidenceAttachmentId,
          evidenceFilename: attachmentsTable.filename,
        })
        .from(memberBankDetailChangesTable)
        .innerJoin(
          attachmentsTable,
          eq(attachmentsTable.id, memberBankDetailChangesTable.evidenceAttachmentId),
        )
        .where(eq(memberBankDetailChangesTable.memberId, input.memberId))
        .orderBy(desc(memberBankDetailChangesTable.appliedAt))
        .limit(10),
    ),
};
