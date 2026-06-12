#!/usr/bin/env bun
/**
 * Schlüsselrotation: schreibt jede verschlüsselte Spalte auf den aktuellen
 * Keyring-Schlüssel um und meldet, ob der/die Vorgänger-Schlüssel jetzt
 * gefahrlos entfernt werden können. CLI-Pendant zur Admin-Aktion
 * `settings.reencryptData`; nützlich, um einen Lauf gegen Prod ohne UI zu
 * fahren (mit injizierter Prod-Env):
 *
 *   railway run bun run db:reencrypt
 *
 * Idempotent: Zeilen, die schon auf dem aktuellen Schlüssel liegen, werden
 * übersprungen. Schlägt eine Zeile fehl (kein passender Schlüssel im Ring),
 * wird sie gemeldet und unangetastet gelassen -- dann den fehlenden Schlüssel
 * zu APP_SECRET_PREV geben und erneut laufen lassen.
 *
 * WICHTIG: Den alten Schlüssel erst entfernen, wenn die Schranke unten
 * `safe = true` meldet (siehe docs/key-rotation.md).
 */
import { assessKeyDropSafety, reencryptAllData } from "~/server/crypto/reencrypt";
import { db } from "~/server/db/client";

async function main(): Promise<void> {
  const handle = db();
  console.log("[reencrypt] Umschlüsselung auf den aktuellen Schlüssel …");

  const reports = await reencryptAllData(handle);
  let failed = 0;
  for (const r of reports) {
    console.log(
      `[reencrypt] ${r.table}.${r.column}: gescannt=${r.scanned} umgeschrieben=${r.rewritten} ` +
        `uebersprungen=${r.skippedAlreadyCurrent} fehlgeschlagen=${r.failed}`,
    );
    if (r.failedIds.length > 0) {
      console.log(`[reencrypt]   fehlgeschlagene ids: ${r.failedIds.join(", ")}`);
    }
    failed += r.failed;
  }

  const safety = await assessKeyDropSafety(handle);
  console.log(
    `[reencrypt] Schranke: safe=${safety.safe} zeilenNichtAufAktuellemSchluessel=${safety.rowsNotOnCurrentKey}`,
  );
  if (safety.safe) {
    console.log(
      "[reencrypt] Alle Daten auf dem aktuellen Schlüssel. Der Vorgänger darf jetzt weg.",
    );
  } else {
    console.log(
      "[reencrypt] NOCH NICHT sicher, den alten Schlüssel zu entfernen -- erst alle Zeilen umschlüsseln.",
    );
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("[reencrypt] Fehler:", (e as Error).message);
  process.exit(1);
});
