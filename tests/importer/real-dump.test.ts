import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  mapFachverbandRow,
  mapLastProtRow,
  mapLastProtSRow,
  mapMgartDatRow,
  mapSollStellungRow,
  mapSportartRow,
  mapVerknRow,
} from "~/server/importer/linear-mapper";
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

  it("parses the phase-2 tables (mgsolln, sportarten, fachverbaende, mgartdat, lastprot)", () => {
    const text = readFileSync(REAL_DUMP as string, "utf8");
    const parsed = parseDump(text);
    expect((parsed.rows.mgsolln ?? []).length).toBeGreaterThan(100);
    expect((parsed.rows.sportarten ?? []).length).toBeGreaterThan(100);
    expect((parsed.rows.fachverbaende ?? []).length).toBeGreaterThan(100);
    expect((parsed.rows.mgartdat ?? []).length).toBeGreaterThan(0);
    // lastprot may legitimately be empty if no SEPA run was ever sent.
    expect(parsed.columns.lastprot?.length ?? 0).toBeGreaterThan(0);
  });

  it("maps every mgsolln row into a typed Sollstellung", () => {
    const text = readFileSync(REAL_DUMP as string, "utf8");
    const parsed = parseDump(text);
    const rows = parsed.rows.mgsolln ?? [];
    const cols = parsed.columns.mgsolln ?? [];
    let mapped = 0;
    for (const r of rows) {
      if (mapSollStellungRow(rowToDict(cols, r)) !== null) mapped += 1;
    }
    // The natural-key columns are all NOT NULL in Linear, so every row
    // must round-trip cleanly.
    expect(mapped).toBe(rows.length);
  });

  it("maps every sportarten / fachverbaende / mgartdat row", () => {
    const text = readFileSync(REAL_DUMP as string, "utf8");
    const parsed = parseDump(text);

    const sRows = parsed.rows.sportarten ?? [];
    const sCols = parsed.columns.sportarten ?? [];
    expect(sRows.every((r) => mapSportartRow(rowToDict(sCols, r)) !== null)).toBe(true);

    const fRows = parsed.rows.fachverbaende ?? [];
    const fCols = parsed.columns.fachverbaende ?? [];
    expect(fRows.every((r) => mapFachverbandRow(rowToDict(fCols, r)) !== null)).toBe(true);

    const mRows = parsed.rows.mgartdat ?? [];
    const mCols = parsed.columns.mgartdat ?? [];
    expect(mRows.every((r) => mapMgartDatRow(rowToDict(mCols, r)) !== null)).toBe(true);
  });

  it("maps every lastprot / lastprots row", () => {
    const text = readFileSync(REAL_DUMP as string, "utf8");
    const parsed = parseDump(text);
    const lpRows = parsed.rows.lastprot ?? [];
    const lpCols = parsed.columns.lastprot ?? [];
    for (const r of lpRows) {
      expect(mapLastProtRow(rowToDict(lpCols, r), false)).not.toBeNull();
    }
    const lpsRows = parsed.rows.lastprots ?? [];
    const lpsCols = parsed.columns.lastprots ?? [];
    for (const r of lpsRows) {
      expect(mapLastProtSRow(rowToDict(lpsCols, r), false)).not.toBeNull();
    }
  });
});
