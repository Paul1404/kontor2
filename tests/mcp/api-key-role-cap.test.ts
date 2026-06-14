import { describe, expect, it } from "vitest";
import { grantedRoleOf, lowerRole } from "~/server/mcp/auth";

/**
 * Issue #191: an MCP key's effective role is capped at min(grantedRole, live
 * role), so promoting the owner later cannot silently widen an issued key.
 */
describe("MCP api-key role cap", () => {
  it("caps a readonly-issued key to readonly even if the owner is promoted", () => {
    expect(lowerRole("readonly", "admin")).toBe("readonly");
    expect(lowerRole("readonly", "vorstand")).toBe("readonly");
  });

  it("caps at the live role when the owner is demoted below the grant", () => {
    expect(lowerRole("admin", "readonly")).toBe("readonly");
    expect(lowerRole("vorstand", "readonly")).toBe("readonly");
  });

  it("keeps the grant when it is the lower of the two", () => {
    expect(lowerRole("vorstand", "admin")).toBe("vorstand");
    expect(lowerRole("admin", "admin")).toBe("admin");
  });

  it("does not cap keys issued before grantedRole existed (falls back to live)", () => {
    expect(lowerRole(undefined, "admin")).toBe("admin");
    expect(lowerRole(undefined, "vorstand")).toBe("vorstand");
  });

  it("reads grantedRole from object or JSON-string metadata", () => {
    expect(grantedRoleOf({ grantedRole: "vorstand" })).toBe("vorstand");
    expect(grantedRoleOf('{"grantedRole":"admin"}')).toBe("admin");
  });

  it("returns undefined for missing or invalid metadata", () => {
    expect(grantedRoleOf(null)).toBeUndefined();
    expect(grantedRoleOf("not json")).toBeUndefined();
    expect(grantedRoleOf({ grantedRole: "bogus" })).toBeUndefined();
    expect(grantedRoleOf({})).toBeUndefined();
  });
});
