import { createFileRoute } from "@tanstack/react-router";
import { createServerOnlyFn } from "@tanstack/react-start";

// Server imports (incl. drizzle-orm) loaded lazily inside the handler so the
// server graph never reaches the client bundle. See `api/rpc.$.ts`.
const handle = createServerOnlyFn(async ({ request }: { request: Request }) => {
  const [
    { eq },
    { dbForTenant },
    { requestHost },
    { resolveTenantFromHost },
    { portalSessionsTable },
    portalAuth,
  ] = await Promise.all([
    import("drizzle-orm"),
    import("~/server/db/client"),
    import("~/server/tenants/request-host"),
    import("~/server/tenants/resolve"),
    import("~/server/db/schema/portal"),
    import("~/server/portal/auth"),
  ]);
  const {
    clearPortalCookieHeader,
    getPortalCookieFromHeaders,
    isSecureRequest,
    resolvePortalSession,
  } = portalAuth;
  // Portal-Session in der DB DIESES Vereins, nicht in der Primär-DB.
  const tenant = resolveTenantFromHost(requestHost(request.headers));
  const db = () => dbForTenant(tenant.databaseUrl);
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
});

export const Route = createFileRoute("/api/portal/logout")({
  server: { handlers: { GET: handle, POST: handle } },
});
