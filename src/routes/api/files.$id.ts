import { createFileRoute } from "@tanstack/react-router";
import { eq } from "drizzle-orm";
import { auth } from "~/server/auth/auth";
import { db } from "~/server/db/client";
import { attachmentsTable } from "~/server/db/schema/attachments";
import { presignDownload } from "~/server/s3/client";

async function handle({ request, params }: { request: Request; params: { id: string } }) {
  const session = await auth().api.getSession({ headers: request.headers });
  if (!session?.user) return new Response("Unauthorized", { status: 401 });
  const rows = await db()
    .select()
    .from(attachmentsTable)
    .where(eq(attachmentsTable.id, params.id))
    .limit(1);
  const att = rows[0];
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
