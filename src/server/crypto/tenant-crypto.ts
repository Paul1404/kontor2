import { runWithKeyring } from "~/server/crypto/active-keyring";
import { tenantEncryptionKeyring } from "~/server/env";

/**
 * Führt `fn` mit dem Per-Verein-Keyring des Mandanten `tenantKey` als aktivem
 * Keyring aus (inkl. aller awaits). Jeder Request-/Job-Eintrittspunkt, der
 * verschlüsselte Felder eines Vereins liest oder schreibt, MUSS seinen Block so
 * hüllen. Für den Primär ist es ein No-op-äquivalent (Primär-Ring = Default).
 */
export function runWithTenantKeyring<T>(tenantKey: string, fn: () => T): T {
  return runWithKeyring(tenantEncryptionKeyring(tenantKey), fn);
}
