import { describe, expect, it } from "vitest";
import { searchCacheKey } from "~/server/search/cache";

/**
 * Regression for the cross-tenant cache leak: the member-search cache key must
 * be namespaced by tenant, so two Vereine that issue the same query never share
 * a Redis key (and thus never see each other's members).
 */
describe("searchCacheKey tenant scoping", () => {
  const query = { q: "", status: "aktiv", page: 1, pageSize: 50 };

  it("produces different keys for different tenants with the same query", () => {
    expect(searchCacheKey("svu", query)).not.toBe(searchCacheKey("verein2", query));
  });

  it("is stable for the same tenant and query", () => {
    expect(searchCacheKey("svu", query)).toBe(searchCacheKey("svu", query));
  });

  it("includes the tenant key as a path segment", () => {
    expect(searchCacheKey("svu", query)).toContain(":svu:");
    expect(searchCacheKey("svu", query).startsWith("kontor2:t:svu:")).toBe(true);
  });

  it("separates tenants whose query differs only by the other tenant's data", () => {
    // Same input shape, different tenant -> never the same bucket.
    const a = searchCacheKey("a", { q: "Müller" });
    const b = searchCacheKey("b", { q: "Müller" });
    expect(a).not.toBe(b);
  });
});
