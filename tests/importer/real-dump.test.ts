import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mapVerknRow } from "~/server/importer/linear-mapper";
import { parseDump, rowToDict } from "~/server/importer/sql-tokenizer";

/**
 * Smoke test against the real Linear Webverein export. Two candidate paths:
 * the legacy SVUMS sibling location, and the in-repo reference dump.
 */
const CANDIDATES = [
  "/tmp/svums/upload/datesicherung.sql",
  `${process.cwd()}/reference/linear/datesicherung.sql`,
];
const REAL_DUMP = CANDIDATES.find((p) => existsSync(p));
const hasDump = REAL_DUMP !== undefined;

(hasDump ? describe : describe.skip)("real Linear dump", () => {
  it("extracts all 5 supported tables with full column lists and >0 rows", () => {
    const text = readFileSync(REAL_DUMP as string, "utf8");
    const parsed = parseDump(text);
    expect(parsed.columns.adresse?.length).toBeGreaterThan(200);
    expect(parsed.columns.mgart?.length).toBeGreaterThan(10);
    expect(parsed.columns.mgvert?.length).toBeGreaterThan(10);
    expect(parsed.columns.adrsepa?.length).toBeGreaterThan(10);
    expect(parsed.columns.verkn?.length).toBeGreaterThan(20);
    expect(parsed.rows.adresse?.length ?? 0).toBeGreaterThan(0);
    expect(parsed.rows.mgart?.length ?? 0).toBeGreaterThan(0);
    expect(parsed.rows.verkn?.length ?? 0).toBeGreaterThan(0);
  });

  it("maps every parsed verkn row into a typed relationship", () => {
    const text = readFileSync(REAL_DUMP as string, "utf8");
    const parsed = parseDump(text);
    const verknRows = parsed.rows.verkn ?? [];
    const verknCols = parsed.columns.verkn ?? [];
    let mapped = 0;
    let nulled = 0;
    for (const r of verknRows) {
      const m = mapVerknRow(rowToDict(verknCols, r));
      if (m === null) nulled += 1;
      else mapped += 1;
    }
    // Every row in the real dump has both ADRNR and VERKN populated, so
    // none should be dropped by the mapper.
    expect(mapped).toBe(verknRows.length);
    expect(nulled).toBe(0);
  });
});
