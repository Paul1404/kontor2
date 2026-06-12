# Zahler-Konzept

Wie der Verein "wer zahlt für wen" abbildet. Decision Record, kein Tutorial.
Status: **Stufe 1 umgesetzt** (2026-06-12): Beitragslauf und Mandate-Nachtragen
lösen den Zahler dynamisch auf, Familien-Zahler für aktive Kinder,
Beziehungs-Vertreter für Minderjährige, sonst Selbstzahler
(`src/server/domain/zahler.ts`, `src/server/sepa/zahler-context.ts`). Die
Lastschrift läuft auf IBAN und Mandat des Zahlers; Mandate gehören nie dem
Kind.

Status: **Stufe 2 umgesetzt** (2026-06-12): expliziter Zahler pro Vertrag über
`contracts.zahler_member_id` (Migration 0053). Hat Vorrang vor der automatischen
Auflösung (`resolveZahler`, Quelle `"vertrag"`), greift im Beitragslauf
(per-Vertrag) und in den Datenqualitäts-Prüfungen für Mandat und IBAN. Pflege
über das Geldbeutel-Symbol am Vertrag (`ContractsCard`, `contracts.setZahler`).
Für Fälle, die sich nicht aus Familie oder Vertretung ableiten lassen, etwa ein
Erwachsener, dessen Beitrag jemand anderes zahlt. **Re-Import-fest**: der
Importer (`ingest-pipeline.ts`) sichert den Override vor dem Ersetzen der
Verträge und trägt ihn über den Linear-Schlüssel (AdrNr, VertragNr, Art) wieder
auf die neu eingefügte Zeile. Mitglieder-Ids überleben den Re-Import (Upsert),
also bleibt das Ziel gültig. Verschwindet ein Vertrag aus dem Dump, verliert er
seinen Override, was korrekt ist.

Bewusst NICHT umgesetzt: Zahler-Auflösung in Mahnwesen und Wiedereinzug, und das
Verschieben der Bankdaten auf den Zahler (unten). Der Rest dieses Dokuments
beschreibt den ursprünglichen Vorschlag.

## Das Problem in einem Satz

Heute ist "ein anderer zahlt" auf vier Arten modelliert, und der Beitragslauf
ignoriert drei davon. Es gibt keine eindeutige Quelle der Wahrheit, wer einen
Vertrag wirklich bezahlt.

## Begriffe

- **Mitglied**: eine Person mit Mitgliedschaft, eigene `member_no` (`M-…`),
  Beitragspflicht, Stimmrecht.
- **Zahler**: die Stelle, deren Konto belastet wird und an die Rechnung und
  Mahnung gehen. Eine Rolle, kein Mitgliedstyp. Default ist das Mitglied selbst
  (Selbstzahler).
- **Kontakt / K-Nummer** (`kontakt_no`, `K-…`): eine Zeile in `members`, die
  selbst kein Mitglied ist. Genau hierfür ist die K-Nummer da: ein Elternteil,
  das nicht im Verein ist, aber für zwei Kinder zahlt, ist ein Kontakt mit
  K-Nummer und Zahler-Rolle.

`coalesce(member_no, kontakt_no)` bleibt die nach außen sichtbare Referenz und
der Route-Key (siehe `src/server/db/schema/members.ts`).

## Wo wir heute stehen

Vier überlappende Mechanismen für denselben Sachverhalt:

1. `relationships.beziehung = "Abweichender Zahler"` (gerichtete Verknüpfung aus
   Linear `verkn`, `src/server/db/schema/relationships.ts`).
2. `contracts.abw_adr_nr` (Zeiger auf die AdrNr eines anderen Mitglieds oder
   Kontakts, `src/server/db/schema/contracts.ts:49`).
3. `contracts.abw_konto_inh` plus `strasse_kih` / `plz_kih` / `ort_kih` /
   `email_kih` (Freitext-Kontoinhaber, `contracts.ts:70-74`).
4. `members.abw_konto_inh` (`members.ts:84`), eine zweite, redundante Kopie des
   Freitext-Kontoinhabers.

Die Bankverbindung selbst liegt nur am Mitglied: `members.iban1`
(`encryptedText`), `iban1_last4`, `bic1` (`members.ts:84-92`). SEPA-Mandate
hängen am Mitglied über `sepa_mandates.member_id` bzw. `adr_nr`
(`src/server/db/schema/sepa.ts`).

### Die Lücke

Der Beitragslauf in `src/server/sepa/build-fee-run.ts` belastet **immer**
`member.iban1` und wählt das Mandat des Mitglieds (`mandatesByMember`). Der
"abweichende Zahler" ändert über `debtorNameFor` nur den **angezeigten Namen**
(`abwKontoInh`), nicht die IBAN und nicht das Mandat:

