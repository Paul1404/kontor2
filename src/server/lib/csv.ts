export type CsvColumn<T> = {
  key: keyof T & string;
  label: string;
  format?: (value: unknown, row: T) => string;
};

const BOM = "﻿";
const SEP = ";";
const EOL = "\r\n";

function escapeField(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  let s = raw instanceof Date ? raw.toISOString() : String(raw);
  // Spreadsheet formula-injection guard: Excel/LibreOffice/Sheets evaluate a
  // cell whose text starts with = + - @ (or a tab/CR). A member name like
  // "=HYPERLINK(...)" would otherwise run on open. Prefix an apostrophe so the
  // value stays literal text. Plain numbers (incl. negatives like "-5,00 €")
  // are left untouched so amount columns still read as numbers.
  if (/^[=+\-@\t\r]/.test(s) && !/^[+-]?[\d.,\s]*\d[\d.,\s]*(?:\s*€)?$/.test(s)) {
    s = `'${s}`;
  }
  if (/[";\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Build a CSV string with German conventions: `;` separator, CRLF line
 * endings, UTF-8 BOM so Excel opens umlauts correctly. Values are escaped
 * per RFC 4180.
 */
export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const header = columns.map((c) => escapeField(c.label)).join(SEP);
  const body = rows
    .map((row) =>
      columns
        .map((c) => {
          const value = (row as Record<string, unknown>)[c.key];
          const out = c.format ? c.format(value, row) : value;
          return escapeField(out);
        })
        .join(SEP),
    )
    .join(EOL);
  return BOM + header + EOL + body + (rows.length > 0 ? EOL : "");
}
