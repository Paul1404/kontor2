import { describe, expect, it } from "vitest";
import { tenantUrlFromName } from "~/server/tenants/url";

describe("tenantUrlFromName", () => {
  it("tauscht nur den DB-Namen, behält Host/Port/Credentials", () => {
    expect(tenantUrlFromName("postgres://u:p@host:5432/railway", "verein3")).toBe(
      "postgres://u:p@host:5432/verein3",
    );
  });

  it("behält Query-Parameter (z. B. sslmode)", () => {
    expect(tenantUrlFromName("postgres://u:p@host:5432/railway?sslmode=require", "verein3")).toBe(
      "postgres://u:p@host:5432/verein3?sslmode=require",
    );
  });
});
