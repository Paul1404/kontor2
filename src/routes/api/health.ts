import { createFileRoute } from "@tanstack/react-router";
import { checkReadiness } from "~/server/health/readiness";

/** Railway readiness gate and public monitoring endpoint. */
export async function handleHealth(): Promise<Response> {
  const result = await checkReadiness();
  return Response.json(
    { ...result, time: new Date().toISOString() },
    { status: result.ok ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}

export const Route = createFileRoute("/api/health")({
  server: { handlers: { GET: handleHealth } },
});
