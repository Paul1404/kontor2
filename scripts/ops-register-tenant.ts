#!/usr/bin/env bun
/**
 * Ops-Helfer: trägt einen bestehenden Verein in die `tenants`-Registry der
 * CONTROL-Datenbank ein (upsert), ohne DB-Anlage/Migration. Für den Übergang,
 * um SVU + verein2 aus DATABASE_URL/TENANTS_JSON in die Control-DB zu heben.
 *
 *   railway run -s kontor2-postgres bun scripts/ops-register-tenant.ts \
 *     --key=verein2 --db=verein2 --name="Verein 2"
 *
 * Verbindet sich mit der Control-DB (DATABASE_PUBLIC_URL, Pfad -> /<controldb>,
 * Default "control"). Klartext database_name, kein APP_SECRET nötig.
 */
import postgres from "postgres";

function arg(n: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
}

const key = arg("key");
const db = arg("db") ?? key;
const name = arg("name") ?? key;
const controlDbName = arg("controldb") ?? "control";
if (!key || !db) {
  console.error("[ops] --key und --db erforderlich");
  process.exit(1);
}

const baseRaw = process.env.DATABASE_PUBLIC_URL ?? process.env.DATABASE_URL;
if (!baseRaw) {
  console.error("[ops] keine DATABASE_(PUBLIC_)URL");
  process.exit(1);
}
const u = new URL(baseRaw);
u.pathname = `/${controlDbName}`;

const sql = postgres(u.toString(), { max: 1, onnotice: () => {} });
try {
  await sql`
    insert into tenants (key, database_name, display_name, status)
    values (${key}, ${db}, ${name}, 'active')
    on conflict (key) do update
      set database_name = excluded.database_name,
          display_name = excluded.display_name,
          status = 'active',
          updated_at = now()
  `;
  console.log(`[ops] Verein "${key}" -> db "${db}" in Control-DB "${controlDbName}" registriert.`);
} finally {
  await sql.end();
}
