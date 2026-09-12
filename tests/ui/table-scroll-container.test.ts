import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Mobile layout guard. A `<table>` sizes to its content, and a table wide
 * enough to exceed a phone viewport drags the whole page into a horizontal
 * scroll: the toolbar, the filter chips and the header row all slide out of
 * the screen with it. That is exactly how the Anträge list broke at 390px.
 *
 * The fix is always the same one line: give the table its own scroll
 * container. An ancestor with `overflow-x-auto` (or plain `overflow-auto`)
 * takes `min-width: auto` out of the equation, so the page stays put and only
 * the table scrolls sideways.
 *
 * This scans every `.tsx` under `src/` and asserts each `<table` sits directly
 * inside such a container, meaning the nearest preceding JSX line carries the
 * class. Adding a table without the wrapper fails here instead of on someone's
 * phone.
 */
const SRC_DIR = join(process.cwd(), "src");
const SCROLL_CLASS = /overflow-(x-)?(auto|scroll)/;

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsxFiles(full));
    else if (entry.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

function unwrappedTables(): string[] {
  const found: string[] = [];
  for (const file of tsxFiles(SRC_DIR)) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      if (!line.includes("<table")) return;
      const previous = lines
        .slice(0, i)
        .reverse()
        .find((l) => l.trim().length > 0);
      if (!previous || !SCROLL_CLASS.test(previous)) {
        found.push(`${file.slice(process.cwd().length + 1)}:${i + 1}`);
      }
    });
  }
  return found;
}

describe("table scroll containers", () => {
  it("wraps every table in a horizontally scrollable parent", () => {
    expect(unwrappedTables()).toEqual([]);
  });

  it("actually finds the tables it is meant to check", () => {
    // Guards against a broken walk or a wrong directory passing vacuously.
    const tables = tsxFiles(SRC_DIR).reduce(
      (n, f) => n + (readFileSync(f, "utf8").match(/<table/g)?.length ?? 0),
      0,
    );
    expect(tables).toBeGreaterThanOrEqual(30);
  });
});
