/**
 * Retry a write that races on a generated unique key (e.g. "next sequence
 * number" inserts). On a Postgres unique-violation (SQLSTATE 23505) the
 * callback is re-run — a fresh transaction that re-reads the current max and
 * picks the next free value. Any other error propagates immediately.
 *
 * The callback MUST be self-contained (its own transaction) so each attempt
 * sees the committed state from the winning concurrent writer.
 */
const UNIQUE_VIOLATION = "23505";

/**
 * True only for a Postgres unique-violation (SQLSTATE 23505). Use this to tell
 * "row already exists" apart from any other DB error, so an insert failure for
 * an unrelated reason (connection drop, constraint, type error) is not
 * mislabelled as a duplicate.
 */
export function isUniqueViolation(e: unknown): boolean {
  const code =
    (e as { code?: string; cause?: { code?: string } }).code ??
    (e as { code?: string; cause?: { code?: string } }).cause?.code;
  return code === UNIQUE_VIOLATION;
}

export async function withUniqueRetry<T>(fn: () => Promise<T>, maxRetries = 5): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (!isUniqueViolation(e)) throw e;
    }
  }
  throw lastError;
}
