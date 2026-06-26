import { describe, expect, it } from "vitest";
import { __test, buildPain008, formatAmount } from "~/server/sepa/pain008";

const creditor = {
  name: "SV Untereuerheim 1945 e.V.",
  iban: "DE56793501010005124185",
  bic: "BYLADEM1KSW",
  glaeubigerId: "DE71ZZZ00000901082",
};

describe("formatAmount", () => {
  it("normalizes integer", () => {
    expect(formatAmount("54")).toBe("54.00");
  });
  it("normalizes one decimal", () => {
    expect(formatAmount("54.5")).toBe("54.50");
  });
  it("truncates excess decimals", () => {
    expect(formatAmount("54.123456")).toBe("54.12");
  });
});

describe("XML escaping", () => {
  it("escapes XML metacharacters", () => {
    expect(__test.esc("Müller & Söhne <GmbH>")).toBe("Müller &amp; Söhne &lt;GmbH&gt;");
  });
});

describe("buildPain008", () => {
  const baseInput = {
    creditor,
    falligkeitsdatum: "2026-02-15",
    msgId: "SV-2026-TESTMSG",
    pmtInfIdPrefix: "SV-2026-TESTMSG",
    createdAtIso: "2026-01-20T10:00:00",
    items: [
      {
        endToEndId: "E2E-1",
        amount: "54.00",
        mandateRef: "M-1",
        mandateSignatureDate: "2024-01-15",
        debtorName: "Anna Beispiel",
        debtorIban: "DE89370400440532013000",
        debtorBic: "COBADEFFXXX",
        purpose: "Mitgliedsbeitrag 2026",
        sequenceType: "RCUR" as const,
      },
      {
        endToEndId: "E2E-2",
        amount: "96.00",
        mandateRef: "M-2",
        mandateSignatureDate: "2025-06-01",
        debtorName: "Familie Müller",
        debtorIban: "DE56793501010005124185",
        debtorBic: null,
        purpose: "Familienbeitrag 2026",
        sequenceType: "FRST" as const,
      },
    ],
  };

  it("contains the pain.008.001.02 namespace", () => {
    const xml = buildPain008(baseInput);
    expect(xml).toContain('xmlns="urn:iso:std:iso:20022:tech:xsd:pain.008.001.02"');
  });

  it("emits group-level NbOfTxs and CtrlSum across all items", () => {
    const xml = buildPain008(baseInput);
    // First NbOfTxs is the group header.
    const firstNb = xml.match(/<NbOfTxs>(\d+)<\/NbOfTxs>/);
    expect(firstNb?.[1]).toBe("2");
    const firstSum = xml.match(/<CtrlSum>(\d+\.\d{2})<\/CtrlSum>/);
    expect(firstSum?.[1]).toBe("150.00");
  });

  it("splits FRST and RCUR into separate PmtInf blocks (Bundesbank rule)", () => {
    const xml = buildPain008(baseInput);
    const blocks = xml.match(/<PmtInf>[\s\S]*?<\/PmtInf>/g) ?? [];
    expect(blocks.length).toBe(2);
    expect(blocks.find((b) => b.includes("<SeqTp>FRST</SeqTp>"))).toBeTruthy();
    expect(blocks.find((b) => b.includes("<SeqTp>RCUR</SeqTp>"))).toBeTruthy();
  });

  it("derives the debtor BIC from a German IBAN when none is stored", () => {
    // baseInput's second item has a DE IBAN and no BIC -> derived from the BLZ.
    const xml = buildPain008(baseInput);
    expect(xml).toContain("<BIC>BYLADEM1KSW</BIC>");
  });

  it("falls back to NOTPROVIDED for an unknown (non-DE) bank when no BIC is stored", () => {
    const xml = buildPain008({
      ...baseInput,
      items: [
        {
          endToEndId: "E2E-X",
          amount: "10.00",
          mandateRef: "M-X",
          mandateSignatureDate: "2024-01-15",
          debtorName: "Auslandskonto",
          debtorIban: "AT611904300234573201",
          debtorBic: null,
          purpose: "Test",
          sequenceType: "RCUR" as const,
        },
      ],
    });
    expect(xml).toContain("NOTPROVIDED");
  });

  it("includes creditor identification", () => {
    const xml = buildPain008(baseInput);
    expect(xml).toContain("<Id>DE71ZZZ00000901082</Id>");
    expect(xml).toContain("<IBAN>DE56793501010005124185</IBAN>");
    expect(xml).toContain("<BIC>BYLADEM1KSW</BIC>");
    expect(xml).toContain("<SvcLvl><Cd>SEPA</Cd></SvcLvl>");
    expect(xml).toContain("<LclInstrm><Cd>CORE</Cd></LclInstrm>");
  });

  it("uses the falligkeitsdatum as ReqdColltnDt in every block", () => {
    const xml = buildPain008(baseInput);
    const occurrences = xml.match(/<ReqdColltnDt>2026-02-15<\/ReqdColltnDt>/g) ?? [];
    expect(occurrences.length).toBe(2);
  });

  it("CtrlSum within each PmtInf matches the block's items", () => {
    const xml = buildPain008(baseInput);
    // FRST item in fixture is the 96.00 Familienbeitrag, RCUR is 54.00.
    // Regex used the [^]*? form to make the SeqTp match non-greedy across blocks.
    const frst =
      xml.match(
        /<PmtInf>(?:(?!<\/PmtInf>)[\s\S])*?<SeqTp>FRST<\/SeqTp>(?:(?!<\/PmtInf>)[\s\S])*?<\/PmtInf>/,
      )?.[0] ?? "";
    expect(frst.match(/<CtrlSum>(\d+\.\d{2})<\/CtrlSum>/)?.[1]).toBe("96.00");
    const rcur =
      xml.match(
        /<PmtInf>(?:(?!<\/PmtInf>)[\s\S])*?<SeqTp>RCUR<\/SeqTp>(?:(?!<\/PmtInf>)[\s\S])*?<\/PmtInf>/,
      )?.[0] ?? "";
    expect(rcur.match(/<CtrlSum>(\d+\.\d{2})<\/CtrlSum>/)?.[1]).toBe("54.00");
  });

  it("emits MsgId truncated to 35 chars when concatenated by caller", () => {
    const xml = buildPain008(baseInput);
    expect(xml).toContain("<MsgId>SV-2026-TESTMSG</MsgId>");
  });

  it("transliterates umlauts in debtor name to the SEPA charset", () => {
    const xml = buildPain008({
      ...baseInput,
      items: [
        {
          ...baseInput.items[0]!,
          debtorName: "Müller & Söhne",
        },
      ],
    });
    // SEPA rejects umlauts and "&": ä/ö/ü -> ae/oe/ue, & dropped.
    expect(xml).toContain("<Nm>Mueller Soehne</Nm>");
    expect(xml).not.toContain("Müller");
    expect(xml).not.toContain("&amp;");
  });
});

describe("sepaText", () => {
  const { sepaText } = __test;
  it("transliterates German umlauts and ß", () => {
    expect(sepaText("Schäfer Straße Öhringen Über")).toBe("Schaefer Strasse Oehringen Ueber");
    expect(sepaText("Weißbier")).toBe("Weissbier");
  });
  it("strips other diacritics to the base letter", () => {
    expect(sepaText("José Citroën")).toBe("Jose Citroen");
  });
  it("replaces disallowed characters with a single space", () => {
    expect(sepaText("A&B  #C")).toBe("A B C");
  });
  it("keeps the allowed SEPA punctuation", () => {
    expect(sepaText("Beitrag 2026 (Erw.) -/+ Ref:1,00'")).toBe("Beitrag 2026 (Erw.) -/+ Ref:1,00'");
  });
});
