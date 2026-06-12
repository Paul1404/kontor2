# Schlüsselrotation (verlustfrei)

Wie man den Verschlüsselungs-Schlüssel wechselt, ohne dass ein einziges
verschlüsseltes Feld (IBANs, SMTP-Passwort) unlesbar wird.

## Wie die Verschlüsselung aufgebaut ist

- Alle Geheimfelder liegen als `bytea` in der DB, geschrieben über den
  `encryptedText`-Typ (`src/server/db/types.ts`), AES-256-GCM.
- Das v2-Format stellt jedem Ciphertext einen **4-Byte-Fingerprint** des
  Schlüssels voran: `[VERSION=2][KEY_FP(4)][IV(12)][TAG(16)][CT]`.
- Der **Keyring** (`env().encryptionKeyring`) hat einen `current`-Schlüssel und
  beliebig viele `previous`. Lesen sucht den Schlüssel per Fingerprint, Schreiben
  nimmt immer `current`. So sind alter und neuer Schlüssel gleichzeitig nutzbar.
- Schlüssel werden heute aus `APP_SECRET` abgeleitet; `APP_SECRET_PREV`
  (kommagetrennt) hält frühere Master, deren abgeleitete Schlüssel als
  `previous` in den Ring kommen.

## Die eine Regel

**Den alten Schlüssel erst entfernen, wenn jede verschlüsselte Zeile auf dem
neuen Schlüssel liegt.** Wer den alten Schlüssel zu früh wegnimmt, kann die
noch unter ihm geschriebenen Zeilen nie wieder entschlüsseln. `safeDecrypt`
fängt das weich ab (liest leeren String statt zu werfen), die Daten sind aber
verloren.

Welche Spalten betroffen sind, steht in `ENCRYPTED_TARGETS`
(`src/server/crypto/reencrypt.ts`). Diese Liste muss **vollständig** sein; der
Test `tests/crypto/encrypted-targets-coverage.test.ts` erzwingt das, indem er
das Schema nach jeder `encryptedText`-Spalte scannt.

## Ablauf

0. **Backup.** `bun scripts/backup.ts --tenant=<key>` (siehe `scripts/backup.ts`).
   Der Dump enthält Ciphertext, ist also nur mit dem passenden Schlüssel lesbar.

1. **Neuen Schlüssel als `current`, alten als `previous` einhängen.** Bei
   Master-Rotation: neuen `APP_SECRET` setzen, den alten nach `APP_SECRET_PREV`.
   Deployen. Jetzt liest die App alt UND neu, schreibt neu.

2. **Vorab prüfen.** Admin-Endpoint `settings.inspectEncryption` (bzw.
   `inspectEncryptedData`) zeigt, wie viele Zeilen auf welchem Schlüssel liegen.

3. **Umschlüsseln.** Admin-Aktion `settings.reencryptData` (ruft
   `reencryptAllData`), oder per CLI mit injizierter Prod-Env:
   `railway run bun run db:reencrypt`. Idempotent: Zeilen, die schon auf
   `current` liegen, werden übersprungen; fehlgeschlagene werden gemeldet und
   unangetastet gelassen (dann fehlenden Schlüssel zu `APP_SECRET_PREV` geben
   und erneut laufen lassen).

4. **Schranke prüfen.** `assessKeyDropSafety(db)` ist erst dann `safe: true`,
   wenn **keine** Zeile mehr auf einem `previous`-Schlüssel, einem Legacy-v1-Blob
   oder einem unbekannten Fingerprint liegt. Erst dann weiter.

5. **Alten Schlüssel entfernen.** `APP_SECRET_PREV` leeren, deployen. Fertig.

## Warum das jetzt sicher ist

- Die Ziel-Liste kann nicht mehr unbemerkt unvollständig werden (Coverage-Test).
- Der volle Zyklus (schreiben unter A, rotieren, umschlüsseln, A entfernen,
  weiter lesbar) ist getestet: `tests/crypto/keyring-rotation.test.ts`
  (Mechanik) und `tests/integration/key-rotation.integration.test.ts` (echter
  DB-Job über eine isolierte Tabelle).
- Die Schranke aus Schritt 4 verhindert den einzigen wirklich destruktiven
  Schritt, solange noch Daten am alten Schlüssel hängen.
