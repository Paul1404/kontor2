/**
 * Structured logger with a small sink architecture.
 *
 * Every log call builds one immutable `LogRecord` (timestamp, level, message,
 * redacted fields) and hands it to each registered sink. The built-in console
 * sink writes one line per record: single-line JSON in production (shaped for
 * Railway's log parser, which keys off `level` and `message` and treats every
 * other field as a searchable attribute), and a short readable line in
 * development. Railway stamps its own ingest time, so the console sink omits
 * the timestamp in production.
 *
 * Additional sinks can be attached at runtime via `registerSink` -- the app
 * registers a buffered Postgres sink (see `log-sink-db.ts`) so the in-app
 * "Systemprotokoll" viewer can read recent logs. The core stays dependency
 * free: it never imports the database, so it can be used from any server file
 * without dragging server-only modules into a hot path or the client bundle.
 *
 * Rules (see CLAUDE.md "Logging"):
 * - three levels only: info, warn, error
 * - never log secrets. Sensitive field names are redacted recursively.
 * - LOG_LEVEL env (info | warn | error) raises the console floor; defaults to
 *   info. A sink may set its own, lower floor (e.g. to persist warnings only).
 */

export type LogLevel = "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

/** One emitted log line, after redaction. Passed to every sink. */
export type LogRecord = {
  /** When the record was created (sinks may buffer; this preserves order). */
  time: Date;
  level: LogLevel;
  message: string;
  /** Already redacted; safe to persist or print verbatim. */
  fields: LogFields;
};

/**
 * A destination for log records. `minLevel` lets a sink opt into a different
 * floor than the console (e.g. persist `warn`+ only). `flush` is awaited on
 * shutdown so buffered sinks can drain.
 */
export interface LogSink {
  name: string;
  minLevel?: LogLevel;
  write(record: LogRecord): void;
  flush?(): Promise<void> | void;
}

const RANK: Record<LogLevel, number> = { info: 10, warn: 20, error: 30 };

/** Console floor from LOG_LEVEL; also the default floor for sinks that omit one. */
function consoleFloor(): LogLevel {
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

/** The built-in sink: writes to stdout/stderr, shaped for Railway in prod. */
const consoleSink: LogSink = {
  name: "console",
  write(record) {
    const sink =
      record.level === "error"
        ? console.error
        : record.level === "warn"
          ? console.warn
          : console.log;
    if (process.env.NODE_ENV === "production") {
      // Spread fields first so the real level/message can't be shadowed by a
      // same-named field. Single line, no embedded newlines, no timestamp.
      sink(JSON.stringify({ ...record.fields, level: record.level, message: record.message }));
      return;
    }
    const extra = Object.keys(record.fields).length > 0 ? ` ${JSON.stringify(record.fields)}` : "";
    sink(`[${record.level}] ${record.message}${extra}`);
  },
};

const extraSinks: LogSink[] = [];

/**
 * Attach a sink. Returns an unregister function. A sink with the same `name`
 * replaces the previous one, so re-registration (e.g. after a hot reload) is
 * idempotent.
 */
export function registerSink(sink: LogSink): () => void {
  const idx = extraSinks.findIndex((s) => s.name === sink.name);
  if (idx >= 0) extraSinks.splice(idx, 1);
  extraSinks.push(sink);
  return () => unregisterSink(sink.name);
}

export function unregisterSink(name: string): void {
  const idx = extraSinks.findIndex((s) => s.name === name);
  if (idx >= 0) extraSinks.splice(idx, 1);
}

function floorFor(sink: LogSink): number {
  return RANK[sink.minLevel ?? consoleFloor()];
}

/** Lowest floor across all sinks -- below it, no sink wants the record. */
function lowestFloor(): number {
  let floor = floorFor(consoleSink);
  for (const s of extraSinks) floor = Math.min(floor, floorFor(s));
  return floor;
}

function emit(level: LogLevel, message: string, fields: LogFields | undefined, bound: LogFields) {
  if (RANK[level] < lowestFloor()) return;
  const record: LogRecord = {
    time: new Date(),
    level,
    message,
    fields: redactFields(fields ? { ...bound, ...fields } : bound),
  };
  if (RANK[level] >= floorFor(consoleSink)) consoleSink.write(record);
  for (const sink of extraSinks) {
    if (RANK[level] < floorFor(sink)) continue;
    // A sink must never be able to break the caller. Its own failures are its
    // problem (the DB sink, for instance, drops to console.error on its own).
    try {
      sink.write(record);
    } catch {
      /* swallow: logging is best-effort */
    }
  }
}

export type Logger = {
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /** Derive a logger that stamps `fields` onto every record (e.g. requestId). */
  child(fields: LogFields): Logger;
};

function makeLogger(bound: LogFields): Logger {
  return {
    info: (message, fields) => emit("info", message, fields, bound),
    warn: (message, fields) => emit("warn", message, fields, bound),
    error: (message, fields) => emit("error", message, fields, bound),
    child: (fields) => makeLogger({ ...bound, ...fields }),
  };
}

export const logger: Logger = makeLogger({});

/** Drain every sink that buffers. Call on graceful shutdown. */
export async function flushSinks(): Promise<void> {
  await Promise.all(extraSinks.map((s) => (s.flush ? Promise.resolve(s.flush()) : undefined)));
}
