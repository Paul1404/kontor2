#!/usr/bin/env bun
/**
 * CLI zum Provisionieren/Entfernen eines Vereins (Control-Plane C2a). Dünne Hülle
 * um `~/server/tenants/provision` -- die eigentliche Logik (CREATE DATABASE +
 * Migrationen + tenants-Zeile) lebt dort und wird auch im Integrationstest geprüft.
 *
 *   bun scripts/provision-tenant.ts --key=verein3 --name="Verein Drei"
 *   bun scripts/provision-tenant.ts --key=verein3 --name="…" --db=verein3
 *   bun scripts/provision-tenant.ts --key=verein3 --drop   # entfernen (DB + Zeile)
 *
 * Lauf-Kontext: `railway run -s kontor2-postgres bun scripts/provision-tenant.ts …`,
 * damit DATABASE_PUBLIC_URL (vom Laptop erreichbar) im Prozess landet. Es wird
 * KEIN APP_SECRET gebraucht (DB-Identität = Klartext database_name). Danach löst
 * `<key>.<PRODUCT_DOMAIN>` nach Cache-TTL (~60s) auf den neuen Verein auf; /setup
 * legt dessen Admin an.
 */
import { deprovisionTenant, provisionTenant } from "~/server/tenants/provision";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function adminUrl(): string {
  const url = process.env.DATABASE_PUBLIC_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("Weder DATABASE_PUBLIC_URL noch DATABASE_URL gesetzt.");
  return url;
}

async function main() {
  const key = arg("key");
  const name = arg("name");
  const databaseName = arg("db");
  const primaryKey = process.env.PRIMARY_TENANT_KEY ?? "svu";
  if (!key) {
    console.error("[provision] --key=<schlüssel> erforderlich.");
    process.exit(1);
  }

  if (flag("drop")) {
    await deprovisionTenant(adminUrl(), { key, databaseName });
    console.log(`[provision] "${key}" entfernt (tenants-Zeile + DB).`);
    return;
  }

  if (!name) {
    console.error("[provision] --name=<Anzeigename> erforderlich.");
    process.exit(1);
  }
  const result = await provisionTenant(adminUrl(), {
    key,
    displayName: name,
    databaseName,
    primaryKey,
  });
  console.log(
    `[provision] "${key}" fertig. <${key}>.<PRODUCT_DOMAIN> löst nach Cache-TTL (~60s) auf; /setup legt den Admin mit dem einmaligen Setup-Code an.`,
  );
  console.log(`[provision] Einmaliger Setup-Code: ${result.bootstrapToken}`);
}

main().catch((e) => {
  console.error("[provision] Fehler:", (e as Error).message);
  process.exit(1);
});
