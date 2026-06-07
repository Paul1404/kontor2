import { describe, expect, it } from "vitest";
import { type CsvColumn, toCsv } from "./csv";

type Row = { name: string; amount: string };
const cols: CsvColumn<Row>[] = [
  { key: "name", label: "Name" },
  { key: "amount", label: "Betrag" },
];

describe("toCsv", () => {
  it("neutralizes spreadsheet formula injection with a leading apostrophe", () => {
    const out = toCsv([{ name: '=HYPERLINK("http://evil")', amount: "10,00 €" }], cols);
    // The dangerous cell is prefixed with ' so Excel keeps it as text. It also
    // contains a quote, so the whole field is wrapped and inner quotes doubled.
    expect(out).toContain(`"'=HYPERLINK(""http://evil"")"`);
  });

  it("guards every formula-trigger lead character", () => {
    for (const lead of ["=", "+", "-", "@", "\t"]) {
      const out = toCsv([{ name: `${lead}cmd`, amount: "" }], cols);
      expect(out).toContain(`'${lead}cmd`);
    }
  });

  it("leaves plain numbers and negative amounts untouched", () => {
    const out = toCsv([{ name: "Müller", amount: "-5,00 €" }], cols);
    expect(out).toContain("Müller");
    expect(out).toContain("-5,00 €");
    expect(out).not.toContain("'-5,00");
  });

  it("escapes separators and newlines per RFC 4180", () => {
    const out = toCsv([{ name: "Meier; Sohn", amount: "a\nb" }], cols);
    expect(out).toContain('"Meier; Sohn"');
    expect(out).toContain('"a\nb"');
  });
});
