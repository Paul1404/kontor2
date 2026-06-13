#!/usr/bin/env bun
/**
 * Ops-Helfer: legt eine leere Datenbank in der Postgres-Instanz an (idempotent).
 * Gedacht für `railway run -s kontor2-postgres bun scripts/ops-create-database.ts --name=control`
 * (nutzt DATABASE_PUBLIC_URL, vom Laptop erreichbar). Migriert NICHT -- das macht
 * `migrate-all` beim nächsten Deploy. Kein APP_SECRET nötig.
 */
import postgres from "postgres";

const name = process.argv.find((a) => a.startsWith("--name="))?.slice("--name=".length);
if (!name || !/^[a-z0-9_]+$/.test(name)) {
  console.error("[ops] --name=<a-z0-9_> erforderlich");
  process.exit(1);
}
const base = process.env.DATABASE_PUBLIC_URL ?? process.env.DATABASE_URL;
if (!base) {
  console.error("[ops] keine DATABASE_(PUBLIC_)URL");
  process.exit(1);
}

const sql = postgres(base, { max: 1, onnotice: () => {} });
try {
  await sql.unsafe(`CREATE DATABASE "${name}"`);
  console.log(`[ops] Datenbank "${name}" angelegt.`);
} catch (e) {
  if ((e as { code?: string }).code === "42P04") console.log(`[ops] "${name}" existiert bereits.`);
  else throw e;
} finally {
  await sql.end();
}
