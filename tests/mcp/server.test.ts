import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import type { Role } from "~/server/db/schema/auth";
import { buildMcpServer } from "~/server/mcp/server";
import { toolsForRole } from "~/server/mcp/tools";
import type { AppContext } from "~/server/orpc/context";

/**
 * Drives the per-request MCP server through the SDK's in-memory transport,
 * exactly as a remote client would over Streamable HTTP, but without the
 * route/auth layer. No database: the context is a stub, so only paths that
 * fail before touching the DB are exercised (tool listing, input validation,
 * the requireAuth rejection mapping).
 */
function stubContext(): AppContext {
  return {
    db: {} as AppContext["db"],
    // No session: any tools/call must be rejected by requireAuth with
    // UNAUTHORIZED before the handler touches the stub db.
    session: null,
    headers: new Headers(),
    requestId: "test",
  };
}

async function connectedClient(role: Role): Promise<Client> {
  const server = buildMcpServer(stubContext(), role);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

type ToolCallResult = { content: { type: string; text?: string }[]; isError?: boolean };

describe("mcp server", () => {
  it("lists only readonly tools for a readonly key", async () => {
    const client = await connectedClient("readonly");
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("member_stats");
    expect(names).not.toContain("update_member");
    expect(names).toHaveLength(toolsForRole("readonly").length);
  });

  it("lists mutation tools for a vorstand key with JSON Schema inputs", async () => {
    const client = await connectedClient("vorstand");
    const { tools } = await client.listTools();
    const update = tools.find((t) => t.name === "update_member");
    expect(update).toBeDefined();
    expect(update?.inputSchema.type).toBe("object");
  });

  it("rejects a call to an unlisted (higher-role) tool", async () => {
    const client = await connectedClient("readonly");
    const result = (await client.callTool({
      name: "update_member",
      arguments: { memberId: "x", patch: {} },
    })) as ToolCallResult;
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Unknown tool");
  });

  it("rejects invalid arguments with INVALID_INPUT before touching the procedure", async () => {
    const client = await connectedClient("readonly");
    const result = (await client.callTool({
      name: "report_birthdays",
      arguments: { month: 13 },
    })) as ToolCallResult;
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("INVALID_INPUT");
  });

  it("maps ORPCError rejections to isError tool results", async () => {
    // The stub context has no session, so requireAuth throws UNAUTHORIZED
    // inside the procedure chain; that must surface as a readable tool error,
    // not a JSON-RPC internal error.
    const client = await connectedClient("readonly");
    const result = (await client.callTool({
      name: "member_stats",
      arguments: {},
    })) as ToolCallResult;
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("UNAUTHORIZED");
  });
});
