import { describe, expect, it } from "vitest";
import { contentDisposition } from "~/server/s3/client";

describe("contentDisposition", () => {
  it("keeps a plain ASCII filename in the quoted fallback", () => {
    const v = contentDisposition("Mahnung.pdf");
    expect(v).toBe("attachment; filename=\"Mahnung.pdf\"; filename*=UTF-8''Mahnung.pdf");
  });

  it("encodes non-ASCII names in filename* and degrades the ASCII fallback", () => {
    const v = contentDisposition("Grüße Müller.pdf");
    expect(v).toContain("filename*=UTF-8''");
    // The fallback must not contain raw non-ASCII bytes.
    expect(/filename="([ -~]*)"/.test(v)).toBe(true);
    expect(v).toContain(encodeURIComponent("Grüße Müller.pdf"));
  });

  it("strips quotes so the parameter cannot be escaped", () => {
    const v = contentDisposition('evil".pdf');
    const m = /filename="([^"]*)"/.exec(v);
    expect(m).not.toBeNull();
    expect(m?.[1]).not.toContain('"');
  });

  it("strips CR/LF so a filename cannot inject a new header", () => {
    const v = contentDisposition("a\r\nSet-Cookie: x=1.pdf");
    expect(v).not.toContain("\r");
    expect(v).not.toContain("\n");
  });

  it("strips path separators", () => {
    const v = contentDisposition("../../etc/passwd");
    const m = /filename="([^"]*)"/.exec(v);
    expect(m?.[1]).not.toContain("/");
    expect(m?.[1]).not.toContain("\\");
  });

  it("falls back to a default for an empty filename", () => {
    expect(contentDisposition("")).toContain('filename="download"');
  });

  it("collapses a separators-only name to a safe placeholder", () => {
    const v = contentDisposition("///");
    const m = /filename="([^"]*)"/.exec(v);
    expect(m?.[1]).toBe("_");
  });
});
