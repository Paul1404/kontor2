/**
 * Full-dump analyzer for the versioned Linear archive.
 *
 * Unlike `src/server/importer/sql-tokenizer.ts` (which only looks at the handful
 * of tables the importer maps and only extracts column NAMES), this walks the
 * entire mysqldump and reverse-engineers each table: the verbatim CREATE TABLE,
 * every column with its declared type / nullability / default, the primary key,
 * which columns are indexed, and all data rows. Row VALUES are parsed by reusing
 * the tokenizer's battle-tested `parseValues`; only the schema-level parsing is
 * new here.
 */

import { type Cell, parseValues, type Row } from "~/server/importer/sql-tokenizer";

export type ArchiveColumn = {
  name: string;
  /** Declared type verbatim, e.g. "varchar(20)" or "bit(1)". */
  dataType: string | null;
  /** Normalised base type (lowercased, no params), e.g. "varchar", "int". */
  baseType: string | null;
  nullable: boolean;
  defaultValue: string | null;
  isPrimaryKey: boolean;
  isIndexed: boolean;
};

export type ArchiveTable = {
  name: string;
  createSql: string;
  columns: ArchiveColumn[];
  primaryKey: string[];
  rows: Row[];
};

export type AnalyzedDump = {
  tables: ArchiveTable[];
};

/** Column / index / constraint keywords that start a non-column fragment. */
const CONSTRAINT_PREFIXES = [
  "PRIMARY KEY",
  "UNIQUE KEY",
  "UNIQUE INDEX",
  "UNIQUE",
  "FULLTEXT KEY",
  "FULLTEXT",
  "SPATIAL KEY",
  "SPATIAL",
  "FOREIGN KEY",
  "CONSTRAINT",
  "KEY",
  "INDEX",
  "CHECK",
];

/**
 * Split the top-level (depth-0) body of a CREATE TABLE on commas, returning
 * every fragment (columns AND constraints). Mirrors the bracket/quote handling
 * of the tokenizer's `extractColumns`, but does not stop at the first
 * constraint -- the archive needs the PRIMARY KEY / KEY clauses too.
 */
function splitTopLevelFragments(createSql: string): string[] {
  const start = createSql.indexOf("(");
  if (start === -1) return [];
  const body = createSql.substring(start + 1);
  const fragments: string[] = [];
  let depth = 0;
  let buf = "";
  let inStr = false;
  let inBacktick = false;
  for (const ch of body) {
    if (!inStr && !inBacktick) {
      if (ch === "(") {
        depth += 1;
        buf += ch;
        continue;
      }
      if (ch === ")") {
        if (depth === 0) {
          fragments.push(buf);
          buf = "";
          break;
        }
        depth -= 1;
        buf += ch;
        continue;
      }
      if (ch === "," && depth === 0) {
        fragments.push(buf);
        buf = "";
        continue;
      }
      if (ch === "`") {
        inBacktick = true;
        buf += ch;
        continue;
      }
      if (ch === "'") {
        inStr = true;
        buf += ch;
        continue;
      }
      buf += ch;
      continue;
    }
    if (inBacktick) {
      buf += ch;
      if (ch === "`") inBacktick = false;
      continue;
    }
    buf += ch;
    if (ch === "'") inStr = false;
  }
  if (buf.trim() && fragments.length === 0) fragments.push(buf);
  return fragments;
}

