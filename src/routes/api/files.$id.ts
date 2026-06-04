import { createFileRoute } from "@tanstack/react-router";
import { auth } from "~/server/auth/auth";
import { loadDownloadableAttachment } from "~/server/orpc/procedures/attachments";
import { presignDownload } from "~/server/s3/client";

async function handle({ request, params }: { request: Request; params: { id: string } }) {
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
