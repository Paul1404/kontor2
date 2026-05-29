/**
 * Minimal structured logger. No external dependency, no transport: it writes
 * one record per line to stdout/stderr. In production each record is a single
 * line of JSON shaped for Railway's log parser, which keys off `level`
 * (debug | info | warn | error) and `message` and treats every other field as
 * a filterable attribute. Railway stamps its own ingest time, so we don't emit
 * a timestamp. In development the same data is printed as a short readable
 * line instead.
 *
 * Rules (see CLAUDE.md "Logging"):
 * - three levels only: info, warn, error
 * - never log secrets. Sensitive field names are redacted recursively.
 * - LOG_LEVEL env (info | warn | error) raises the floor; defaults to info.
 */

export type LogLevel = "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

const RANK: Record<LogLevel, number> = { info: 10, warn: 20, error: 30 };

function minLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL ?? "").toLowerCase();
  return raw === "warn" || raw === "error" ? raw : "info";
}

/**
 * Field names whose values must never appear in a log line. Matched
 * case-insensitively as a substring, so `databaseUrl`, `APP_SECRET` and
 * `member.iban1` are all caught.
 */
const SENSITIVE_KEY =
  /(pass(word)?|secret|token|iban|bic|authorization|cookie|credential|api[-_]?key|private[-_]?key|connection[-_]?string|database[-_]?url|redis[-_]?url)/i;

const REDACTED = "[redacted]";

export function redactFields(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] = redactValue(key, value);
  }
  return out;
}

function redactValue(key: string, value: unknown): unknown {
  if (SENSITIVE_KEY.test(key)) return REDACTED;
  if (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  ) {
    return redactFields(value as LogFields);
  }
  return value;
}

function emit(level: LogLevel, msg: string, fields?: LogFields): void {
  if (RANK[level] < RANK[minLevel()]) return;
  const safe = fields ? redactFields(fields) : undefined;
  const sink = level === "error" ? console.error : level === "warn" ? console.warn : console.log;

  if (process.env.NODE_ENV === "production") {
    // Railway keys off `level` and `message`; remaining fields become
    // searchable attributes. Spread first so the real level/message can't be
    // shadowed by a same-named field. Single line, no embedded newlines.
    sink(JSON.stringify({ ...safe, level, message: msg }));
    return;
  }
  const extra = safe && Object.keys(safe).length > 0 ? ` ${JSON.stringify(safe)}` : "";
  sink(`[${level}] ${msg}${extra}`);
}

export const logger = {
  info: (msg: string, fields?: LogFields) => emit("info", msg, fields),
  warn: (msg: string, fields?: LogFields) => emit("warn", msg, fields),
  error: (msg: string, fields?: LogFields) => emit("error", msg, fields),
};
