import { describe, expect, it } from "vitest";
import { toCsv } from "~/server/lib/csv";

describe("toCsv", () => {
  it("emits UTF-8 BOM as the first character", () => {
    const csv = toCsv([], [{ key: "x", label: "X" }]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it("uses semicolons as separator and CRLF line endings", () => {
    const csv = toCsv(
      [{ a: "1", b: "2" }],
      [
        { key: "a", label: "A" },
        { key: "b", label: "B" },
      ],
    );
    expect(csv).toBe("﻿A;B\r\n1;2\r\n");
  });

  it("escapes fields containing the separator", () => {
    const csv = toCsv([{ name: "Müller; Söhne" }], [{ key: "name", label: "Name" }]);
    expect(csv).toContain('"Müller; Söhne"');
  });

  it("escapes fields containing quotes by doubling them", () => {
    const csv = toCsv([{ s: 'Say "hi"' }], [{ key: "s", label: "S" }]);
    expect(csv).toContain('"Say ""hi"""');
  });

  it("escapes fields containing newlines", () => {
    const csv = toCsv([{ s: "line1\nline2" }], [{ key: "s", label: "S" }]);
    expect(csv).toContain('"line1\nline2"');
  });

  it("renders null and undefined as empty strings", () => {
    const csv = toCsv(
      [{ a: null, b: undefined }],
      [
        { key: "a", label: "A" },
        { key: "b", label: "B" },
      ],
    );
    expect(csv).toBe("﻿A;B\r\n;\r\n");
  });

  it("applies format callback per column", () => {
    const csv = toCsv(
      [{ amount: 12.5 }],
      [{ key: "amount", label: "Betrag", format: (v) => `${v} EUR` }],
    );
    expect(csv).toContain("12.5 EUR");
  });

  it("emits no trailing CRLF when no rows are present", () => {
    const csv = toCsv([], [{ key: "x", label: "X" }]);
    expect(csv).toBe("﻿X\r\n");
  });

  it("preserves umlauts and other UTF-8 characters", () => {
    const csv = toCsv([{ s: "Bäcker Müßiggang" }], [{ key: "s", label: "Wert" }]);
    expect(csv).toContain("Bäcker Müßiggang");
  });
});