```ts
// build-fee-run.ts
const iban = member.iban1;            // immer das Mitglied
debtorName: debtorNameFor(member, contract), // nur der Name kann abweichen
```

Heißt praktisch: ein K-Zahler kann als Zeile existieren, abgebucht wird trotzdem
das Konto des Kindes. Für Familien ist das falsch. Außerdem erzeugt der Lauf
**eine Lastschrift pro Vertrag**, also bei drei Kindern drei Einzüge statt eines
gebündelten Einzugs beim Elternteil.

## Zielmodell: Zahler ist eine Rolle

Eine einzige Quelle der Wahrheit.

1. **Jeder Vertrag hat genau einen Zahler.** Default: das Mitglied selbst. Sonst
   ein expliziter Link `zahler_member_id` auf eine `members`-Zeile (echtes
   Mitglied `M-` oder Kontakt `K-`).
2. **Bankverbindung und Mandat gehören an die Zahler-Zeile**, nicht verstreut
   über Mitglied und Vertrag. Der Beitragslauf holt IBAN, BIC, Mandat und Name
   konsistent vom Zahler. Bei Selbstzahlern ist Zahler-Zeile = Mitglied, also
   ändert sich nichts.
3. **SEPA-Lauf gruppiert nach Zahler.** Ein Lastschrift-Posten pro Zahler,
   gebündelt über alle Verträge der von ihm bezahlten Mitglieder. Familie mit
   drei Kindern: ein Einzug, eine Mandatsreferenz, ein Verwendungszweck mit den
   enthaltenen Mitgliedern.
4. **Mahnung geht an den Zahler.** Das löst die heutige Überschneidung mit
   `relationships.ist_vertreter` auf: der gesetzliche Vertreter eines
   Minderjährigen ist konzeptionell schlicht der Zahler und Empfänger. `dunning`
   adressiert dann den Zahler statt zwei getrennte Pfade zu pflegen.

### Was aus den vier Altmechanismen wird

- `contracts.abw_adr_nr` wird zur Quelle für `zahler_member_id` (per AdrNr auf
  die Zahler-Zeile auflösen).
- `contracts.abw_konto_inh` plus `*_kih` und `members.abw_konto_inh`: wenn der
  Zahler keine eigene `members`-Zeile hat, wird beim Import eine K-Zeile mit
  Name, Adresse und Bankverbindung angelegt und verlinkt. Die Freitextfelder
  entfallen danach.
- `relationships`-Einträge "Abweichender Zahler" bleiben als Beleg und Historie,
  sind aber nicht mehr die operative Quelle für den Einzug.

## Migration

Zwei harte Randbedingungen aus `docs/de-linearization.md`:

- **Verträge sind replace-not-upsert.** `runIngest` löscht und schreibt
  Verträge, Mandate und Relationships pro AdrNr bei jedem Import neu. Ein
  `zahler_member_id` direkt auf `contracts` würde bei jedem Re-Import
  überschrieben. Lösung: der Link muss beim Import deterministisch aus Linears
  `abw_adr_nr` neu abgeleitet werden, damit er den Re-Import übersteht. App-seitig
  manuell gesetzte Zahler brauchen denselben Schutz wie `deleted_at` heute (vom
  Mapper nicht emittiert, daher erhalten), sonst gehen sie verloren.
- **Verschlüsselte IBAN.** `iban1` ist `encryptedText`. Beim Anlegen von
  K-Zahler-Zeilen wird die IBAN aus der Mitgliedszeile in die Zahler-Zeile
  verschoben, nicht kopiert, damit es danach genau eine maßgebliche Bankverbindung
  pro Zahler gibt.

Reihenfolge: erst `zahler_member_id` als Link einführen und im Beitragslauf
auswerten (IBAN, Mandat, Name vom Zahler), Selbstzahler als Default. Dann die
Gruppierung nach Zahler. Zuletzt die Freitextfelder zurückbauen.

## Offene Fragen

- Mandat am Zahler: ein Mandat des Elternteils deckt mehrere Kinder. Wie wird die
  Mandatsreferenz im pain.008 je gebündeltem Einzug dargestellt?
- Rücklastschrift (`sepa-returns`): die Zuordnung muss vom gebündelten Einzug
  zurück auf die einzelnen Sollstellungen auflösen.
- Beitragsbescheinigung und DSGVO-Auskunft: gehört die Bankverbindung des Zahlers
  in die Auskunft des Mitglieds oder nur in die des Zahlers?
