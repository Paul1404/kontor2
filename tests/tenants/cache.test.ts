import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cachedDbTenants,
  findTenantByKey,
  invalidateTenantCache,
  listTenants,
  refreshTenantsFromDb,
  registerTenantLoader,
  resolveTenant,
  type Tenant,
} from "~/server/tenants/registry";

/**
 * Deckt die Control-Plane-Seite der Registry ab: der per DI eingehängte
 * Tabellen-Loader speist einen In-Memory-Cache, der vor `TENANTS_JSON` greift,
 * über TTL im Hintergrund nachlädt und sich explizit invalidieren lässt -- ohne
 * je eine echte DB-Verbindung (der Loader ist ein Fake).
 */
describe("tenant registry (control-plane cache)", () => {
  const saved = { ...process.env };

  beforeEach(() => {
    process.env.DATABASE_URL = "postgres://primary/svu";
    delete process.env.PRIMARY_TENANT_KEY;
    delete process.env.TENANTS_JSON;
    // Loader auf einen leeren Stand zurücksetzen, damit jeder Test sauber startet.
    registerTenantLoader(async () => []);
  });

  afterEach(async () => {
    await refreshTenantsFromDb();
    process.env = { ...saved };
    vi.useRealTimers();
  });

  it("speist Tabellen-Vereine in listTenants ein (nach Primär)", async () => {
    registerTenantLoader(async () => [
      { key: "verein2", databaseUrl: "postgres://primary/verein2" },
    ]);
    await refreshTenantsFromDb();
    expect(cachedDbTenants().map((t) => t.key)).toEqual(["verein2"]);
    expect(listTenants().map((t) => t.key)).toEqual(["svu", "verein2"]);
    expect(resolveTenant("verein2").databaseUrl).toBe("postgres://primary/verein2");
  });

  it("Tabellen-Quelle hat Vorrang vor TENANTS_JSON, der Primär vor allem", async () => {
    process.env.TENANTS_JSON = JSON.stringify([
      { key: "verein2", databaseUrl: "postgres://json/verein2" },
      { key: "svu", databaseUrl: "postgres://json/svu" },
      { key: "nuronjson", databaseUrl: "postgres://json/nuronjson" },
    ]);
    registerTenantLoader(async () => [{ key: "verein2", databaseUrl: "postgres://db/verein2" }]);
    await refreshTenantsFromDb();
    expect(resolveTenant("svu").databaseUrl).toBe("postgres://primary/svu"); // Primär gewinnt
    expect(resolveTenant("verein2").databaseUrl).toBe("postgres://db/verein2"); // DB vor JSON
    expect(resolveTenant("nuronjson").databaseUrl).toBe("postgres://json/nuronjson"); // JSON-Fallback bleibt
  });

  it("findTenantByKey löst Tabellen-Vereine auch bei kaputtem TENANTS_JSON auf", async () => {
    process.env.TENANTS_JSON = "{ kein json";
    registerTenantLoader(async () => [{ key: "verein2", databaseUrl: "postgres://db/verein2" }]);
    await refreshTenantsFromDb();
    expect(findTenantByKey("verein2")?.databaseUrl).toBe("postgres://db/verein2");
    // Unbekannter Schlüssel über das kaputte JSON: schluckt den Parse-Fehler -> undefined.
    expect(findTenantByKey("egal")).toBeUndefined();
  });

  it("ein scheiternder Loader behält den letzten Snapshot und wirft nicht", async () => {
    registerTenantLoader(async () => [{ key: "verein2", databaseUrl: "postgres://db/verein2" }]);
    await refreshTenantsFromDb();
    registerTenantLoader(async () => {
      throw new Error("DB weg");
    });
    await expect(refreshTenantsFromDb()).resolves.toBeUndefined();
    expect(cachedDbTenants().map((t) => t.key)).toEqual(["verein2"]); // alter Stand bleibt
  });

  it("lädt nach TTL-Ablauf im Hintergrund nach", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-13T00:00:00Z"));
    let calls = 0;
    const versions: Tenant[][] = [
      [{ key: "v1", databaseUrl: "postgres://db/v1" }],
      [{ key: "v2", databaseUrl: "postgres://db/v2" }],
    ];
    registerTenantLoader(async () => {
      const snap = versions[Math.min(calls, versions.length - 1)] ?? [];
      calls += 1;
      return snap;
    });
    await refreshTenantsFromDb(); // calls -> 1, Snapshot v1
    expect(calls).toBe(1);
    listTenants(); // frisch -> kein Reload
    expect(calls).toBe(1);
    vi.setSystemTime(new Date("2026-06-13T00:02:00Z")); // > 60s TTL
    listTenants(); // stößt Hintergrund-Reload an
    await vi.waitFor(() => expect(calls).toBe(2));
    expect(cachedDbTenants().map((t) => t.key)).toEqual(["v2"]);
  });

  it("invalidateTenantCache erzwingt ein sofortiges Neuladen", async () => {
    let calls = 0;
    registerTenantLoader(async () => {
      calls += 1;
      return [{ key: `gen${calls}`, databaseUrl: "postgres://db/x" }];
    });
    await refreshTenantsFromDb();
    expect(calls).toBe(1);
    invalidateTenantCache();
    await vi.waitFor(() => expect(calls).toBe(2));
  });
});
