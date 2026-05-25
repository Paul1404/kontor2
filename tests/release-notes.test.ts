import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  CURRENT_VERSION,
  RELEASES,
  type ReleaseCategory,
} from "~/lib/release-notes";

describe("release-notes integrity", () => {
  it("has at least one release", () => {
    expect(RELEASES.length).toBeGreaterThan(0);
  });

  it("exposes the newest version as CURRENT_VERSION", () => {
    expect(CURRENT_VERSION).toBe(RELEASES[0]?.version);
  });

  it("keeps package.json version in sync with CURRENT_VERSION", () => {
    const pkg = JSON.parse(readFileSync(`${process.cwd()}/package.json`, "utf8"));
    expect(pkg.version).toBe(CURRENT_VERSION);
  });

  it("uses semver-shaped versions", () => {
    for (const r of RELEASES) {
      expect(r.version).toMatch(/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/);
    }
  });

  it("uses ISO dates", () => {
    for (const r of RELEASES) {
      expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("lists releases newest-first by date", () => {
    for (let i = 1; i < RELEASES.length; i += 1) {
      const prev = RELEASES[i - 1]!.date;
      const cur = RELEASES[i]!.date;
      expect(prev >= cur).toBe(true);
    }
  });

  it("never lists a duplicate version", () => {
    const seen = new Set<string>();
    for (const r of RELEASES) {
      expect(seen.has(r.version)).toBe(false);
      seen.add(r.version);
    }
  });

  it("each release has at least one change", () => {
    for (const r of RELEASES) {
      expect(r.changes.length).toBeGreaterThan(0);
    }
  });

  it("every change uses a known category", () => {
    const known = new Set<ReleaseCategory>(CATEGORY_ORDER);
    for (const r of RELEASES) {
      for (const c of r.changes) {
        expect(known.has(c.category)).toBe(true);
      }
    }
  });

  it("provides a label for every category in CATEGORY_ORDER", () => {
    for (const cat of CATEGORY_ORDER) {
      expect(CATEGORY_LABELS[cat]).toBeTruthy();
    }
  });
});
