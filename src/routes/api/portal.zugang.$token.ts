import { createFileRoute } from "@tanstack/react-router";
import { db } from "~/server/db/client";
import { buildPortalCookie, consumePortalToken, isSecureRequest } from "~/server/portal/auth";

async function handle({ request, params }: { request: Request; params: { token: string } }) {
  const ipAddress = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const userAgent = request.headers.get("user-agent");
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
