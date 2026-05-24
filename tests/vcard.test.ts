import { describe, expect, it } from "vitest";
import { buildVCard, vcardFilename } from "~/lib/vcard";

describe("buildVCard", () => {
  it("emits a minimal vcard with FN + N", () => {
    const vcf = buildVCard({ vorname: "Anna", nachname: "Müller" });
    expect(vcf).toContain("BEGIN:VCARD");
    expect(vcf).toContain("VERSION:3.0");
    expect(vcf).toContain("FN:Anna Müller");
    expect(vcf).toContain("N:Müller;Anna;;;");
    expect(vcf).toContain("END:VCARD");
    expect(vcf.endsWith("\r\n")).toBe(true);
  });

  it("includes email and phones with the right TYPE markers", () => {
    const vcf = buildVCard({
      vorname: "A",
      nachname: "B",
      email: "a@b.de",
      telefon: "+49 30 1234",
      mobil: "+49 170 1234",
    });
    expect(vcf).toContain("EMAIL;TYPE=INTERNET:a@b.de");
    expect(vcf).toContain("TEL;TYPE=VOICE:+49 30 1234");
    expect(vcf).toContain("TEL;TYPE=CELL:+49 170 1234");
  });

  it("escapes commas, semicolons, and newlines in values", () => {
    const vcf = buildVCard({
      vorname: "A;B",
      nachname: "C,D",
      funktion: "Trainer\nFußball",
    });
    expect(vcf).toContain("N:C\\,D;A\\;B;;;");
    expect(vcf).toContain("TITLE:Trainer\\nFußball");
  });

  it("formats BDAY as YYYY-MM-DD", () => {
    const vcf = buildVCard({
      vorname: "A",
      nachname: "B",
      geburtsdatum: new Date("1990-03-04T00:00:00Z"),
    });
    expect(vcf).toContain("BDAY:1990-03-04");
  });

  it("falls back to 'Unbekannt' for empty names so FN is never blank", () => {
    const vcf = buildVCard({});
    expect(vcf).toContain("FN:Unbekannt");
  });

  it("computes a filesystem-safe vcard filename", () => {
    // Non-ASCII chars are collapsed to underscore for portability across
    // OSes and download tooling that misbehave on UTF-8 filenames.
    expect(vcardFilename({ vorname: "Anna", nachname: "Müller" })).toBe("Anna-M_ller.vcf");
    expect(vcardFilename({ vorname: "A/B", nachname: "C D" })).toBe("A_B-C_D.vcf");
    expect(vcardFilename({ mitglnr: "42" })).toBe("mitglied-42.vcf");
  });
});
