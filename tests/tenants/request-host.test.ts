import { describe, expect, it } from "vitest";
import { requestHost } from "~/server/tenants/request-host";

describe("requestHost", () => {
  it("prefers Host over x-forwarded-host for tenant selection", () => {
    const headers = new Headers({
      host: "svu.kontor2.com",
      "x-forwarded-host": "admin.kontor2.com",
    });

    expect(requestHost(headers)).toBe("svu.kontor2.com");
  });

  it("falls back to the first forwarded host when Host is absent", () => {
    const headers = new Headers({
      "x-forwarded-host": "verein.kontor2.com, proxy.internal",
    });

    expect(requestHost(headers)).toBe("verein.kontor2.com");
  });
});
