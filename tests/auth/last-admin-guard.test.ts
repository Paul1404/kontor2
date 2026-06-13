import { describe, expect, it } from "vitest";
import { guardAdminPluginRequest } from "~/server/auth/last-admin-guard";
import type { DB } from "~/server/db/client";

// These cases all return before the db-dependent branch (wouldRemoveLastAdmin),
// so the handle is never touched. The db-branch is covered in the e2e suite.
const stubDb = {} as unknown as DB;

/**
 * Pure HTTP-shape tests: verify the guard only intervenes for the dangerous
 * admin-plugin endpoints and only when the body is shaped right. The DB-
 * dependent branch (`wouldRemoveLastAdmin`) is exercised in the e2e suite.
 */
describe("guardAdminPluginRequest", () => {
  function post(pathname: string, body?: unknown): Request {
    return new Request(`http://localhost${pathname}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body == null ? undefined : JSON.stringify(body),
    });
  }

  it("returns null for non-admin routes", async () => {
    const out = await guardAdminPluginRequest(stubDb, post("/api/auth/sign-in", { email: "x" }));
    expect(out).toBe(null);
  });

  it("returns null for GETs even on admin routes", async () => {
    const r = new Request("http://localhost/api/auth/admin/list-users");
    const out = await guardAdminPluginRequest(stubDb, r);
    expect(out).toBe(null);
  });

  it("returns null when set-user-banned has banned: false (unbanning is safe)", async () => {
    const out = await guardAdminPluginRequest(
      stubDb,
      post("/api/auth/admin/set-user-banned", { userId: "u1", banned: false }),
    );
    expect(out).toBe(null);
  });

  it("returns null when set-role promotes to admin", async () => {
    const out = await guardAdminPluginRequest(
      stubDb,
      post("/api/auth/admin/set-role", { userId: "u1", role: "admin" }),
    );
    expect(out).toBe(null);
  });

  it("returns null when body is missing userId", async () => {
    const out = await guardAdminPluginRequest(
      stubDb,
      post("/api/auth/admin/remove-user", { other: "x" }),
    );
    expect(out).toBe(null);
  });

  it("returns null when body is malformed JSON", async () => {
    const r = new Request("http://localhost/api/auth/admin/remove-user", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    const out = await guardAdminPluginRequest(stubDb, r);
    expect(out).toBe(null);
  });
});
