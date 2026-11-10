import { createFileRoute } from "@tanstack/react-router";
import { createServerOnlyFn } from "@tanstack/react-start";

/** Checks that the server can process an HTTP request without querying dependencies. */
export const handleLiveness = createServerOnlyFn(
  (): Response => Response.json({ ok: true }, { headers: { "cache-control": "no-store" } }),
);

export const Route = createFileRoute("/api/live")({
  server: { handlers: { GET: handleLiveness } },
});
