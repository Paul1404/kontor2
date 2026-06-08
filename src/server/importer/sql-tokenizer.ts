/**
 * Parser for MySQL dumps produced by Linear Webverein.
 * Ported 1:1 from SVUMS `app/services/sql_import.py` (the algorithm is
 * deliberately linear, no regex backtracking — a single mysqldump INSERT
 * line can be many megabytes long).
 */

export type Cell = string | number | boolean | null;
export type Row = Cell[];

export const SUPPORTED_TABLES = new Set([
  "adresse",
  "mgart",
  "mgvert",
  "adrsepa",
  "verkn",
  "inter",
  "interes",
  // Phase 2: historical / lookup tables surfaced for archival + reporting.
  "mgsolln",
  "mgartdat",
  "sportarten",
  "fachverbaende",
  "lastprot",
  "lastproth",
  "lastprots",
  "lastprotsh",
]);

const ESCAPES: Record<string, string> = {
  n: "\n",
  t: "\t",
  r: "\r",
  "0": "\x00",
  b: "\b",
  Z: "\x1a",
  "\\": "\\",
  "'": "'",
  '"': '"',
};

function parseString(text: string, pos: number): { value: string; next: number } {
  if (text[pos] !== "'") {
    throw new Error(`Expected ' at ${pos}`);
  }
  const out: string[] = [];
  let i = pos + 1;
  const n = text.length;
  while (i < n) {
    const ch = text[i]!;
    if (ch === "\\" && i + 1 < n) {
      const esc = text[i + 1]!;
      out.push(ESCAPES[esc] ?? esc);
      i += 2;
      continue;
    }
    if (ch === "'") {
      if (i + 1 < n && text[i + 1] === "'") {
        out.push("'");
        i += 2;
        continue;
      }
      return { value: out.join(""), next: i + 1 };
    }
    out.push(ch);
    i += 1;
  }
  throw new Error("Unterminated string literal in SQL dump");
}

function isWhitespace(ch: string | undefined): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f" || ch === "\v";
}

export function* parseValues(payload: string): IterableIterator<Row> {
  const n = payload.length;
  let i = 0;
  while (i < n) {
    const ch = payload[i]!;
    if (isWhitespace(ch) || ch === ",") {
      i += 1;
      continue;
    }
    if (ch !== "(") break;
    i += 1;
    const row: Row = [];
    // Read values until matching ')'
    while (true) {
      while (i < n && isWhitespace(payload[i])) i += 1;
      if (i >= n) throw new Error("Unterminated tuple in SQL dump");
      const c = payload[i]!;
      if (c === ")") {
        i += 1;
        break;
      }
      if (c === ",") {
        i += 1;
        continue;
      }
      if (c === "'") {
        const r = parseString(payload, i);
        row.push(r.value);
        i = r.next;
        continue;
      }
      if ((c === "N" || c === "n") && payload.substr(i, 4).toUpperCase() === "NULL") {
        row.push(null);
        i += 4;
        continue;
      }
      // _binary 'x' literal for bit(N) columns. True iff any byte is non-zero.
      if (c === "_" && payload.substr(i, 8).toLowerCase() === "_binary ") {
        let j = i + 8;
        while (j < n && isWhitespace(payload[j])) j += 1;
        if (j < n && payload[j] === "'") {
          const r = parseString(payload, j);
          row.push([...r.value].some((ch) => ch.charCodeAt(0) !== 0));
          i = r.next;
          continue;
        }
      }
      // b'...' bit literal (alternative form)
      if (c === "b" && payload[i + 1] === "'") {
        const r = parseString(payload, i + 1);
        row.push([...r.value].some((c2) => c2 !== "0"));
        i = r.next;
        continue;
      }
      // Numeric / keyword
      let j = i;
      while (j < n && payload[j] !== "," && payload[j] !== ")") j += 1;
      const token = payload.substring(i, j).trim();
      i = j;
      if (!token) {
        row.push(null);
        continue;
      }
      const upper = token.toUpperCase();
      if (upper === "TRUE") {
        row.push(true);
        continue;
      }
      if (upper === "FALSE") {
        row.push(false);
        continue;
      }
      const asNum = Number(token);
      if (Number.isFinite(asNum) && /^-?[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?$/.test(token)) {
        row.push(asNum);
        continue;
      }
      row.push(token);
    }
    yield row;
  }
}

/**
 * Extract the ordered column names out of a CREATE TABLE body. Splits the
 * top-level (depth-0) parenthesised body on commas and treats each fragment
 * whose first token is a backticked identifier as a column. Stops at the
 * first index / constraint clause.
 */
export function extractColumns(createSql: string): string[] {
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
  if (buf && fragments.length === 0) fragments.push(buf);

  const cols: string[] = [];
  for (const frag of fragments) {
    const f = frag.trim();
    if (!f) continue;
    const u = f.toUpperCase();
    if (
      u.startsWith("PRIMARY KEY") ||
      u.startsWith("KEY ") ||
      u.startsWith("UNIQUE KEY") ||
      u.startsWith("CONSTRAINT") ||
      u.startsWith("FULLTEXT") ||
      u.startsWith("INDEX")
    ) {
      break;
    }
    if (f.startsWith("`")) {
      const end = f.indexOf("`", 1);
      if (end > 1) cols.push(f.substring(1, end));
    }
  }
  return cols;
}

export type ParsedDump = {
  columns: Record<string, string[]>;
  rows: Record<string, Row[]>;
};

function parseTableName(stmt: string): string {
  const start = stmt.indexOf("`");
  if (start === -1) return "";
  const end = stmt.indexOf("`", start + 1);
  if (end === -1) return "";
  return stmt.substring(start + 1, end);
}

function endsStatement(line: string): boolean {
  return line.trimEnd().endsWith(";");
}

export function parseDump(text: string, supported: Set<string> = SUPPORTED_TABLES): ParsedDump {
  const out: ParsedDump = { columns: {}, rows: {} };
  const lines = text.split(/\r?\n/);
  const n = lines.length;
  let i = 0;
  while (i < n) {
    const line = lines[i]!;
    const stripped = line.replace(/^\s+/, "");

    if (stripped.startsWith("CREATE TABLE")) {
      const table = parseTableName(stripped);
      const buf = [stripped];
      while (!endsStatement(buf[buf.length - 1]!)) {
        i += 1;
        if (i >= n) break;
        buf.push(lines[i]!);
      }
      i += 1;
      if (supported.has(table)) {
        const cols = extractColumns(buf.join("\n"));
        if (cols.length > 0) {
          out.columns[table] = cols;
          out.rows[table] ??= [];
        }
      }
      continue;
    }

    if (stripped.startsWith("INSERT INTO")) {
      const table = parseTableName(stripped);
      if (!supported.has(table)) {
        while (i < n && !endsStatement(lines[i]!)) i += 1;
        i += 1;
        continue;
      }
      const buf = [stripped];
      i += 1;
      while (!endsStatement(buf[buf.length - 1]!)) {
        if (i >= n) break;
        buf.push(lines[i]!);
        i += 1;
      }
      const joined = buf.join("\n").trim();
      const upperIdx = joined.toUpperCase().indexOf(" VALUES");
      if (upperIdx === -1) continue;
      let payload = joined.substring(upperIdx + " VALUES".length).trimEnd();
      if (payload.endsWith(";")) payload = payload.slice(0, -1);
      try {
        const rows = [...parseValues(payload)];
        if (rows.length > 0) {
          const existing = out.rows[table];
          if (existing) existing.push(...rows);
          else out.rows[table] = rows;
        }
      } catch (err) {
        if (process.env.NODE_ENV !== "production") {
          console.warn(
            `[importer] skipping malformed INSERT for ${table}: ${(err as Error).message}`,
          );
        }
      }
      continue;
    }
    i += 1;
  }
  return out;
}

/* ---- value coercion helpers (mirror SVUMS coerce_*) ----------------------- */

export function coerceStr(value: Cell, maxLen?: number): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s) return null;
  return maxLen !== undefined && s.length > maxLen ? s.slice(0, maxLen) : s;
}

