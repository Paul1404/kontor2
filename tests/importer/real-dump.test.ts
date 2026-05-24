import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseDump } from "~/server/importer/sql-tokenizer";

/**
 * Smoke test against the real Linear Webverein export bundled with SVUMS.
 * Skipped when the file isn't present (e.g. CI without SVUMS sibling repo).
 */
const REAL_DUMP = "/tmp/svums/upload/datesicherung.sql";
const hasDump = existsSync(REAL_DUMP);

(hasDump ? describe : describe.skip)("real Linear dump", () => {
  it("extracts all 4 supported tables with full column lists and >0 rows", () => {
    const text = readFileSync(REAL_DUMP, "utf8");
    const parsed = parseDump(text);
    expect(parsed.columns.adresse?.length).toBeGreaterThan(200);
    expect(parsed.columns.mgart?.length).toBeGreaterThan(10);
    expect(parsed.columns.mgvert?.length).toBeGreaterThan(10);
    expect(parsed.columns.adrsepa?.length).toBeGreaterThan(10);
    expect((parsed.rows.adresse?.length ?? 0)).toBeGreaterThan(0);
    expect((parsed.rows.mgart?.length ?? 0)).toBeGreaterThan(0);
  });
});
