import { describe, expect, it } from "vitest";
import {
  coerceBool,
  coerceDate,
  coerceDecimal,
  coerceInt,
  coerceStr,
  extractColumns,
  parseDump,
  parseValues,
} from "~/server/importer/sql-tokenizer";

describe("parseValues", () => {
  it("parses simple integers and strings", () => {
    const rows = [...parseValues("(1,'foo','bar'),(2,'baz',NULL)")];
    expect(rows).toEqual([
      [1, "foo", "bar"],
      [2, "baz", null],
    ]);
  });

  it("handles doubled-quote escapes", () => {
    const rows = [...parseValues("('it''s ok')")];
    expect(rows).toEqual([["it's ok"]]);
  });

  it("handles backslash escapes", () => {
    const rows = [...parseValues("('line1\\nline2', 'tab\\there')")];
    expect(rows[0]).toEqual(["line1\nline2", "tab\there"]);
  });

  it("decodes _binary bit(1) literals to booleans", () => {
    const rows = [...parseValues("(_binary '\\0', _binary '\\x01')")];
    expect(rows[0]).toEqual([false, true]);
  });

  it("decodes b'...' literals", () => {
    const rows = [...parseValues("(b'0', b'1')")];
    expect(rows[0]).toEqual([false, true]);
  });

  it("parses decimals", () => {
    const rows = [...parseValues("(12.5, -3.14, 1.5e2)")];
    expect(rows[0]).toEqual([12.5, -3.14, 150]);
  });

});

describe("extractColumns", () => {
  it("extracts ordered column names and stops at PRIMARY KEY", () => {
    const ddl = `CREATE TABLE \`t\` (
      \`id\` int NOT NULL,
      \`name\` varchar(20),
      \`bits\` bit(1) DEFAULT b'0',
      PRIMARY KEY (\`id\`)
    ) ENGINE=InnoDB;`;
    expect(extractColumns(ddl)).toEqual(["id", "name", "bits"]);
  });

  it("handles inline parens in column type definitions", () => {
    const ddl = `CREATE TABLE \`t\` (
      \`v\` decimal(19,8),
      \`name\` varchar(10),
      KEY \`i\` (\`name\`)
    );`;
    expect(extractColumns(ddl)).toEqual(["v", "name"]);
  });
});

describe("parseDump", () => {
  it("collects only supported tables", () => {
    const dump = `
CREATE TABLE \`adresse\` (
  \`AdrNr\` int NOT NULL,
  \`Vorname\` varchar(20),
  \`Geloscht\` bit(1) DEFAULT b'0',
  PRIMARY KEY (\`AdrNr\`)
);
CREATE TABLE \`irrelevant\` (
  \`id\` int NOT NULL,
  PRIMARY KEY (\`id\`)
);
INSERT INTO \`adresse\` VALUES (1,'Anna',_binary '\\0'),(2,'Bert',_binary '\\x01');
INSERT INTO \`irrelevant\` VALUES (1),(2);
`;
    const parsed = parseDump(dump);
    expect(parsed.columns.adresse).toEqual(["AdrNr", "Vorname", "Geloscht"]);
    expect(parsed.rows.adresse).toEqual([
      [1, "Anna", false],
      [2, "Bert", true],
    ]);
    expect(parsed.columns.irrelevant).toBeUndefined();
  });
});

describe("coercion helpers", () => {
  it("coerceStr trims and length-clips", () => {
    expect(coerceStr("  foo  ", 2)).toBe("fo");
    expect(coerceStr("", 5)).toBe(null);
    expect(coerceStr(null)).toBe(null);
  });
  it("coerceInt accepts strings and floats", () => {
    expect(coerceInt("42")).toBe(42);
    expect(coerceInt(3.7)).toBe(3);
    expect(coerceInt("not")).toBe(null);
  });
  it("coerceBool accepts Y/N and bool", () => {
    expect(coerceBool("Y")).toBe(true);
    expect(coerceBool("J")).toBe(true);
    expect(coerceBool("N")).toBe(false);
    expect(coerceBool(true)).toBe(true);
    expect(coerceBool(0)).toBe(false);
  });
  it("coerceDecimal normalises comma decimals", () => {
    expect(coerceDecimal("12,50")).toBe("12.5");
    expect(coerceDecimal("")).toBe(null);
  });
  it("coerceDate handles common Linear formats and zero-date", () => {
    expect(coerceDate("0000-00-00 00:00:00")).toBe(null);
    expect(coerceDate("2024-02-29")).toBeInstanceOf(Date);
    expect(coerceDate("2024-02-29 13:45:00.000000")).toBeInstanceOf(Date);
  });
});
