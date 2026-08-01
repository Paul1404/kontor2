import { createFileRoute } from "@tanstack/react-router";
import { createServerOnlyFn } from "@tanstack/react-start";

const MAX_BYTES = 10 * 1024 * 1024;

function response(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

// Same-origin upload bridge for authenticated member attachments. Server
// imports stay lazy so this API route cannot pull Node-only modules into the
// client route graph.
const handle = createServerOnlyFn(
  async ({ request, params }: { request: Request; params: { id: string } }) => {
    const [
      { auth },
      { dbForTenant },
      { pendingUploadsTable },
      { bankChangeEvidenceMime, isValidBankChangeEvidence },
      { putObject },
      { logger },
      { requestHost },
      { resolveTenantFromHost },
      { eq },
    ] = await Promise.all([
      import("~/server/auth/auth"),
      import("~/server/db/client"),
      import("~/server/db/schema/attachments"),
      import("~/server/domain/bank-change-evidence"),
      import("~/server/s3/client"),
      import("~/server/lib/logger"),
      import("~/server/tenants/request-host"),
      import("~/server/tenants/resolve"),
      import("drizzle-orm"),
    ]);
    const tenant = resolveTenantFromHost(requestHost(request.headers));
    const session = await auth(tenant).api.getSession({ headers: request.headers });
    if (!session?.user) return response("Anmeldung erforderlich.", 401);
    if (session.user.role !== "vorstand" && session.user.role !== "admin") {
      return response("Keine Berechtigung für diesen Upload.", 403);
    }

    const db = dbForTenant(tenant.databaseUrl);
    const [ticket] = await db
      .select()
      .from(pendingUploadsTable)
      .where(eq(pendingUploadsTable.id, params.id))
      .limit(1);
    if (!ticket || ticket.requestedBy !== session.user.id) {
      return response("Upload-Ticket nicht gefunden.", 404);
    }
    if (ticket.expiresAt < new Date()) return response("Upload-Ticket abgelaufen.", 410);

    const declaredLength = Number(request.headers.get("content-length") ?? "");
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BYTES) {
      return response("Datei zu groß.", 413);
    }
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > 0 &&
      declaredLength !== ticket.sizeBytes
    ) {
      return response("Dateigröße stimmt nicht mit dem Upload-Ticket überein.", 400);
    }
    const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim() ?? "";
    if (contentType !== ticket.mimeType) {
      return response("Dateityp stimmt nicht mit dem Upload-Ticket überein.", 415);
    }

    const bytes = Buffer.from(await request.arrayBuffer());
    if (bytes.byteLength > MAX_BYTES) return response("Datei zu groß.", 413);
    if (bytes.byteLength !== ticket.sizeBytes) {
      return response("Dateigröße stimmt nicht mit dem Upload-Ticket überein.", 400);
    }
    if (
      ticket.kind === "bank_details_change" &&
      (!bankChangeEvidenceMime(ticket.filename, contentType) ||
        !isValidBankChangeEvidence(bytes, contentType))
    ) {
      return response("Datei entspricht nicht dem ausgewählten Nachweistyp.", 400);
    }

    try {
      await putObject({ key: ticket.s3Key, body: bytes, contentType: ticket.mimeType });
    } catch (error) {
      logger.error("attachment.upload.failed", {
        tenant: tenant.key,
        requestId: request.headers.get("x-request-id") ?? null,
        uploadId: ticket.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return response("Nachweis konnte nicht gespeichert werden.", 502);
    }
    logger.info("attachment.upload.ok", {
      tenant: tenant.key,
      requestId: request.headers.get("x-request-id") ?? null,
      uploadId: ticket.id,
      kind: ticket.kind,
      sizeBytes: ticket.sizeBytes,
    });
    return new Response(null, { status: 204 });
  },
);

export const Route = createFileRoute("/api/attachments-upload/$id")({
  server: { handlers: { PUT: handle } },
});
