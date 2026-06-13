#!/usr/bin/env bun
/**
 * Mandanten-Restore: spielt einen `pg_dump` (Custom-Format) in eine Ziel-DB ein.
 * Gegenstück zu scripts/backup.ts -- z. B. um den SVU-Stand woanders
 * hochzuziehen oder ein Backup zurückzuspielen.
 *
 *   bun scripts/restore.ts --from=./backups/svu-20260612-163045.dump --to=svu --yes
 *   bun scripts/restore.ts --from=./bk.dump --to="postgres://…/verein_b" --yes
 *   bun scripts/restore.ts --from=s3:backups/svu/svu-….dump --to=verein_b --yes
 *   …--clean   # bestehende Objekte vorher droppen (--clean --if-exists)
 *
 * --to ist entweder ein Mandanten-Schlüssel (aus der Registry) oder eine volle
 * Postgres-URL. Die Ziel-Datenbank muss bereits existieren (vorher
 * `CREATE DATABASE …`). Ohne --yes passiert nichts (Restore ist destruktiv).
 *
 * WICHTIG: Verschlüsselte Felder (IBAN etc.) sind nur lesbar, wenn die
 * Zielinstanz denselben Verschlüsselungs-Schlüssel nutzt wie die Quelle.
 */
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadTenants } from "~/server/tenants/load";
import { listTenants } from "~/server/tenants/registry";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function resolveTargetUrl(to: string): string {
  if (to.includes("://")) return to;
  const t = listTenants().find((x) => x.key === to);
  if (!t) {
    throw new Error(`--to: weder Mandant noch URL: "${to}".`);
  }
  return t.databaseUrl;
}

/** Lädt `s3:<key>` in eine temporäre Datei und gibt deren Pfad zurück. */
async function fetchSource(from: string): Promise<string> {
  if (!from.startsWith("s3:")) {
    if (!existsSync(from)) throw new Error(`Datei nicht gefunden: ${from}`);
    return from;
  }
  const key = from.slice(3);
  const { getObject } = await import("~/server/s3/client");
  const body = await getObject(key);
  const dir = mkdtempSync(join(tmpdir(), "restore-"));
  const file = join(dir, key.split("/").pop() ?? "backup.dump");
  writeFileSync(file, body);
  return file;
}

async function main() {
  const from = arg("from");
  const to = arg("to");
  if (!from || !to) {
    console.error("[restore] --from=<datei|s3:key> und --to=<mandant|url> erforderlich.");
    process.exit(1);
  }
  // Control-Plane-Vereine laden, damit `--to=<schlüssel>` auch Tabellen-Vereine trifft.
  await loadTenants();
  const targetUrl = resolveTargetUrl(to);
  const file = await fetchSource(from);

  if (!flag("yes")) {
    console.error(
      `[restore] Würde "${file}" in ${to} einspielen. Das überschreibt Daten. Mit --yes ausführen.`,
    );
    process.exit(1);
  }

  const cmd = [
    "pg_restore",
    "--no-owner",
    "--no-privileges",
    ...(flag("clean") ? ["--clean", "--if-exists"] : []),
    "-d",
    targetUrl,
    file,
  ];
  console.log(`[restore] ${file} -> ${to}`);
  const proc = Bun.spawnSync(cmd, { stderr: "inherit", stdout: "inherit" });
  if (proc.exitCode !== 0) {
    throw new Error(`pg_restore fehlgeschlagen (Code ${proc.exitCode}).`);
  }
  console.log("[restore] fertig.");
  console.log(
    "[restore] Hinweis: Verschlüsselte Felder sind nur mit demselben Schlüssel wie die Quelle lesbar.",
  );
}

main().catch((e) => {
  console.error("[restore] Fehler:", (e as Error).message);
  process.exit(1);
});
