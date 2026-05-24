import { and, eq, lt } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import * as v from "valibot";
import { authedProc, vorstandProc } from "~/server/orpc/base";
import { attachmentsTable, pendingUploadsTable } from "~/server/db/schema/attachments";
import { membersTable } from "~/server/db/schema/members";
import { deleteObject, presignDownload, presignUpload } from "~/server/s3/client";
import { appendAudit } from "~/server/audit/log";

const ALLOWED_MIME = new Set(["application/pdf", "image/png", "image/jpeg"]);
const MAX_BYTES = 10 * 1024 * 1024;

function safeFilename(name: string): string {
  return name.replace(/[^\w.\-]+/g, "_").slice(0, 120);
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
      }),
    )
    .handler(async ({ context, input }) => {
      if (!ALLOWED_MIME.has(input.mimeType)) {
        throw new ORPCError("BAD_REQUEST", { message: "Dateityp nicht erlaubt." });
      }
      const exists = await context.db
        .select({ id: membersTable.id })
        .from(membersTable)
        .where(eq(membersTable.id, input.memberId))
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
      // the ticket so finalize can verify the request matches what we
      // actually presigned. Without this, a malicious client could call
      // finalize with arbitrary memberId/key/sizeBytes.
      const [ticket] = await context.db
        .insert(pendingUploadsTable)
        .values({
          memberId: input.memberId,
          filename: safe,
          mimeType: input.mimeType,
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

      const url = await presignUpload({
        key,
        contentType: input.mimeType,
        contentLength: input.sizeBytes,
        expiresSeconds: 300,
      });
      return { uploadId: ticket.id, key, url };
    }),

  finalize: vorstandProc
    .input(v.object({ uploadId: v.string() }))
    .handler(async ({ context, input }) => {
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

        const [row] = await tx
          .insert(attachmentsTable)
          .values({
            id: ticket.id,
            memberId: ticket.memberId,
            filename: ticket.filename,
            mimeType: ticket.mimeType,
            sizeBytes: ticket.sizeBytes,
            s3Key: ticket.s3Key,
            uploadedBy: context.session!.user.id,
          })
          .returning();

        // Consume the ticket so it can't be replayed.
        await tx.delete(pendingUploadsTable).where(eq(pendingUploadsTable.id, ticket.id));

        await appendAudit(tx, {
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
        return { id: row!.id };
      });
    }),

  remove: vorstandProc.input(v.object({ id: v.string() })).handler(async ({ context, input }) => {
    const rows = await context.db
      .select()
      .from(attachmentsTable)
      .where(eq(attachmentsTable.id, input.id))
      .limit(1);
    const att = rows[0];
    if (!att) throw new ORPCError("NOT_FOUND", { message: "Anhang nicht gefunden." });
    await context.db.delete(attachmentsTable).where(eq(attachmentsTable.id, input.id));
    try {
      await deleteObject(att.s3Key);
    } catch {
      /* tolerate orphan in S3; record is gone */
    }
    await appendAudit(context.db, {
      entityType: "member_attachment",
      entityId: input.id,
      action: "delete",
      source: "ui",
      actorId: context.session!.user.id,
      actorEmail: context.session!.user.email,
      changes: { filename: { before: att.filename, after: null } },
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
      const rows = await context.db
        .select()
        .from(attachmentsTable)
        .where(eq(attachmentsTable.id, input.id))
        .limit(1);
      const att = rows[0];
      if (!att) throw new ORPCError("NOT_FOUND", { message: "Anhang nicht gefunden." });
      const url = await presignDownload({
        key: att.s3Key,
        filename: att.filename,
        expiresSeconds: 300,
      });
      return { url, filename: att.filename };
    }),
};
