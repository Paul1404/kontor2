import { createFileRoute } from "@tanstack/react-router";

// Server imports loaded lazily inside the handler so the server graph never
// reaches the client bundle. See `api/rpc.$.ts`.
async function handle({ request, params }: { request: Request; params: { token: string } }) {
  const [{ dbForTenant }, { resolveTenantFromHost }, portalAuth, { rateLimit }] = await Promise.all(
    [
      import("~/server/db/client"),
      import("~/server/tenants/resolve"),
      import("~/server/portal/auth"),
      import("~/server/redis/client"),
    ],
  );
  const { buildPortalCookie, consumePortalToken, isSecureRequest } = portalAuth;
  // Magic-Link gegen die DB DIESES Vereins prüfen, nicht gegen die Primär-DB.
  const tenant = resolveTenantFromHost(
    request.headers.get("x-forwarded-host") ?? request.headers.get("host"),
  );
  const db = () => dbForTenant(tenant.databaseUrl);
  const ipAddress = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const userAgent = request.headers.get("user-agent");

  // The token is a 256-bit random value, so guessing is already infeasible,
  // but an unthrottled consume endpoint still lets an attacker fire unlimited
  // attempts. Cap per IP; a real member follows the link once. On exhaustion,
  // send them to the same "expired" page rather than leaking a 429 distinction.
  const limit = await rateLimit({
    key: `portal-zugang:${ipAddress ?? "unknown"}`,
    limit: 30,
    windowSeconds: 300,
  });
  if (!limit.allowed) {
    return new Response(null, { status: 302, headers: { Location: "/portal/abgelaufen" } });
  }

  const result = await consumePortalToken(db(), params.token, { ipAddress, userAgent });
  if (!result) {
    return new Response(null, {
      status: 302,
      headers: { Location: "/portal/abgelaufen" },
    });
  }
  const isSecure = isSecureRequest(request);
  const cookie = buildPortalCookie(result.cookieValue, result.cookieMaxAgeSeconds, isSecure);
  return new Response(null, {
    status: 302,
    headers: {
      Location: "/portal",
      "Set-Cookie": cookie,
    },
  });
}

export const Route = createFileRoute("/api/portal/zugang/$token")({
  server: { handlers: { GET: handle } },
});
