import { and, eq } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import * as v from "valibot";
import { authedProc, vorstandProc } from "~/server/orpc/base";
import { attachmentsTable } from "~/server/db/schema/attachments";
import { membersTable } from "~/server/db/schema/members";
import { deleteObject, presignDownload, presignUpload } from "~/server/s3/client";
import { appendAudit } from "~/server/audit/log";

const ALLOWED_MIME = new Set(["application/pdf", "image/png", "image/jpeg"]);
const MAX_BYTES = 10 * 1024 * 1024;

function safeFilename(name: string): string {
  return name.replace(/[^\w.\-]+/g, "_").slice(0, 120);
}

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
      const id = crypto.randomUUID();
      const safe = safeFilename(input.filename);
      const key = `members/${input.memberId}/${id}/${safe}`;
      const url = await presignUpload({
        key,
        contentType: input.mimeType,
        contentLength: input.sizeBytes,
        expiresSeconds: 300,
      });
      return { uploadId: id, key, url };
    }),

  finalize: vorstandProc
    .input(
      v.object({
        uploadId: v.string(),
        memberId: v.string(),
        key: v.string(),
        filename: v.string(),
        mimeType: v.string(),
        sizeBytes: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(MAX_BYTES)),
      }),
    )
    .handler(async ({ context, input }) => {
      if (!ALLOWED_MIME.has(input.mimeType)) {
        throw new ORPCError("BAD_REQUEST", { message: "Dateityp nicht erlaubt." });
      }
      const [row] = await context.db
        .insert(attachmentsTable)
        .values({
          id: input.uploadId,
          memberId: input.memberId,
          filename: input.filename,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          s3Key: input.key,
          uploadedBy: context.session!.user.id,
        })
        .returning();
      await appendAudit(context.db, {
        entityType: "member_attachment",
        entityId: row!.id,
        action: "create",
        source: "ui",
        actorId: context.session!.user.id,
        actorEmail: context.session!.user.email,
        changes: {
          filename: { before: null, after: input.filename },
          mimeType: { before: null, after: input.mimeType },
          sizeBytes: { before: null, after: input.sizeBytes },
        },
      });
      return { id: row!.id };
    }),

  remove: vorstandProc
    .input(v.object({ id: v.string() }))
    .handler(async ({ context, input }) => {
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
