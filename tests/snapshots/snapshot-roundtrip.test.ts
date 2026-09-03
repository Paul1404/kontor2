import { describe, expect, it } from "vitest";
import * as schema from "~/server/db/schema";
import { coerce, DATE_HINT_KEYS } from "~/server/orpc/procedures/snapshots";

/**
 * This file used to carry its own copy of `coerce` and `DATE_HINT_KEYS`, with a
 * comment admitting the copy would need re-deriving if production changed. It
 * did change: production reached thirty keys while the copy stayed at eleven,
 * so the test kept passing on a list nineteen keys out of date. A key missing
 * from the real list makes restore write a string into a date column, which the
 * driver rejects at runtime.
 *
 * Both are now imported, and a drift guard derives the expectation from the
 * schema rather than from a second hand-written list.
 */
describe("coerce", () => {
  it("turns a snapshot string back into a Date for date columns", () => {
    expect(coerce("geburtsdatum", "1990-04-01")).toBeInstanceOf(Date);
    expect(coerce("austritt", "2026-12-31T00:00:00.000Z")).toBeInstanceOf(Date);
    expect((coerce("eintritt", "2019-01-01") as Date).toISOString()).toContain("2019-01-01");
  });

  it("leaves everything else alone", () => {
    expect(coerce("nachname", "Gock")).toBe("Gock");
    expect(coerce("mitgliedsnummer", "1431")).toBe("1431");
    // A plain number field must not become a date just because it parses.
    expect(coerce("adrNr", 544)).toBe(544);
  });

  it("passes null and undefined through untouched", () => {
    expect(coerce("austritt", null)).toBeNull();
    expect(coerce("austritt", undefined)).toBeNull();
  });

  it("does not coerce an unparseable string", () => {
    expect(coerce("austritt", "keine Angabe")).toBe("keine Angabe");
  });
});

describe("DATE_HINT_KEYS deckt die Datumsspalten ab", () => {
  /** Exactly the tables a restore writes back into. */
  const RESTORED_TABLES = [
    schema.membersTable,
    schema.memberAbteilungenTable,
    schema.relationshipsTable,
    schema.contractsTable,
    schema.sepaMandatesTable,
    schema.attachmentsTable,
  ];

  it("kennt jede Datums- und Zeitstempelspalte der zurückgespielten Tabellen", () => {
    const missing: string[] = [];
    for (const table of RESTORED_TABLES) {
      for (const [property, column] of Object.entries(
        table as unknown as Record<string, { dataType?: string; columnType?: string }>,
      )) {
        const columnType = column?.columnType ?? "";
        // `PgDateString` columns come back as "YYYY-MM-DD" strings by design
        // and must NOT be coerced; only real Date-valued columns need a hint.
        const needsHint = columnType === "PgTimestamp" || columnType === "PgDate";
        if (!needsHint) continue;
        // These are set by the restore itself, never taken from the snapshot.
        if (property === "updatedAt" || property === "createdAt") continue;
        if (!DATE_HINT_KEYS.has(property)) missing.push(`${property} (${columnType})`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("enthält keine Schlüssel mehr, die es nirgends gibt", () => {
    const known = new Set<string>();
    for (const table of RESTORED_TABLES) {
      for (const property of Object.keys(table as unknown as Record<string, unknown>)) {
        known.add(property);
      }
    }
    const stale = [...DATE_HINT_KEYS].filter((key) => !known.has(key));
    expect(stale).toEqual([]);
  });
});
