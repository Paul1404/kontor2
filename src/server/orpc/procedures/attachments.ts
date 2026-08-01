import { ORPCError } from "@orpc/server";
import { and, eq, isNull, lt } from "drizzle-orm";
import * as v from "valibot";
import { appendAudit } from "~/server/audit/log";
import type { DB } from "~/server/db/client";
import { memberNotDeleted } from "~/server/db/member-filters";
import { attachmentsTable, pendingUploadsTable } from "~/server/db/schema/attachments";
import { membersTable } from "~/server/db/schema/members";
import {
  BANK_CHANGE_MAX_BYTES,
  bankChangeEvidenceMime,
} from "~/server/domain/bank-change-evidence";
import { authedProc, vorstandProc } from "~/server/orpc/base";
import { headObject, presignDownload } from "~/server/s3/client";
import { takeMemberSnapshot } from "~/server/snapshots/snapshot";

/**
 * Resolve an attachment for download, but only if its parent member is still
 * live. An attachment of a soft-deleted or DSGVO-erased member must never be
 * presignable, even with a valid id. Shared by the oRPC procedure and the
 * /api/files/:id redirect route so both enforce the same rule. Returns null
 * when the attachment is missing or its member is gone.
 */
export async function loadDownloadableAttachment(
  db: DB,
  id: string,
): Promise<{ s3Key: string; filename: string; kind: "general" | "bank_details_change" } | null> {
  const [row] = await db
    .select({
      s3Key: attachmentsTable.s3Key,
      filename: attachmentsTable.filename,
      kind: attachmentsTable.kind,
    })
    .from(attachmentsTable)
    .innerJoin(membersTable, eq(membersTable.id, attachmentsTable.memberId))
    .where(and(eq(attachmentsTable.id, id), isNull(attachmentsTable.deletedAt), memberNotDeleted()))
    .limit(1);
  return row ?? null;
}

const ALLOWED_MIME = new Set(["application/pdf", "image/png", "image/jpeg"]);
const MAX_BYTES = 10 * 1024 * 1024;

function safeFilename(name: string): string {
  return name.replace(/[^\w.-]+/g, "_").slice(0, 120);
}

const UPLOAD_TTL_SECONDS = 600;

