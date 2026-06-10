import { createFileRoute } from "@tanstack/react-router";

// Server imports loaded lazily inside the handler (see `api/rpc.$.ts`): a
// static `import { auth }` / s3 import would pull the server graph into the
// client bundle and break hydration.
async function handle({ request, params }: { request: Request; params: { id: string } }) {
  const [{ auth }, { loadDownloadableAttachment }, { presignDownload }] = await Promise.all([
    import("~/server/auth/auth"),
    import("~/server/orpc/procedures/attachments"),
    import("~/server/s3/client"),
  ]);
  const session = await auth().api.getSession({ headers: request.headers });
  if (!session?.user) return new Response("Unauthorized", { status: 401 });
  const att = await loadDownloadableAttachment(params.id);
  if (!att) return new Response("Not found", { status: 404 });
  const url = await presignDownload({
    key: att.s3Key,
    filename: att.filename,
    expiresSeconds: 300,
  });
  return new Response(null, { status: 302, headers: { Location: url } });
}

export const Route = createFileRoute("/api/files/$id")({
  server: { handlers: { GET: handle } },
});
