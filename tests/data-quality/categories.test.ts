import { describe, expect, it } from "vitest";
import { CATEGORIES, CATEGORY_IDS } from "~/server/orpc/procedures/data-quality";

describe("data-quality categories", () => {
  it("has exactly one metadata entry per category id", () => {
    const metaIds = CATEGORIES.map((c) => c.id).sort();
    expect(metaIds).toEqual([...CATEGORY_IDS].sort());
    expect(new Set(metaIds).size).toBe(CATEGORY_IDS.length);
  });

  it("uses only known severities and non-empty copy", () => {
    for (const c of CATEGORIES) {
      expect(["warn", "info"]).toContain(c.severity);
      expect(c.label.trim().length).toBeGreaterThan(0);
      expect(c.description.trim().length).toBeGreaterThan(0);
    }
  });
});
