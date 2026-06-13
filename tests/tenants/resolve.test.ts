import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { consoleSubdomain, primaryTenant, resolveTenantFromHost } from "~/server/tenants/resolve";

describe("resolveTenantFromHost", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.DATABASE_URL = "postgres://primary/svu";
    process.env.BETTER_AUTH_URL = "https://svuwv.sv-untereuerheim.de";
    delete process.env.PRIMARY_TENANT_KEY;
    delete process.env.CONSOLE_SUBDOMAIN;
    delete process.env.CONTROL_DATABASE_URL;
    delete process.env.TENANTS_JSON;
    delete process.env.PRODUCT_DOMAIN;
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("Default-Verein-Subdomain und Auth-/Alt-Domain lösen auf den Default-Verein", () => {
    expect(resolveTenantFromHost("svu.kontor2.com").key).toBe("svu");
    expect(resolveTenantFromHost("svuwv.sv-untereuerheim.de").key).toBe("svu");
    // Kein Host (intern/Health): konservativ Default-Verein.
    expect(resolveTenantFromHost(null).key).toBe("svu");
    expect(resolveTenantFromHost(undefined).key).toBe("svu");
  });

  it("apex, www und unbekannte Subdomain -> Betreiber-Realm (NICHT der Default-Verein)", () => {
    expect(resolveTenantFromHost("kontor2.com").key).toBe(consoleSubdomain());
    expect(resolveTenantFromHost("www.kontor2.com").key).toBe(consoleSubdomain());
    expect(resolveTenantFromHost("nope.kontor2.com").key).toBe(consoleSubdomain());
    // fremder Host
    expect(resolveTenantFromHost("example.com").key).toBe(consoleSubdomain());
  });

  it("die Console-Subdomain löst auf den Operator-Realm auf", () => {
    expect(resolveTenantFromHost("admin.kontor2.com").key).toBe("admin");
  });

  it("löst eine bekannte Subdomain auf ihren Mandanten auf (port- und case-tolerant)", () => {
    process.env.TENANTS_JSON = JSON.stringify([
      { key: "verein_b", databaseUrl: "postgres://primary/verein_b" },
    ]);
    expect(resolveTenantFromHost("verein_b.kontor2.com").databaseUrl).toBe(
      "postgres://primary/verein_b",
    );
    expect(resolveTenantFromHost("Verein_b.kontor2.com:443").key).toBe("verein_b");
  });

  it("respektiert eine abweichende PRODUCT_DOMAIN zur Aufrufzeit", () => {
    process.env.PRODUCT_DOMAIN = "example.org";
    process.env.TENANTS_JSON = JSON.stringify([
      { key: "verein_b", databaseUrl: "postgres://primary/verein_b" },
    ]);
    expect(resolveTenantFromHost("verein_b.example.org").key).toBe("verein_b");
    // unter der alten Produkt-Domain nicht gematcht -> Betreiber-Realm
    expect(resolveTenantFromHost("verein_b.kontor2.com").key).toBe(consoleSubdomain());
  });

  it("primaryTenant ist der DATABASE_URL-Mandant", () => {
    expect(primaryTenant().key).toBe("svu");
  });

  it("kaputtes TENANTS_JSON wirft nicht; Default-Verein bleibt, Unbekanntes -> Operator", () => {
    process.env.TENANTS_JSON = "{ kein json";
    expect(primaryTenant().key).toBe("svu");
    // Default-Verein-Subdomain: Cold-Start-Anker, unabhängig vom JSON.
    expect(resolveTenantFromHost("svu.kontor2.com").key).toBe("svu");
    // fremde Subdomain müsste parsen -> Fehler geschluckt -> Betreiber-Realm.
    expect(resolveTenantFromHost("verein2.kontor2.com").key).toBe(consoleSubdomain());
  });
});
