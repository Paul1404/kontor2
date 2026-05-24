/**
 * Tests the snapshot data shape end-to-end without hitting the database:
 * apply `buildRestorePatch`-style coercion to a captured JSONB blob and
 * confirm date strings round-trip back to Date instances.
 */
import { describe, expect, it } from "vitest";

// Mirror the local helper used by the snapshots router. Kept inline so
// the test doesn't depend on internals that may move; if the production
// list shifts, the test should be re-derived too.
const DATE_HINT_KEYS = new Set([
  "geburtsdatum",
  "eintritt",
  "austritt",
  "verstorbenAm",
  "deletedAt",
  "createdAt",
  "updatedAt",
  "vertragBegin",
  "vertragEnde",
  "gekuendAm",
  "uploadedAt",
]);

function coerce(key: string, value: unknown): unknown {
  if (value == null) return null;
  if (typeof value === "string" && DATE_HINT_KEYS.has(key)) {
    const d = new Date(value);
    if (Number.isFinite(d.getTime())) return d;
  }
  return value;
}

describe("snapshot round-trip coercion", () => {
  it("coerces date-hinted ISO strings back to Date instances", () => {
    const snapshotBlob = {
      vorname: "Anna",
      eintritt: "2024-01-15T00:00:00.000Z",
      plz: "97520",
    };
    const restored = Object.fromEntries(
      Object.entries(snapshotBlob).map(([k, v]) => [k, coerce(k, v)]),
    );
    expect(restored.vorname).toBe("Anna");
    expect(restored.plz).toBe("97520");
    expect(restored.eintritt).toBeInstanceOf(Date);
    expect((restored.eintritt as Date).toISOString()).toBe("2024-01-15T00:00:00.000Z");
  });

  it("leaves non-date string fields untouched even when value looks date-like", () => {
    const out = coerce("plz", "2024-01-15");
    expect(out).toBe("2024-01-15");
  });

  it("collapses undefined to null so DB updates don't accidentally clear-vs-keep", () => {
    expect(coerce("eintritt", undefined)).toBeNull();
    expect(coerce("plz", null)).toBeNull();
  });
});
