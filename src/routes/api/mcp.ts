import { createFileRoute } from "@tanstack/react-router";
import { resolveApiKeyContext } from "~/server/mcp/auth";
import { handleMcpRequest } from "~/server/mcp/server";
import { createContext } from "~/server/orpc/context";

/**
 * MCP endpoint (Model Context Protocol, Streamable HTTP) for AI assistants
 * like Claude Code and Claude Desktop. Auth is an admin-issued API key in the
 * `x-api-key` header (managed under Einstellungen -> KI-Zugriff); the key acts
 * with the role of the user it belongs to. Session cookies are deliberately
 * NOT accepted here, and API keys are not accepted anywhere else.
 *
 * Client setup:
 *   claude mcp add --transport http svuwv https://<host>/api/mcp \
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

async function handle({ request }: { request: Request }): Promise<Response> {
  const base = await createContext(request);
  const rawKey = request.headers.get("x-api-key");
  if (!rawKey) return unauthorized();
  const context = await resolveApiKeyContext(base, rawKey);
  if (!context) return unauthorized();
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
