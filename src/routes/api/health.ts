import { createFileRoute } from "@tanstack/react-router";
import { createServerOnlyFn } from "@tanstack/react-start";

/** Railway readiness gate and public monitoring endpoint. */
export const handleHealth = createServerOnlyFn(async (): Promise<Response> => {
  // API routes are part of the browser route tree. Keep database drivers and
  // the PDF renderer behind the server boundary, as in the other API routes.
  const { checkReadiness } = await import("~/server/health/readiness");
  const result = await checkReadiness();
  return Response.json(
    { ...result, time: new Date().toISOString() },
    { status: result.ok ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
});

export const Route = createFileRoute("/api/health")({
  server: { handlers: { GET: handleHealth } },
});
