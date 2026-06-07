/**
 * Escape LIKE / ILIKE wildcards in user-supplied search text so a query like
 * "50%" or "a_b" matches the literal characters instead of being treated as a
 * pattern (`%` = any run, `_` = any single char). Postgres uses backslash as
 * the default LIKE escape character, so no explicit ESCAPE clause is needed.
 *
 * Wrap the result with the wildcards you actually want, e.g.
 * `` `%${escapeLike(q)}%` ``.
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}
