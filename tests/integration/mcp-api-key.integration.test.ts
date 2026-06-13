import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auth } from "~/server/auth/auth";
import { db } from "~/server/db/client";
import { apikeys, users } from "~/server/db/schema/auth";
import { resolveApiKeyContext } from "~/server/mcp/auth";
import { handleMcpRequest } from "~/server/mcp/server";
import type { AppContext } from "~/server/orpc/context";

const OWNER_ID = "integration-test-mcp-owner";

/**
 * End-to-end coverage of the MCP auth chain against the real database:
 * better-auth issues a hashed key, `resolveApiKeyContext` verifies it and
 * synthesizes the owner's session, and a real `tools/call` round-trips
 * through the Streamable HTTP transport.
 *
 * Runs only against the throwaway test database (bun run test:int).
 */
const onTestDb = process.env.DATABASE_URL?.includes("svuwv_test") ?? false;

function baseContext(): AppContext {
  return {
    db: db(),
    session: null,
    headers: new Headers(),
    tenant: { key: "svu", databaseUrl: "" },
    requestId: "mcp-integration-test",
  };
}

function mcpRequest(body: unknown): Request {
  return new Request("http://localhost/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(body),
  });
}

describe.skipIf(!onTestDb)("mcp api key (integration)", () => {
  let plaintextKey = "";

  beforeAll(async () => {
    await db()
      .insert(users)
      .values({
        id: OWNER_ID,
        name: "MCP Integration",
        email: "mcp-integration@test.local",
        emailVerified: true,
        role: "vorstand",
      })
      .onConflictDoNothing();

    const created = await auth().api.createApiKey({
      body: { name: "integration", userId: OWNER_ID },
    });
    plaintextKey = created.key;
  });

  afterAll(async () => {
    // Cascade also removes the api key row, but be explicit for clarity.
    await db().delete(apikeys).where(eq(apikeys.referenceId, OWNER_ID));
    await db().delete(users).where(eq(users.id, OWNER_ID));
  });

  it("stores only a hash, never the plaintext key", async () => {
    const [row] = await db().select().from(apikeys).where(eq(apikeys.referenceId, OWNER_ID));
    expect(row).toBeDefined();
    expect(row?.key).not.toBe(plaintextKey);
    expect(row?.start).toBe(plaintextKey.slice(0, 6));
  });

  it("rejects an unknown key", async () => {
    const context = await resolveApiKeyContext(baseContext(), "svuwv_definitely-not-a-key");
    expect(context).toBeNull();
  });

  it("resolves a valid key to the owner's session and serves tools/call", async () => {
    const context = await resolveApiKeyContext(baseContext(), plaintextKey);
    expect(context).not.toBeNull();
    expect(context?.session?.user.id).toBe(OWNER_ID);
    expect(context?.session?.session.userAgent).toBe("mcp-api-key");

    const response = await handleMcpRequest(
      mcpRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "member_stats", arguments: {} },
      }),
      context as AppContext,
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      result?: { isError?: boolean; content?: { type: string; text: string }[] };
    };
    expect(payload.result?.isError).toBeFalsy();
    expect(payload.result?.content?.[0]?.type).toBe("text");
  });

  it("lists vorstand tools but no admin-only surface for a vorstand key", async () => {
    const context = await resolveApiKeyContext(baseContext(), plaintextKey);
    const response = await handleMcpRequest(
      mcpRequest({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
      context as AppContext,
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { result?: { tools: { name: string }[] } };
    const names = payload.result?.tools.map((t) => t.name) ?? [];
    expect(names).toContain("update_member");
    expect(names).toContain("member_stats");
    // merge_members is admin-only and must not surface for a vorstand key.
    expect(names).not.toContain("merge_members");
  });
});
