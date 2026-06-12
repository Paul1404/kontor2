#!/usr/bin/env bun
/**
 * Mandanten-Backup: zieht je Verein ein vollständiges `pg_dump` (Custom-Format,
 * komprimiert, mit `pg_restore` einspielbar). Lokal immer, optional zusätzlich
 * nach S3.
 *
 *   bun scripts/backup.ts                 # alle Mandanten -> ./backups
 *   bun scripts/backup.ts --tenant=svu    # nur svu
 *   bun scripts/backup.ts --s3            # zusätzlich nach S3 hochladen
 *   bun scripts/backup.ts --out=/tmp/bk   # anderes Zielverzeichnis
 *
 * Voraussetzung: `pg_dump` im PATH (lokal vorhanden; im schlanken App-Image
 * NICHT -- für einen automatischen Lauf einen Cron auf einem `postgres`-Image
 * nutzen oder von einer DB-fähigen Maschine starten, z. B. `railway run`).
 *
 * WICHTIG: IBANs, SMTP-Passwort etc. liegen verschlüsselt in der DB. Der Dump
 * enthält den Ciphertext -- beim Restore braucht die Zielinstanz denselben
 * `ENCRYPTION_KEYRING`/Schlüssel, sonst sind diese Felder unlesbar. Ein
 * vollständiges Backup = dieser Dump PLUS der Verschlüsselungs-Schlüssel.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { listTenants, resolveTenant, type Tenant } from "~/server/tenants/registry";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

/** YYYYMMDD-HHMMSS in UTC, ohne Sonderzeichen für Dateinamen. */
function stamp(): string {
  return new Date().toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
}

async function dumpTenant(t: Tenant, outDir: string, toS3: boolean): Promise<void> {
  const file = resolve(outDir, `${t.key}-${stamp()}.dump`);
  console.log(`[backup] ${t.key} -> ${file}`);
  const proc = Bun.spawnSync(
    ["pg_dump", t.databaseUrl, "-Fc", "--no-owner", "--no-privileges", "-f", file],
    { stderr: "inherit", stdout: "inherit" },
  );
  if (proc.exitCode !== 0) {
    throw new Error(`pg_dump für "${t.key}" fehlgeschlagen (Code ${proc.exitCode}).`);
  }
  const bytes = readFileSync(file).byteLength;
  console.log(`[backup] ${t.key}: ${(bytes / 1024 / 1024).toFixed(2)} MB`);

  if (toS3) {
    // Dynamischer Import: der S3-Client validiert die volle Env (AWS_*). Nur
    // laden, wenn wirklich hochgeladen wird, damit lokale Dumps ohne S3-Env gehen.
    const { putObject } = await import("~/server/s3/client");
    const key = `backups/${t.key}/${file.split("/").pop()}`;
    await putObject({
      key,
      body: readFileSync(file),
      contentType: "application/octet-stream",
    });
    console.log(`[backup] ${t.key}: nach S3 hochgeladen (${key})`);
  }
}

async function main() {
  const only = arg("tenant");
  const outDir = arg("out") ?? "./backups";
  const toS3 = flag("s3");
  mkdirSync(outDir, { recursive: true });

  const tenants = only ? [resolveTenant(only)] : listTenants();
  if (tenants.length === 0) {
    console.error("[backup] Keine Mandanten gefunden (DATABASE_URL gesetzt?).");
    process.exit(1);
  }

  for (const t of tenants) {
    await dumpTenant(t, outDir, toS3);
  }

  console.log(`[backup] fertig: ${tenants.length} Mandant(en).`);
  console.log(
    "[backup] Hinweis: Für den Restore braucht die Zielinstanz denselben Verschlüsselungs-Schlüssel.",
  );
}

main().catch((e) => {
  console.error("[backup] Fehler:", (e as Error).message);
  process.exit(1);
});