export const attachmentsRouter = {
  requestUploadUrl: vorstandProc
    .input(
      v.object({
        memberId: v.string(),
        filename: v.pipe(v.string(), v.minLength(1)),
        mimeType: v.string(),
        sizeBytes: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(MAX_BYTES)),
        kind: v.optional(v.picklist(["general", "bank_details_change"]), "general"),
      }),
    )
    .handler(async ({ context, input }) => {
      const canonicalMime =
        input.kind === "bank_details_change"
          ? bankChangeEvidenceMime(input.filename, input.mimeType)
          : ALLOWED_MIME.has(input.mimeType)
            ? input.mimeType
            : null;
      if (!canonicalMime) {
        throw new ORPCError("BAD_REQUEST", { message: "Dateityp nicht erlaubt." });
      }
      if (input.kind === "bank_details_change" && input.sizeBytes > BANK_CHANGE_MAX_BYTES) {
        throw new ORPCError("BAD_REQUEST", { message: "Datei zu groß (max. 10 MB)." });
      }
      const exists = await context.db
        .select({ id: membersTable.id })
        .from(membersTable)
        .where(and(eq(membersTable.id, input.memberId), memberNotDeleted()))
        .limit(1);
      if (exists.length === 0) {
        throw new ORPCError("NOT_FOUND", { message: "Mitglied nicht gefunden." });
      }

      // Garbage-collect any of this user's expired tickets so the table
      // stays bounded. Cheap and safe — no FK targets these rows.
      await context.db
        .delete(pendingUploadsTable)
        .where(
          and(
            eq(pendingUploadsTable.requestedBy, context.session!.user.id),
            lt(pendingUploadsTable.expiresAt, new Date()),
          ),
        );

      const safe = safeFilename(input.filename);
      // Generate a server-side UUID and corresponding key, then persist
      // the ticket so the same-origin upload route and finalize can verify
      // the request. Without this, a malicious client could call
      // finalize with arbitrary memberId/key/sizeBytes.
      const [ticket] = await context.db
        .insert(pendingUploadsTable)
        .values({
          memberId: input.memberId,
          kind: input.kind,
          filename: safe,
          mimeType: canonicalMime,
          sizeBytes: input.sizeBytes,
          // s3Key is set immediately below; we need the row's id first.
          s3Key: "pending",
          requestedBy: context.session!.user.id,
          expiresAt: new Date(Date.now() + UPLOAD_TTL_SECONDS * 1000),
        })
        .returning({ id: pendingUploadsTable.id });
      if (!ticket) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "Upload-Ticket konnte nicht angelegt werden.",
        });
      }
      const key = `members/${input.memberId}/${ticket.id}/${safe}`;
      await context.db
        .update(pendingUploadsTable)
        .set({ s3Key: key })
        .where(eq(pendingUploadsTable.id, ticket.id));

      // Keep browser uploads on the Vereins domain. Railway's bucket endpoint
      // does not expose browser CORS for direct presigned PUTs, which otherwise
      // surfaces as the unhelpful browser error "Load failed" before finalize.
      const url = `/api/attachments-upload/${ticket.id}`;
      return { uploadId: ticket.id, key, url, mimeType: canonicalMime };
    }),

  finalize: vorstandProc
    .input(v.object({ uploadId: v.string() }))
    .handler(async ({ context, input }) => {
      const [candidate] = await context.db
        .select()
        .from(pendingUploadsTable)
        .where(eq(pendingUploadsTable.id, input.uploadId))
        .limit(1);
      if (!candidate || candidate.requestedBy !== context.session!.user.id) {
        throw new ORPCError("NOT_FOUND", { message: "Upload-Ticket nicht gefunden." });
      }
      if (candidate.kind !== "general") {
        throw new ORPCError("BAD_REQUEST", {
          message: "Dieser Nachweis muss zusammen mit der Bankänderung gespeichert werden.",
        });
      }
      let metadata: Awaited<ReturnType<typeof headObject>>;
      try {
        metadata = await headObject(candidate.s3Key);
      } catch {
        throw new ORPCError("PRECONDITION_FAILED", {
          message: "Die Datei wurde noch nicht vollständig hochgeladen. Bitte erneut versuchen.",
        });
      }
      if (
        metadata.contentLength !== candidate.sizeBytes ||
        metadata.contentType !== candidate.mimeType
      ) {
        throw new ORPCError("VALIDATION_FAILED", {
          message: "Die hochgeladene Datei stimmt nicht mit dem Upload-Ticket überein.",
        });
      }
      // Look up the ticket we issued at presign time and trust ONLY its
      // server-stored fields. The client previously controlled all of
      // memberId, key, mimeType, sizeBytes — those are now ignored.
      return await context.db.transaction(async (tx) => {
        const [ticket] = await tx
          .select()
          .from(pendingUploadsTable)
          .where(eq(pendingUploadsTable.id, input.uploadId))
          .limit(1);
        if (!ticket) {
          throw new ORPCError("NOT_FOUND", { message: "Upload-Ticket nicht gefunden." });
        }
        if (ticket.requestedBy !== context.session!.user.id) {
          throw new ORPCError("FORBIDDEN", {
            message: "Upload-Ticket gehört einem anderen Benutzer.",
          });
        }
        if (ticket.expiresAt < new Date()) {
          throw new ORPCError("BAD_REQUEST", { message: "Upload-Ticket abgelaufen." });
        }
        const [liveMember] = await tx
          .select({ id: membersTable.id })
          .from(membersTable)
          .where(and(eq(membersTable.id, ticket.memberId), memberNotDeleted()))
          .limit(1);
        if (!liveMember) {
          throw new ORPCError("NOT_FOUND", { message: "Mitglied nicht gefunden." });
        }

        const [row] = await tx
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

        // Consume the ticket so it can't be replayed.
        await tx.delete(pendingUploadsTable).where(eq(pendingUploadsTable.id, ticket.id));

        const auditId = await appendAudit(tx, {
          entityType: "member_attachment",
          entityId: row!.id,
          action: "create",
          source: "ui",
          actorId: context.session!.user.id,
          actorEmail: context.session!.user.email,
          changes: {
            filename: { before: null, after: ticket.filename },
            mimeType: { before: null, after: ticket.mimeType },
            sizeBytes: { before: null, after: ticket.sizeBytes },
          },
          requestId: context.requestId ?? null,
        });
        await takeMemberSnapshot(tx, ticket.memberId, {
          trigger: "mutation",
          actorId: context.session!.user.id,
          actorEmail: context.session!.user.email,
          auditId,
        });
        return { id: row!.id };
      });
    }),

  remove: vorstandProc.input(v.object({ id: v.string() })).handler(async ({ context, input }) => {
    const rows = await context.db
      .select()
      .from(attachmentsTable)
      .where(and(eq(attachmentsTable.id, input.id), isNull(attachmentsTable.deletedAt)))
      .limit(1);
    const att = rows[0];
    if (!att) throw new ORPCError("NOT_FOUND", { message: "Anhang nicht gefunden." });
    if (att.kind === "bank_details_change") {
      throw new ORPCError("FORBIDDEN", {
        message: "Der Nachweis einer Bankänderung kann nicht als normaler Anhang gelöscht werden.",
      });
    }

    // Soft-delete the row and retain the object. A later snapshot restore can
    // make the attachment visible again without pointing at a missing S3 key.
    await context.db.transaction(async (tx) => {
      await tx
        .update(attachmentsTable)
        .set({ deletedAt: new Date() })
        .where(eq(attachmentsTable.id, input.id));
      const auditId = await appendAudit(tx, {
        entityType: "member_attachment",
        entityId: input.id,
        action: "delete",
        source: "ui",
        actorId: context.session!.user.id,
        actorEmail: context.session!.user.email,
        changes: { filename: { before: att.filename, after: null } },
        requestId: context.requestId ?? null,
      });
      await takeMemberSnapshot(tx, att.memberId, {
        trigger: "mutation",
        actorId: context.session!.user.id,
        actorEmail: context.session!.user.email,
        auditId,
      });
    });
    return { ok: true };
  }),

  /**
   * Internal helper used by the /api/files/:id redirect route. Not normally
   * called directly by the browser, but exposed via oRPC for parity.
   */
  getSignedDownloadUrl: authedProc
    .input(v.object({ id: v.string() }))
    .handler(async ({ context, input }) => {
      const att = await loadDownloadableAttachment(context.db, input.id);
      if (!att) throw new ORPCError("NOT_FOUND", { message: "Anhang nicht gefunden." });
      if (att.kind === "bank_details_change" && context.role === "readonly") {
        throw new ORPCError("FORBIDDEN", { message: "Keine Berechtigung für diesen Nachweis." });
      }
      const url = await presignDownload({
        key: att.s3Key,
        filename: att.filename,
        expiresSeconds: 300,
      });
      return { url, filename: att.filename };
    }),
};
