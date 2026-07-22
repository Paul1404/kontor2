import { describe, expect, it } from "vitest";
import { importCreatedMemberIds, importTouchedAdrNrs } from "~/server/importer/undo";

describe("import undo", () => {
  it("only classifies members absent from the pre-import run as created", () => {
    expect(importCreatedMemberIds(["existing", "new-a", "new-b"], ["existing"])).toEqual([
      "new-a",
      "new-b",
    ]);
  });
});

describe("importTouchedAdrNrs", () => {
  it("collects member references from partial domain-table dumps", () => {
    expect(
      importTouchedAdrNrs([
        { AdrNr: 12 },
        { adr_nr: "13", AbwAdrNr: 14 },
        { ADRNR: 15, VERKN: 16 },
        { irrelevant: 99, AdrNr: null },
      ]),
    ).toEqual([12, 13, 14, 15, 16]);
  });
});
