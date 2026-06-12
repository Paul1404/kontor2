import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listTenants, resolveTenant } from "~/server/tenants/registry";

describe("tenant registry", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.DATABASE_URL = "postgres://primary/svu";
    delete process.env.PRIMARY_TENANT_KEY;
    delete process.env.TENANTS_JSON;
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("hat genau einen Mandanten (svu) aus DATABASE_URL als Default", () => {
    const t = listTenants();
    expect(t).toEqual([{ key: "svu", databaseUrl: "postgres://primary/svu" }]);
  });

  it("erlaubt einen abweichenden Primär-Schlüssel", () => {
    process.env.PRIMARY_TENANT_KEY = "haupt";
    expect(listTenants()[0]?.key).toBe("haupt");
  });

  it("nimmt weitere Mandanten aus TENANTS_JSON dazu", () => {
    process.env.TENANTS_JSON = JSON.stringify([
      { key: "verein_b", databaseUrl: "postgres://primary/verein_b" },
    ]);
    const keys = listTenants().map((t) => t.key);
    expect(keys).toEqual(["svu", "verein_b"]);
  });

  it("dedupliziert nach Schlüssel (Primär gewinnt)", () => {
    process.env.TENANTS_JSON = JSON.stringify([
      { key: "svu", databaseUrl: "postgres://other/svu" },
    ]);
    expect(listTenants()).toHaveLength(1);
    expect(listTenants()[0]?.databaseUrl).toBe("postgres://primary/svu");
  });

  it("wirft bei kaputtem TENANTS_JSON", () => {
    process.env.TENANTS_JSON = "{ kein json";
    expect(() => listTenants()).toThrow(/kein gültiges JSON/);
  });

  it("resolveTenant findet bzw. meldet unbekannt", () => {
    expect(resolveTenant("svu").databaseUrl).toBe("postgres://primary/svu");
    expect(() => resolveTenant("nope")).toThrow(/Unbekannter Mandant/);
  });
});
