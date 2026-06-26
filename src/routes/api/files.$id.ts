import { createFileRoute } from "@tanstack/react-router";
import { createServerOnlyFn } from "@tanstack/react-start";

// Server imports loaded lazily inside the handler (see `api/rpc.$.ts`): a
// static `import { auth }` / s3 import would pull the server graph into the
// client bundle and break hydration.
const handle = createServerOnlyFn(
  async ({ request, params }: { request: Request; params: { id: string } }) => {
    const [
      { auth },
      { resolveTenantFromHost },
      { dbForTenant },
      { loadDownloadableAttachment },
      { presignDownload },
    ] = await Promise.all([
      import("~/server/auth/auth"),
      import("~/server/tenants/resolve"),
      import("~/server/db/client"),
      import("~/server/orpc/procedures/attachments"),
      import("~/server/s3/client"),
    ]);
    const tenant = resolveTenantFromHost(
      request.headers.get("x-forwarded-host") ?? request.headers.get("host"),
    );
    const session = await auth(tenant).api.getSession({ headers: request.headers });
    if (!session?.user) return new Response("Unauthorized", { status: 401 });
    // Anhang aus der DB DIESES Vereins laden, nicht aus der Primär-DB.
    const att = await loadDownloadableAttachment(dbForTenant(tenant.databaseUrl), params.id);
    if (!att) return new Response("Not found", { status: 404 });
    const url = await presignDownload({
      key: att.s3Key,
      filename: att.filename,
      expiresSeconds: 300,
    });
    return new Response(null, { status: 302, headers: { Location: url } });
  },
);

export const Route = createFileRoute("/api/files/$id")({
  server: { handlers: { GET: handle } },
});
