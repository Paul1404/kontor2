/**
 * Tiny structured logger for the runtime entrypoint and preflight. Mirrors
 * src/server/lib/logger.ts but is self-contained (no `~/` imports) so it runs
 * in the slim production container that ships only dist/, scripts/ and
 * node_modules. Emits single-line JSON shaped for Railway in production (it
 * keys off `level` and `message`; other fields are searchable attributes) and
 * a readable line in development.
 */
type Level = "info" | "warn" | "error";
type Fields = Record<string, unknown>;

function emit(level: Level, message: string, fields?: Fields): void {
  const sink = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  if (process.env.NODE_ENV === "production") {
    sink(JSON.stringify({ ...fields, level, message }));
    return;
  }
  const extra = fields && Object.keys(fields).length > 0 ? ` ${JSON.stringify(fields)}` : "";
  sink(`[${level}] ${message}${extra}`);
}

export const log = {
  info: (message: string, fields?: Fields) => emit("info", message, fields),
  warn: (message: string, fields?: Fields) => emit("warn", message, fields),
  error: (message: string, fields?: Fields) => emit("error", message, fields),
};
