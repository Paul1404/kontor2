import { describe, expect, it } from "vitest";
import {
  analyzeDump,
  buildSearchText,
  parseCreateTable,
  rowToObject,
  summarizeColumn,
} from "~/server/archive/sql-analyzer";

const DUMP = `
-- MySQL dump
CREATE TABLE \`adresse\` (
  \`AdrNr\` int NOT NULL,
  \`Vorname\` varchar(20) DEFAULT NULL,
  \`Nachname\` varchar(40) NOT NULL,
  \`Beitrag\` decimal(19,2) DEFAULT '0.00',
  \`Geloscht\` bit(1) DEFAULT b'0',
  PRIMARY KEY (\`AdrNr\`),
  KEY \`name_idx\` (\`Nachname\`,\`Vorname\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

INSERT INTO \`adresse\` VALUES
  (1,'Anna','Müller',12.50,_binary '\\0'),
  (2,'Bert','Schmidt',NULL,_binary '\\x01'),
  (3,NULL,'Müller',12.50,_binary '\\0');

CREATE TABLE \`mgvert\` (
  \`AdrNr\` int NOT NULL,
  \`VertragNr\` varchar(10) NOT NULL,
  \`Art\` int DEFAULT NULL
) ENGINE=InnoDB;

INSERT INTO \`mgvert\` VALUES (1,'V-1',5),(2,'V-2',7);
`;

describe("analyzeDump", () => {
  const dump = analyzeDump(DUMP);

  it("finds every table in first-appearance order", () => {
    expect(dump.tables.map((t) => t.name)).toEqual(["adresse", "mgvert"]);
  });

  it("captures the verbatim CREATE TABLE", () => {
    const adresse = dump.tables.find((t) => t.name === "adresse")!;
    expect(adresse.createSql).toContain("CREATE TABLE `adresse`");
    expect(adresse.createSql).toContain("PRIMARY KEY");
  });

  it("reverse-engineers columns with types, nullability and defaults", () => {
    const adresse = dump.tables.find((t) => t.name === "adresse")!;
    const col = (name: string) => adresse.columns.find((c) => c.name === name)!;

    expect(adresse.columns.map((c) => c.name)).toEqual([
      "AdrNr",
      "Vorname",
      "Nachname",
      "Beitrag",
      "Geloscht",
    ]);
    expect(col("AdrNr")).toMatchObject({
      baseType: "int",
      dataType: "int",
      nullable: false,
      isPrimaryKey: true,
      isIndexed: true,
    });
    expect(col("Vorname")).toMatchObject({
      baseType: "varchar",
      dataType: "varchar(20)",
      nullable: true,
      isPrimaryKey: false,
    });
    expect(col("Nachname")).toMatchObject({ nullable: false, isIndexed: true });
    expect(col("Beitrag")).toMatchObject({ baseType: "decimal", dataType: "decimal(19,2)" });
    expect(col("Beitrag").defaultValue).toBe("'0.00'");
    expect(col("Geloscht")).toMatchObject({ baseType: "bit", dataType: "bit(1)" });
  });

  it("captures the primary key", () => {
    const adresse = dump.tables.find((t) => t.name === "adresse")!;
    expect(adresse.primaryKey).toEqual(["AdrNr"]);
  });

  it("parses the rows", () => {
    const adresse = dump.tables.find((t) => t.name === "adresse")!;
    expect(adresse.rows).toHaveLength(3);
    expect(adresse.rows[0]).toEqual([1, "Anna", "Müller", 12.5, false]);
    expect(adresse.rows[1]).toEqual([2, "Bert", "Schmidt", null, true]);
  });

  it("handles a table without a declared primary key", () => {
    const mgvert = dump.tables.find((t) => t.name === "mgvert")!;
    expect(mgvert.primaryKey).toEqual([]);
    expect(mgvert.rows).toEqual([
      [1, "V-1", 5],
      [2, "V-2", 7],
    ]);
  });
});

describe("parseCreateTable", () => {
  it("does not stop at the first constraint", () => {
    const { columns, primaryKey } = parseCreateTable(
      "CREATE TABLE `t` (`a` int NOT NULL, `b` varchar(5), PRIMARY KEY (`a`), UNIQUE KEY `u` (`b`))",
    );
    expect(columns.map((c) => c.name)).toEqual(["a", "b"]);
    expect(primaryKey).toEqual(["a"]);
    expect(columns.find((c) => c.name === "b")?.isIndexed).toBe(true);
  });
});

describe("summarizeColumn", () => {
  const rows = [
    [1, "Anna", "Müller", 12.5, false],
    [2, "Bert", "Schmidt", null, true],
    [3, null, "Müller", 12.5, false],
  ];

  it("counts nulls and distinct values", () => {
    const vorname = summarizeColumn(rows, 1);
    expect(vorname.nullCount).toBe(1);
    expect(vorname.distinctCount).toBe(2);

    const nachname = summarizeColumn(rows, 2);
    expect(nachname.nullCount).toBe(0);
    expect(nachname.distinctCount).toBe(2);
    expect(nachname.sampleValues).toEqual(["Müller", "Schmidt"]);
  });

  it("computes numeric min/max", () => {
    const adrNr = summarizeColumn(rows, 0);
    expect(adrNr.minText).toBe("1");
    expect(adrNr.maxText).toBe("3");
  });
});

describe("rowToObject / buildSearchText", () => {
  const { columns } = parseCreateTable(
    "CREATE TABLE `t` (`a` int, `b` varchar(5), `c` varchar(5))",
  );

  it("maps a tuple onto column names", () => {
    expect(rowToObject(columns, [1, "x", null])).toEqual({ a: 1, b: "x", c: null });
  });

  it("builds a lowercased, null-skipping search string", () => {
    expect(buildSearchText([1, "Anna", null])).toBe("1 anna");
  });
});
