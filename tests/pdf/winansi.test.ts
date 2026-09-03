import { describe, expect, it } from "vitest";
import { needsUnicodeFont, winAnsiSafe } from "~/server/pdf/winansi";

/**
 * The built-in PDF fonts map anything outside WinAnsi through
 * `codepoint & 0xFF`, so "Łukasz" rendered as "Aukasz" with no error at all.
 * These cases are the ones that were verified to be broken in a real PDF.
 */
describe("winAnsiSafe", () => {
  it("keeps what WinAnsi can actually represent", () => {
    expect(winAnsiSafe("Grüße aus Untereuerheim")).toBe("Grüße aus Untereuerheim");
    expect(winAnsiSafe("Müller & Söhne, 97508 Grettstadt")).toBe(
      "Müller & Söhne, 97508 Grettstadt",
    );
    expect(winAnsiSafe("Beitrag 84,00 € · Vertrag – gekündigt")).toBe(
      "Beitrag 84,00 € · Vertrag – gekündigt",
    );
  });

  it("transliterates names that used to come out as garbage", () => {
    expect(winAnsiSafe("Łukasz Ćwikła")).toBe("Lukasz Cwikla");
    expect(winAnsiSafe("Šimon Dvořák")).toBe("Šimon Dvorák");
    expect(winAnsiSafe("Gülşen Çağrı")).toBe("Gülsen Çagri");
  });

  it("never leaves a character that would render as a wrong glyph", () => {
    for (const sample of ["Łukasz", "Ћирилица", "Παπαδόπουλος", "→ ≥ ✓", "日本語", "🙂"]) {
      for (const char of winAnsiSafe(sample)) {
        const code = char.codePointAt(0) ?? 0;
        expect(code).toBeLessThan(0x100);
      }
    }
  });

  it("drops what it cannot spell rather than corrupting it", () => {
    // Better an absent character than a confidently wrong one.
    expect(winAnsiSafe("Ćwikła 日本")).toBe("Cwikla ");
  });

  it("flags text that a built-in font cannot carry", () => {
    expect(needsUnicodeFont("Grüße")).toBe(false);
    expect(needsUnicodeFont("Łukasz")).toBe(true);
  });
});
