import { describe, expect, it } from "vitest";
import { evidenceMimeFor, isValidEvidence } from "~/server/domain/document-evidence";

describe("bank change evidence", () => {
  it("canonicalizes email formats even when the browser reports no useful MIME", () => {
    expect(evidenceMimeFor("Aenderung.eml", "")).toBe("message/rfc822");
    expect(evidenceMimeFor("outlook.msg", "application/octet-stream")).toBe(
      "application/vnd.ms-outlook",
    );
    expect(evidenceMimeFor("scan.exe", "application/pdf")).toBeNull();
  });

  it("checks PDF and MSG signatures", () => {
    expect(isValidEvidence(new TextEncoder().encode("%PDF-1.7"), "application/pdf")).toBe(true);
    expect(
      isValidEvidence(
        Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
        "application/vnd.ms-outlook",
      ),
    ).toBe(true);
    expect(isValidEvidence(new TextEncoder().encode("not pdf"), "application/pdf")).toBe(false);
  });

  it("requires plausible RFC 822 headers and a body separator", () => {
    const eml = new TextEncoder().encode(
      "From: mitglied@example.org\r\nSubject: Neue Bankverbindung\r\n\r\nBitte aendern.",
    );
    expect(isValidEvidence(eml, "message/rfc822")).toBe(true);
    expect(isValidEvidence(new TextEncoder().encode("Neue Bankverbindung"), "message/rfc822")).toBe(
      false,
    );
  });
});
