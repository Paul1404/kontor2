import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ENCRYPTED_TARGETS } from "~/server/crypto/reencrypt";

/**
 * Drift guard for the key-rotation safety net. A column persisted via the
 * `encryptedText` custom type that is NOT listed in `ENCRYPTED_TARGETS` would be
 * silently skipped by `reencryptAllData`, and its rows would orphan the moment
 * the old key is dropped. This test scans the schema source for every
 * `encryptedText("col")` declaration, maps it to its enclosing `pgTable`, and
 * asserts the set matches `ENCRYPTED_TARGETS` exactly. Add a column -> this
 * fails until you register it.
 */
const SCHEMA_DIR = join(process.cwd(), "src/server/db/schema");

type Col = { table: string; column: string };

function scanEncryptedColumns(): Col[] {
  const found: Col[] = [];
  for (const file of readdirSync(SCHEMA_DIR)) {
    if (!file.endsWith(".ts")) continue;
    const src = readFileSync(join(SCHEMA_DIR, file), "utf8");

    // Table boundaries: `pgTable("name"` (the name may sit on the next line).
    const tables: Array<{ name: string; index: number }> = [];
    const tableRe = /pgTable\(\s*"([a-z0-9_]+)"/g;
    for (let m = tableRe.exec(src); m; m = tableRe.exec(src)) {
      const name = m[1];
      if (name) tables.push({ name, index: m.index });
    }

    // Actual column declarations: `encryptedText("col")`. The import line and
    // doc comments use the bare word and do not match this shape.
    const colRe = /encryptedText\(\s*"([a-z0-9_]+)"/g;
    for (let m = colRe.exec(src); m; m = colRe.exec(src)) {
      const column = m[1];
      if (!column) continue;
      const idx = m.index;
      const owner = [...tables].reverse().find((t) => t.index < idx);
      if (!owner) {
        throw new Error(`encryptedText("${column}") in ${file} has no enclosing pgTable`);
      }
      found.push({ table: owner.name, column });
    }
  }
  return found;
}

const key = (c: Col) => `${c.table}.${c.column}`;

describe("ENCRYPTED_TARGETS coverage", () => {
  it("lists every encryptedText column found in the schema", () => {
    const inSchema = scanEncryptedColumns().map(key).sort();
    const registered = ENCRYPTED_TARGETS.map(key).sort();

    // Sanity: the scan actually found something (guards against a broken regex
    // or a wrong directory silently passing the equality check).
    expect(inSchema.length).toBeGreaterThanOrEqual(4);
    expect(registered).toEqual(inSchema);
  });

  it("registers each target with a stable id column", () => {
    for (const t of ENCRYPTED_TARGETS) {
      expect(t.idColumn).toBe("id");
    }
  });
});
