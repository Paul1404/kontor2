import { createFileRoute } from "@tanstack/react-router";

/**
 * MCP endpoint (Model Context Protocol, Streamable HTTP) for AI assistants
 * like Claude Code and Claude Desktop. Auth is an admin-issued API key in the
 * `x-api-key` header (managed under Einstellungen -> KI-Zugriff); the key acts
 * with the role of the user it belongs to. Session cookies are deliberately
 * NOT accepted here, and API keys are not accepted anywhere else.
 *
 * Client setup:
 *   claude mcp add --transport http kontor2 https://<host>/api/mcp \
 *     --header "x-api-key: <KEY>"
 */
function unauthorized(): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Unauthorized: valid x-api-key header required" },
      id: null,
    }),
    {
      status: 401,
      headers: {
        "content-type": "application/json",
        "www-authenticate": 'ApiKey header="x-api-key"',
      },
    },
  );
}

/**
 * 429 for a throttled (but valid) key. A `Retry-After` header tells the client
 * how long to back off. Distinct from `unauthorized()` (401), which is reserved
 * for genuine auth failures so a client never confuses "slow down" with "your
 * key is invalid, re-authenticate".
 */
function rateLimited(retryAfterSeconds: number): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: {
        code: -32029,
        message: `Too many requests. Retry after ${retryAfterSeconds}s.`,
      },
      id: null,
    }),
    {
      status: 429,
      headers: {
        "content-type": "application/json",
        "retry-after": String(retryAfterSeconds),
      },
    },
  );
}

export async function handle({ request }: { request: Request }): Promise<Response> {
  // Server imports loaded lazily so the server graph stays out of the client
  // bundle (see api/rpc.$.ts).
  const [
    { resolveApiKeyContext },
    { enforceMcpRateLimit },
    { handleMcpRequest },
    { createContext },
  ] = await Promise.all([
    import("~/server/mcp/auth"),
    import("~/server/mcp/rate-limit"),
    import("~/server/mcp/server"),
    import("~/server/orpc/context"),
  ]);
  const base = await createContext(request);
  const rawKey = request.headers.get("x-api-key");
  if (!rawKey) return unauthorized();
  const context = await resolveApiKeyContext(base, rawKey);
  // null means a genuine auth failure (unknown/disabled/expired key or banned
  // owner) — never a rate limit, which is handled below with a 429.
  if (!context) return unauthorized();
  const limit = await enforceMcpRateLimit(rawKey);
  if (!limit.allowed) return rateLimited(limit.retryAfterSeconds);
  return handleMcpRequest(request, context);
}

export const Route = createFileRoute("/api/mcp")({
  server: {
    handlers: {
      GET: handle,
      POST: handle,
      DELETE: handle,
    },
  },
});
