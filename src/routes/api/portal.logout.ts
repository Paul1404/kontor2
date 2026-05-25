import { createFileRoute } from "@tanstack/react-router";
import { eq } from "drizzle-orm";
import { db } from "~/server/db/client";
import { portalSessionsTable } from "~/server/db/schema/portal";
import {
  clearPortalCookieHeader,
  getPortalCookieFromHeaders,
  resolvePortalSession,
} from "~/server/portal/auth";

async function handle({ request }: { request: Request }) {
  const cookieValue = getPortalCookieFromHeaders(request.headers);
  const session = await resolvePortalSession(db(), cookieValue);
  if (session) {
    await db()
      .update(portalSessionsTable)
      .set({ revokedAt: new Date() })
      .where(eq(portalSessionsTable.id, session.sessionId));
  }
  const isSecure = new URL(request.url).protocol === "https:";
  return new Response(null, {
    status: 302,
    headers: {
      Location: "/portal/abgemeldet",
      "Set-Cookie": clearPortalCookieHeader(isSecure),
    },
  });
}

export const Route = createFileRoute("/api/portal/logout")({
  server: { handlers: { GET: handle, POST: handle } },
});
