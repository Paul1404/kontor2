import { describe, expect, it } from "vitest";
import {
  bankChangeEvidenceMime,
  isValidBankChangeEvidence,
} from "~/server/domain/bank-change-evidence";

describe("bank change evidence", () => {
  it("canonicalizes email formats even when the browser reports no useful MIME", () => {
    expect(bankChangeEvidenceMime("Aenderung.eml", "")).toBe("message/rfc822");
    expect(bankChangeEvidenceMime("outlook.msg", "application/octet-stream")).toBe(
      "application/vnd.ms-outlook",
    );
    expect(bankChangeEvidenceMime("scan.exe", "application/pdf")).toBeNull();
  });

  it("checks PDF and MSG signatures", () => {
    expect(isValidBankChangeEvidence(new TextEncoder().encode("%PDF-1.7"), "application/pdf")).toBe(
      true,
    );
    expect(
      isValidBankChangeEvidence(
        Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
        "application/vnd.ms-outlook",
      ),
    ).toBe(true);
    expect(isValidBankChangeEvidence(new TextEncoder().encode("not pdf"), "application/pdf")).toBe(
      false,
    );
  });

  it("requires plausible RFC 822 headers and a body separator", () => {
    const eml = new TextEncoder().encode(
      "From: mitglied@example.org\r\nSubject: Neue Bankverbindung\r\n\r\nBitte aendern.",
    );
    expect(isValidBankChangeEvidence(eml, "message/rfc822")).toBe(true);
    expect(
      isValidBankChangeEvidence(new TextEncoder().encode("Neue Bankverbindung"), "message/rfc822"),
    ).toBe(false);
  });
});
