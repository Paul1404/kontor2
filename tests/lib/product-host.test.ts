import { describe, expect, it } from "vitest";
import { isPublicProductHost, isPublicProductPath, normalizeProductHost } from "~/lib/product-host";

describe("product host", () => {
  it("normalisiert Hostnamen mit Port und Großschreibung", () => {
    expect(normalizeProductHost(" Kontor2.COM:443 ")).toBe("kontor2.com");
    expect(normalizeProductHost("[::1]:3000")).toBe("::1");
  });

  it("erkennt Apex und www als öffentliche Produktseite", () => {
    expect(isPublicProductHost("kontor2.com")).toBe(true);
    expect(isPublicProductHost("www.kontor2.com:443")).toBe(true);
  });

  it("hält Betreiber- und Vereins-Subdomains aus der Produktseite heraus", () => {
    expect(isPublicProductHost("admin.kontor2.com")).toBe(false);
    expect(isPublicProductHost("svu.kontor2.com")).toBe(false);
    expect(isPublicProductHost("kontor2.example")).toBe(false);
  });

  it("respektiert eine abweichende Produkt-Domain", () => {
    expect(isPublicProductHost("vereinsapp.example", "vereinsapp.example")).toBe(true);
    expect(isPublicProductHost("www.vereinsapp.example", "vereinsapp.example")).toBe(true);
    expect(isPublicProductHost("kontor2.com", "vereinsapp.example")).toBe(false);
  });
});

describe("isPublicProductPath", () => {
  it.each([
    "/",
    "/impressum",
    "/impressum/",
    "/datenschutz",
    "/robots.txt",
    "/sitemap.xml",
    "/api/health",
  ])("allows %s on the product host", (pathname) =>
    expect(isPublicProductPath(pathname)).toBe(true));

  it.each([
    "/app",
    "/login",
    "/console",
    "/antrag",
  ])("keeps %s away from the product host", (pathname) =>
    expect(isPublicProductPath(pathname)).toBe(false));
});
