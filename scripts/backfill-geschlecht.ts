#!/usr/bin/env bun
/**
 * Backfill: derive `members.geschlecht` from the Anrede. Mirrors
 * `deriveGeschlecht`: Herr -> m, Frau -> w, Divers -> d; an Anrede that is not
 * a clear marker is left as-is (honest gap).
 *
 * Covers two cases:
 *   - rows that never had the column set (`geschlecht is null`), and
 *   - rows that an early migration set to 'unbekannt' with a blunt rule (only
 *     an exact "Herr"/"Frau" matched), so a clear "Hr.", "Frau Dr." etc. is now
 *     corrected on a re-run.
 *
 * Non-destructive: it only ever moves null/'unbekannt' to a confident m/w/d and
 * never overwrites an existing m/w/d, so a value a Vorstand set by hand stays.
 * Idempotent and safe to re-run.
 *
 *   bun run db:backfill:geschlecht
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("[backfill-geschlecht] DATABASE_URL is not set");
    process.exit(1);
  }
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  const db = drizzle(sql);
  try {
    const male = await db.execute(sql`
      update members set geschlecht = 'm', updated_at = now()
      where (geschlecht is null or geschlecht = 'unbekannt')
        and (lower(btrim(anrede)) in ('herr', 'hr', 'hr.', 'herrn')
             or lower(btrim(anrede)) like 'herr %')
    `);
    const female = await db.execute(sql`
      update members set geschlecht = 'w', updated_at = now()
      where (geschlecht is null or geschlecht = 'unbekannt')
        and (lower(btrim(anrede)) in ('frau', 'fr', 'fr.')
             or lower(btrim(anrede)) like 'frau %')
    `);
    const diverse = await db.execute(sql`
      update members set geschlecht = 'd', updated_at = now()
      where (geschlecht is null or geschlecht = 'unbekannt')
        and lower(btrim(anrede)) = 'divers'
    `);
    const rest = await db.execute(sql`
      select count(*)::int as c from members
      where (geschlecht is null or geschlecht = 'unbekannt') and deleted_at is null
    `);
    const count = (n: unknown) => (n as { count?: number }).count ?? 0;
    console.log(
      `[backfill-geschlecht] männlich=${count(male)} weiblich=${count(female)} divers=${count(diverse)} ` +
        `· ohne Zuordnung (Anrede nicht eindeutig)=${(rest as unknown as Array<{ c: number }>)[0]?.c ?? 0}`,
    );
  } catch (err) {
    console.error("[backfill-geschlecht] failed:", (err as Error).message);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

main();
