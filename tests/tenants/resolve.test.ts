import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { primaryTenant, resolveTenantFromHost } from "~/server/tenants/resolve";

describe("resolveTenantFromHost", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.DATABASE_URL = "postgres://primary/svu";
    delete process.env.PRIMARY_TENANT_KEY;
    delete process.env.TENANTS_JSON;
    delete process.env.PRODUCT_DOMAIN;
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("faellt fuer Apex, www, alte Domain und null auf den primaeren Mandanten zurueck", () => {
    expect(resolveTenantFromHost("kontor2.com").key).toBe("svu");
    expect(resolveTenantFromHost("www.kontor2.com").key).toBe("svu");
    expect(resolveTenantFromHost("svuwv.sv-untereuerheim.de").key).toBe("svu");
    expect(resolveTenantFromHost(null).key).toBe("svu");
    expect(resolveTenantFromHost(undefined).key).toBe("svu");
  });

  it("die Primaer-Subdomain loest auf den Primaer-Mandanten auf", () => {
    expect(resolveTenantFromHost("svu.kontor2.com").key).toBe("svu");
  });

  it("loest eine bekannte Subdomain auf ihren Mandanten auf (port- und case-tolerant)", () => {
    process.env.TENANTS_JSON = JSON.stringify([
      { key: "verein_b", databaseUrl: "postgres://primary/verein_b" },
    ]);
    expect(resolveTenantFromHost("verein_b.kontor2.com").databaseUrl).toBe(
      "postgres://primary/verein_b",
    );
    expect(resolveTenantFromHost("Verein_b.kontor2.com:443").key).toBe("verein_b");
  });

  it("unbekannte Subdomain faellt auf den Primaer-Mandanten zurueck", () => {
    expect(resolveTenantFromHost("nope.kontor2.com").key).toBe("svu");
  });

  it("respektiert eine abweichende PRODUCT_DOMAIN zur Aufrufzeit", () => {
    process.env.PRODUCT_DOMAIN = "example.org";
    process.env.TENANTS_JSON = JSON.stringify([
      { key: "verein_b", databaseUrl: "postgres://primary/verein_b" },
    ]);
    expect(resolveTenantFromHost("verein_b.example.org").key).toBe("verein_b");
    // unter der alten Produkt-Domain nicht gematcht -> Primaer
    expect(resolveTenantFromHost("verein_b.kontor2.com").key).toBe("svu");
  });

  it("primaryTenant ist der DATABASE_URL-Mandant", () => {
    expect(primaryTenant().key).toBe("svu");
  });
});
