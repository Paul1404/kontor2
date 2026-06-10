import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { ORPCError } from "@orpc/server";
import * as v from "valibot";
import { CURRENT_VERSION } from "~/lib/release-notes";
import type { Role } from "~/server/db/schema/auth";
import { type McpTool, toolJsonSchema, toolsForRole } from "~/server/mcp/tools";
import type { AppContext } from "~/server/orpc/context";

type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

function errorResult(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

function summarizeIssues(issues: v.BaseIssue<unknown>[]): string {
  return issues
    .slice(0, 5)
    .map((issue) => {
      const path = issue.path?.map((p) => String(p.key)).join(".");
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join("; ");
}

/**
 * Build a stateless MCP server for one request. We use the SDK's low-level
 * `Server` (not `McpServer`) because its tools/list handler carries plain
 * JSON Schema: tool inputs are defined once in Valibot (this repo bans zod)
 * and converted via @valibot/to-json-schema, with the same schema doing the
 * runtime validation here.
 *
 * The tool list is filtered by the API key owner's role, so a readonly key
 * never even sees mutation tools. The underlying oRPC procedures enforce the
 * same roles again (`requireAuth`), so a forged tools/call still fails with
 * FORBIDDEN.
 */
export function buildMcpServer(context: AppContext, role: Role): Server {
  const tools = toolsForRole(role);
  const byName = new Map<string, McpTool>(tools.map((tool) => [tool.name, tool]));

  const server = new Server(
    { name: "svuwv-vereinsverwaltung", version: CURRENT_VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: toolJsonSchema(tool),
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<ToolResult> => {
    const tool = byName.get(request.params.name);
    if (!tool) {
      return errorResult(`Unknown tool: ${request.params.name}`);
    }
    const parsed = v.safeParse(tool.input, request.params.arguments ?? {});
    if (!parsed.success) {
      return errorResult(`INVALID_INPUT: ${summarizeIssues(parsed.issues)}`);
    }
    try {
      const result = await tool.execute(context, parsed.output);
      return { content: [{ type: "text", text: JSON.stringify(result ?? null, null, 2) }] };
    } catch (err) {
      // Expected, client-facing procedure errors become tool errors the model
      // can react to. Anything else bubbles up as a JSON-RPC internal error;
      // the oRPC observability middleware has already logged it.
      if (err instanceof ORPCError) {
        return errorResult(`${err.code}: ${err.message}`);
      }
      throw err;
    }
  });

  return server;
}

/**
 * Handle one HTTP request against a fresh server + transport pair (stateless
 * Streamable HTTP: no session ids, no SSE resumability, plain JSON
 * responses). Statelessness keeps the endpoint safe to run on multiple
 * Railway instances behind a load balancer.
 */
export async function handleMcpRequest(request: Request, context: AppContext): Promise<Response> {
  const role = (context.session?.user.role as Role | undefined) ?? "readonly";
  const server = buildMcpServer(context, role);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    // Best-effort cleanup; nothing is shared across requests either way.
    void server.close().catch(() => {});
  }
}
