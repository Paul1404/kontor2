import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { handle } from "~/routes/api/mcp";
import { auth } from "~/server/auth/auth";
import { db } from "~/server/db/client";
import { apikeys, users } from "~/server/db/schema/auth";
import { enforceMcpRateLimit } from "~/server/mcp/rate-limit";

/**
 * Issue #77 / #82: a throttled but valid MCP key must get a 429 + Retry-After,
 * never a 401. 401 stays reserved for genuine auth failures. Needs the real
 * Redis (the limiter) and the test database (key verification).
 *
 * Runs only against the throwaway test database (bun run test:int).
 */
const onTestDb = process.env.DATABASE_URL?.includes("svuwv_test") ?? false;
const OWNER_ID = "integration-test-mcp-rl-owner";

function mcpRequest(apiKey: string | null): Request {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  if (apiKey) headers["x-api-key"] = apiKey;
  return new Request("http://localhost/api/mcp", {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
}

describe.skipIf(!onTestDb)("mcp rate limiting (integration)", () => {
  let plaintextKey = "";

  beforeAll(async () => {
    await db()
      .insert(users)
      .values({
        id: OWNER_ID,
        name: "MCP RL",
        email: "mcp-rl@test.local",
        emailVerified: true,
        role: "readonly",
      })
      .onConflictDoNothing();
    const created = await auth().api.createApiKey({
      body: { name: "rl-test", userId: OWNER_ID },
    });
    plaintextKey = created.key;
  });

  afterAll(async () => {
    await db().delete(apikeys).where(eq(apikeys.referenceId, OWNER_ID));
    await db().delete(users).where(eq(users.id, OWNER_ID));
  });

  it("allows up to the limit, then returns a Retry-After once exhausted", async () => {
    const key = `unit-${Date.now()}`;
    const opts = { limit: 3, windowSeconds: 60 };
    for (let i = 0; i < 3; i += 1) {
      const r = await enforceMcpRateLimit(key, opts);
      expect(r.allowed).toBe(true);
    }
    const blocked = await enforceMcpRateLimit(key, opts);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it("route returns 401 for a missing or invalid key (not 429)", async () => {
    const missing = await handle({ request: mcpRequest(null) });
    expect(missing.status).toBe(401);
    const invalid = await handle({ request: mcpRequest("svuwv_not-a-real-key") });
    expect(invalid.status).toBe(401);
  });

  it("route returns 429 + Retry-After for a valid but throttled key", async () => {
    // Burn the default per-key budget against the same hashed Redis key the
    // route uses, then the next request must be throttled rather than served.
    for (let i = 0; i < 120; i += 1) {
      await enforceMcpRateLimit(plaintextKey);
    }
    const res = await handle({ request: mcpRequest(plaintextKey) });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
  });
});
