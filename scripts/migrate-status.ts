#!/usr/bin/env bun
/**
 * READ-ONLY Diagnose: zeigt pro Verein-DB, ob das Drizzle-Migrations-Journal
 * (`drizzle.__drizzle_migrations`) existiert und wie viele Migrationen darin
 * verbucht sind. Gibt KEINE Credentials aus -- nur Schlüssel + Zählerstand.
 *
 * Gedacht zum Lauf via `railway run bun scripts/migrate-status.ts`, damit die
 * Env (DATABASE_PUBLIC_URL etc.) im Prozess landet, nicht im Terminal.
 *
 * Verein-DBs werden aus DATABASE_PUBLIC_URL abgeleitet (Primär = dessen
 * db-Name; verein2 = derselbe Host/Port, db-Name `verein2`), so wie verein2
 * ursprünglich von Hand befüllt wurde.
 */
import postgres from "postgres";

function publicBase(): URL {
  const raw = process.env.DATABASE_PUBLIC_URL ?? process.env.DATABASE_URL;
  if (!raw) throw new Error("Weder DATABASE_PUBLIC_URL noch DATABASE_URL gesetzt.");
  return new URL(raw);
}

/** Baut eine URL auf dieselbe Instanz, aber mit anderem DB-Namen. */
function urlForDb(dbName: string): string {
  const u = publicBase();
  u.pathname = `/${dbName}`;
  return u.toString();
}

async function statusFor(label: string, url: string): Promise<void> {
  const sql = postgres(url, { max: 1, connect_timeout: 10, onnotice: () => {} });
  try {
    const exists =
      (await sql`select to_regclass('drizzle.__drizzle_migrations') as t`) as unknown as Array<{
        t: string | null;
      }>;
    if (!exists[0]?.t) {
      console.log(`[status] ${label}: KEIN drizzle-Journal (drizzle.__drizzle_migrations fehlt)`);
      return;
    }
    const rows = (await sql`
      select count(*)::int as n,
             max(created_at) as last
      from drizzle.__drizzle_migrations
    `) as unknown as Array<{ n: number; last: string | null }>;
    console.log(
      `[status] ${label}: ${rows[0]?.n ?? 0} Migration(en) verbucht, zuletzt ${rows[0]?.last ?? "?"}`,
    );
  } catch (err) {
    console.log(`[status] ${label}: Fehler -- ${(err as Error).message}`);
  } finally {
    await sql.end({ timeout: 3 });
  }
}

async function main() {
  const primaryDb = publicBase().pathname.replace(/^\//, "") || "railway";
  await statusFor(`primär (${primaryDb})`, urlForDb(primaryDb));
  await statusFor("verein2", urlForDb("verein2"));
}

main().catch((e) => {
  console.error("[status] Fehler:", (e as Error).message);
  process.exit(1);
});