export function coerceInt(value: Cell): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number") return Number.isFinite(value) ? Math.trunc(value) : null;
  const s = String(value).trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

export function coerceBool(value: Cell): boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const v = String(value).trim().toLowerCase();
  if (v === "" || v === "n" || v === "false" || v === "0") return false;
  if (v === "y" || v === "j" || v === "true" || v === "1") return true;
  return null;
}

export function coerceDecimal(value: Cell): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  let s = String(value).trim();
  if (!s) return null;
  // Normalise German number formatting. With both separators present, '.'
  // is the thousands separator and ',' the decimal ("1.234,56" -> "1234.56").
  // With only a comma, the comma is the decimal point ("5,50" -> "5.50").
  // The previous `replace(",", ".")` only swapped the first comma, turning
  // "1.234,56" into the un-parseable "1.234.56" and silently dropping the
  // amount.
  if (s.includes(",")) {
    if (s.includes(".")) s = s.replace(/\./g, "");
    s = s.replace(",", ".");
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) {
    // No comma but a clean thousands grouping ("1.234", "1.234.567"): the dots
    // are groupers, not a decimal point, so "1.234" is 1234 not 1.234. A lone
    // "1.23" (two trailing digits) is left as a decimal.
    s = s.replace(/\./g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) ? String(n) : null;
}

const DATE_FORMATS = [
  /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?$/,
  /^(\d{4})-(\d{2})-(\d{2})$/,
];

// MySQL TIME columns (e.g. `And_Zeit`) dump as bare 'HH:MM:SS'. We
// anchor them to the Unix epoch so the time-of-day part survives,
// instead of being silently nulled by the date regexes above.
const TIME_FORMAT = /^(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?$/;

export function coerceDate(value: Cell | Date): Date | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "object" && value !== null && "getTime" in (value as object)) {
    const d = value as Date;
    return Number.isFinite(d.getTime()) ? d : null;
  }
  const s = String(value).trim();
  if (!s || s.startsWith("0000")) return null;
  for (const re of DATE_FORMATS) {
    const m = re.exec(s);
    if (m) {
      const [, y, mo, d, hh = "0", mm = "0", ss = "0"] = m;
      const dt = new Date(
        Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mm), Number(ss)),
      );
      return Number.isFinite(dt.getTime()) ? dt : null;
    }
  }
  const tm = TIME_FORMAT.exec(s);
  if (tm) {
    const [, hh, mm, ss] = tm;
    const dt = new Date(Date.UTC(1970, 0, 1, Number(hh), Number(mm), Number(ss)));
    return Number.isFinite(dt.getTime()) ? dt : null;
  }
  return null;
}

export function rowToDict(columns: string[], row: Row): Record<string, Cell> {
  const out: Record<string, Cell> = {};
  for (let idx = 0; idx < columns.length; idx += 1) {
    out[columns[idx]!] = idx < row.length ? row[idx]! : null;
  }
  return out;
}
