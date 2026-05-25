import { describe, expect, it } from "vitest";
import {
  buildPortalCookie,
  buildPortalUrl,
  clearPortalCookieHeader,
  getPortalCookieFromHeaders,
  portalCookieName,
  sha256,
} from "~/server/portal/auth";

describe("sha256", () => {
  it("is deterministic for the same input", () => {
    expect(sha256("hello")).toBe(sha256("hello"));
  });
  it("returns hex of length 64", () => {
    expect(sha256("x")).toMatch(/^[0-9a-f]{64}$/);
  });
  it("differs for different inputs", () => {
    expect(sha256("a")).not.toBe(sha256("b"));
  });
});

describe("buildPortalUrl", () => {
  it("trims trailing slashes", () => {
    expect(buildPortalUrl("https://app.example.com/", "tok")).toBe(
      "https://app.example.com/portal/zugang/tok",
    );
    expect(buildPortalUrl("https://app.example.com//", "tok")).toBe(
      "https://app.example.com/portal/zugang/tok",
    );
  });
});

describe("portal cookie helpers", () => {
  it("includes Secure only on https", () => {
    expect(buildPortalCookie("v", 60, false)).not.toContain("Secure");
    expect(buildPortalCookie("v", 60, true)).toContain("Secure");
  });

  it("always sets HttpOnly and SameSite", () => {
    const c = buildPortalCookie("v", 60, true);
    expect(c).toContain("HttpOnly");
    expect(c).toContain("SameSite=Lax");
    expect(c).toContain("Max-Age=60");
    expect(c).toContain(`${portalCookieName()}=v`);
  });

  it("clear sets Max-Age=0", () => {
    expect(clearPortalCookieHeader(false)).toContain("Max-Age=0");
  });

  it("parses cookie from header line", () => {
    const headers = new Headers({ cookie: "other=1; svuwv_portal=abc.def; foo=bar" });
    expect(getPortalCookieFromHeaders(headers)).toBe("abc.def");
  });

  it("returns null when cookie absent", () => {
    expect(getPortalCookieFromHeaders(new Headers())).toBeNull();
    expect(getPortalCookieFromHeaders(new Headers({ cookie: "foo=bar" }))).toBeNull();
  });
});
