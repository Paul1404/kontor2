import { AsyncLocalStorage } from "node:async_hooks";
import type { Keyring } from "~/server/crypto/encrypt";

/**
 * Aktiver Verschlüsselungs-Keyring des laufenden Requests/Jobs, getragen über
 * AsyncLocalStorage. Damit kann der kontextlose `encryptedText`-Customtype
 * (bzw. `encryptString`/`safeDecrypt`) den richtigen Per-Verein-Schlüssel
 * wählen, ohne dass er den Mandanten kennt.
 *
 * Ist KEIN aktiver Keyring gesetzt, fällt `keyring()` (in encrypt.ts) auf den
 * primären `env().encryptionKeyring` zurück -- das deckt den Primär-Verein,
 * Skripte und den (primär-only) Snapshot-Scheduler ab.
 *
 * WICHTIG: Jeder Tenant-Eintrittspunkt MUSS seinen Block in `runWithKeyring`
 * (bzw. `runWithTenantKeyring`) hüllen, BEVOR verschlüsselte Felder eines
 * Nicht-Primär-Vereins gelesen oder geschrieben werden. Fehlt der Wrapper, liest
 * der Default-(Primär-)Keyring fremde Daten nicht entschlüsseln können -> sie
 * kommen als leerer String zurück (siehe `safeDecrypt`). Neue Routen daher
 * immer über die zentralen Helfer (`runWithTenantKeyring`/`withTenantCrypto`).
 */
const activeKeyringStore = new AsyncLocalStorage<Keyring>();

/** Führt `fn` (inkl. aller awaits darin) mit `ring` als aktivem Keyring aus. */
export function runWithKeyring<T>(ring: Keyring, fn: () => T): T {
  return activeKeyringStore.run(ring, fn);
}

/** Der aktuell gesetzte Keyring, oder `undefined` außerhalb eines run-Blocks. */
export function activeKeyring(): Keyring | undefined {
  return activeKeyringStore.getStore();
}