/** Pull every backtick-quoted identifier out of a fragment, in order. */
function backtickedIdentifiers(fragment: string): string[] {
  const out: string[] = [];
  const re = /`([^`]+)`/g;
  let m: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard exec loop
  while ((m = re.exec(fragment)) !== null) {
    out.push(m[1]!);
  }
  return out;
}

function isConstraintFragment(trimmed: string): boolean {
  const u = trimmed.toUpperCase();
  return CONSTRAINT_PREFIXES.some((p) => u.startsWith(p));
}

function parseColumnFragment(fragment: string): ArchiveColumn | null {
  const f = fragment.trim();
  if (!f.startsWith("`")) return null;
  const end = f.indexOf("`", 1);
  if (end <= 1) return null;
  const name = f.substring(1, end);
  const rest = f.substring(end + 1).trim();

  // Type: leading word plus an optional (...) parameter list, e.g.
  // "varchar(20)", "decimal(19,2)", "int unsigned", "bit(1)".
  const typeMatch = /^([a-zA-Z][a-zA-Z0-9_]*)\s*(\([^)]*\))?/.exec(rest);
  const baseType = typeMatch ? typeMatch[1]!.toLowerCase() : null;
  const dataType = typeMatch
    ? `${typeMatch[1]!.toLowerCase()}${typeMatch[2] ? typeMatch[2].replace(/\s+/g, "") : ""}`
    : null;

  const upper = rest.toUpperCase();
  const nullable = !/\bNOT\s+NULL\b/.test(upper);

  let defaultValue: string | null = null;
  const def = /\bDEFAULT\s+(b'[^']*'|'(?:[^'\\]|\\.|'')*'|[^\s,]+)/i.exec(rest);
  if (def) defaultValue = def[1]!;

  return {
    name,
    dataType,
    baseType,
    nullable,
    defaultValue,
    isPrimaryKey: false,
    isIndexed: false,
  };
}

/** Parse the columns, primary key and indexed columns of a CREATE TABLE. */
export function parseCreateTable(createSql: string): {
  columns: ArchiveColumn[];
  primaryKey: string[];
} {
  const fragments = splitTopLevelFragments(createSql);
  const columns: ArchiveColumn[] = [];
  const byName = new Map<string, ArchiveColumn>();
  let primaryKey: string[] = [];
  const indexed = new Set<string>();

  for (const frag of fragments) {
    const trimmed = frag.trim();
    if (!trimmed) continue;
    if (isConstraintFragment(trimmed)) {
      const u = trimmed.toUpperCase();
      const ids = backtickedIdentifiers(trimmed);
      if (u.startsWith("PRIMARY KEY")) {
        primaryKey = ids;
      } else if (
        u.startsWith("KEY") ||
        u.startsWith("UNIQUE") ||
        u.startsWith("INDEX") ||
        u.startsWith("FULLTEXT") ||
        u.startsWith("SPATIAL") ||
        u.startsWith("FOREIGN KEY")
      ) {
        // A KEY fragment's identifiers are [keyName?, ...columns]; the index
        // name is not itself a column, but marking it indexed is harmless and
        // we only surface this flag for real columns below.
        for (const id of ids) indexed.add(id);
      }
      continue;
    }
    const col = parseColumnFragment(trimmed);
    if (col) {
      columns.push(col);
      byName.set(col.name, col);
    }
  }

  for (const name of primaryKey) {
    const col = byName.get(name);
    if (col) {
      col.isPrimaryKey = true;
      col.nullable = false;
    }
  }
  for (const col of columns) {
    if (indexed.has(col.name) || col.isPrimaryKey) col.isIndexed = true;
  }

  return { columns, primaryKey };
}

function tableNameOf(stmt: string): string {
  const start = stmt.indexOf("`");
  if (start === -1) return "";
  const end = stmt.indexOf("`", start + 1);
  if (end === -1) return "";
  return stmt.substring(start + 1, end);
}

function endsStatement(line: string): boolean {
  return line.trimEnd().endsWith(";");
}

/**
 * Walk the whole dump and return every table with schema + rows. Tables are
 * returned in first-appearance order. Malformed INSERTs are skipped (their
 * table still appears, just with fewer rows) rather than aborting the analysis.
 */
