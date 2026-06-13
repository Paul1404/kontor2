import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "~/server/orpc/context";

const verifyApiKey = vi.fn();

vi.mock("~/server/auth/auth", () => ({
  auth: () => ({ api: { verifyApiKey } }),
}));

import { resolveApiKeyContext } from "~/server/mcp/auth";

/** Minimal db stub for `select().from().where().limit()`. */
function dbReturning(rows: unknown[]): AppContext["db"] {
  const chain = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    limit: async () => rows,
  };
  return chain as unknown as AppContext["db"];
}

function baseContext(rows: unknown[]): AppContext {
  return {
    db: dbReturning(rows),
    session: null,
    headers: new Headers(),
    tenant: { key: "svu", databaseUrl: "" },
    requestId: "test",
  };
}

const validKey = {
  id: "key-1",
  referenceId: "user-1",
  expiresAt: null,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
};

describe("resolveApiKeyContext", () => {
  beforeEach(() => {
    verifyApiKey.mockReset();
  });

  it("returns null for an invalid key", async () => {
    verifyApiKey.mockResolvedValue({ valid: false, error: null, key: null });
    const result = await resolveApiKeyContext(baseContext([]), "bogus");
    expect(result).toBeNull();
  });

  it("returns null when the key owner no longer exists", async () => {
    verifyApiKey.mockResolvedValue({ valid: true, error: null, key: validKey });
    const result = await resolveApiKeyContext(baseContext([]), "kontor2_x");
    expect(result).toBeNull();
  });

  it("returns null for a banned owner", async () => {
    verifyApiKey.mockResolvedValue({ valid: true, error: null, key: validKey });
    const user = { id: "user-1", email: "x@y.de", role: "vorstand", banned: true };
    const result = await resolveApiKeyContext(baseContext([user]), "kontor2_x");
    expect(result).toBeNull();
  });

  it("synthesizes a session carrying the owner's user row and the key id", async () => {
    verifyApiKey.mockResolvedValue({ valid: true, error: null, key: validKey });
    const user = { id: "user-1", email: "x@y.de", role: "vorstand", banned: false };
    const result = await resolveApiKeyContext(baseContext([user]), "kontor2_x");
    expect(result).not.toBeNull();
    expect(result?.session?.user).toMatchObject({ id: "user-1", role: "vorstand" });
    expect(result?.session?.session.id).toBe("apikey:key-1");
    expect(result?.session?.session.userAgent).toBe("mcp-api-key");
  });
});
