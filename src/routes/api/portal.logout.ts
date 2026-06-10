import { createFileRoute } from "@tanstack/react-router";

// Server imports (incl. drizzle-orm) loaded lazily inside the handler so the
// server graph never reaches the client bundle. See `api/rpc.$.ts`.
async function handle({ request }: { request: Request }) {
  const [{ eq }, { db }, { portalSessionsTable }, portalAuth] = await Promise.all([
    import("drizzle-orm"),
    import("~/server/db/client"),
    import("~/server/db/schema/portal"),
    import("~/server/portal/auth"),
  ]);
  const {
    clearPortalCookieHeader,
    getPortalCookieFromHeaders,
    isSecureRequest,
    resolvePortalSession,
  } = portalAuth;
  const cookieValue = getPortalCookieFromHeaders(request.headers);
  const session = await resolvePortalSession(db(), cookieValue);
  if (session) {
    await db()
      .update(portalSessionsTable)
      .set({ revokedAt: new Date() })
      .where(eq(portalSessionsTable.id, session.sessionId));
  }
  const isSecure = isSecureRequest(request);
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