export function analyzeDump(text: string): AnalyzedDump {
  const order: string[] = [];
  const tables = new Map<string, ArchiveTable>();

  const ensure = (name: string): ArchiveTable => {
    let t = tables.get(name);
    if (!t) {
      t = { name, createSql: "", columns: [], primaryKey: [], rows: [] };
      tables.set(name, t);
      order.push(name);
    }
    return t;
  };

  const lines = text.split(/\r?\n/);
  const n = lines.length;
  let i = 0;
  while (i < n) {
    const line = lines[i]!;
    const stripped = line.replace(/^\s+/, "");

    if (stripped.startsWith("CREATE TABLE")) {
      const name = tableNameOf(stripped);
      const buf = [stripped];
      while (!endsStatement(buf[buf.length - 1]!)) {
        i += 1;
        if (i >= n) break;
        buf.push(lines[i]!);
      }
      i += 1;
      if (name) {
        const createSql = buf.join("\n");
        const { columns, primaryKey } = parseCreateTable(createSql);
        const t = ensure(name);
        t.createSql = createSql;
        t.columns = columns;
        t.primaryKey = primaryKey;
      }
      continue;
    }

    if (stripped.startsWith("INSERT INTO")) {
      const name = tableNameOf(stripped);
      const buf = [stripped];
      i += 1;
      while (!endsStatement(buf[buf.length - 1]!)) {
        if (i >= n) break;
        buf.push(lines[i]!);
        i += 1;
      }
      if (!name) continue;
      const joined = buf.join("\n").trim();
      const upperIdx = joined.toUpperCase().indexOf(" VALUES");
      if (upperIdx === -1) continue;
      let payload = joined.substring(upperIdx + " VALUES".length).trimEnd();
      if (payload.endsWith(";")) payload = payload.slice(0, -1);
      try {
        const rows = [...parseValues(payload)];
        if (rows.length > 0) ensure(name).rows.push(...rows);
      } catch {
        // Skip a malformed INSERT; the table still surfaces from its CREATE.
      }
      continue;
    }
    i += 1;
  }

  return { tables: order.map((name) => tables.get(name)!) };
}

/* ---- per-column statistics (pure, unit-tested) --------------------------- */

export type ColumnStats = {
  nullCount: number;
  distinctCount: number;
  distinctCapped: boolean;
  minText: string | null;
  maxText: string | null;
  sampleValues: Array<string | number | boolean | null>;
};

/** Distinct values are tracked up to this cap per column to bound memory. */
const DISTINCT_CAP = 5000;
const SAMPLE_SIZE = 8;

function compareCells(a: Cell, b: Cell): number {
  const an = typeof a === "number" ? a : Number(a);
  const bn = typeof b === "number" ? b : Number(b);
  if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

/**
 * Compute cheap value statistics for one column across all parsed rows.
 * `colIndex` is the column's position in the row tuples.
 */
export function summarizeColumn(rows: Row[], colIndex: number): ColumnStats {
  let nullCount = 0;
  const distinct = new Set<string>();
  let distinctCapped = false;
  let min: Cell = null;
  let max: Cell = null;
  let seenValue = false;
  const samples: Array<string | number | boolean | null> = [];
  const sampleSeen = new Set<string>();

  for (const row of rows) {
    const v = colIndex < row.length ? row[colIndex]! : null;
    if (v === null || v === undefined) {
      nullCount += 1;
      continue;
    }
    if (!distinctCapped) {
      const key = typeof v === "string" ? v : String(v);
      if (distinct.size < DISTINCT_CAP) {
        distinct.add(key);
      } else if (!distinct.has(key)) {
        distinctCapped = true;
      }
    }
    if (!seenValue) {
      min = v;
      max = v;
      seenValue = true;
    } else {
      if (compareCells(v, min) < 0) min = v;
      if (compareCells(v, max) > 0) max = v;
    }
    if (samples.length < SAMPLE_SIZE) {
      const sk = typeof v === "string" ? v : String(v);
      if (!sampleSeen.has(sk)) {
        sampleSeen.add(sk);
        samples.push(v);
      }
    }
  }

  return {
    nullCount,
    distinctCount: distinct.size,
    distinctCapped,
    minText: min === null ? null : String(min),
    maxText: max === null ? null : String(max),
    sampleValues: samples,
  };
}

/** Map a parsed row tuple to a JSONB-ready object keyed by column name. */
export function rowToObject(columns: ArchiveColumn[], row: Row): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (let idx = 0; idx < columns.length; idx += 1) {
    out[columns[idx]!.name] = idx < row.length ? row[idx]! : null;
  }
  return out;
}

/** Lowercased concatenation of a row's non-null values for ILIKE search. */
export function buildSearchText(row: Row, maxLen = 8000): string {
  const parts: string[] = [];
  for (const v of row) {
    if (v === null || v === undefined) continue;
    parts.push(typeof v === "string" ? v : String(v));
  }
  const joined = parts.join(" ").toLowerCase();
  return joined.length > maxLen ? joined.slice(0, maxLen) : joined;
}
