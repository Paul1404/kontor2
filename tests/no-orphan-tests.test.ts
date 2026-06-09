import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The Vitest config only globs `tests/**`, so a `*.test.ts` placed next to its
 * source under `src/` silently never runs in CI. That happened to four real
 * test files (member-ref, restrict-to-dunnable, like, csv formula-injection)
 * and went unnoticed. This guard fails the suite the moment another orphan
 * appears, so the gap cannot quietly reopen.
 */
function findTestFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...findTestFiles(full));
    } else if (/\.test\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe("test layout", () => {
  it("has no orphaned test files under src/ (they would not run in CI)", () => {
    const orphans = findTestFiles(join(process.cwd(), "src"));
    expect(orphans).toEqual([]);
  });
});
