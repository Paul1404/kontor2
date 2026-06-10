# Aktiv / Passiv

Brauchen wir das `aktiv` / `passiv`-Flag überhaupt? Decision Record.
Status: **Vorschlag**, Entscheidung offen.

## Die Frage

Das `status`-Enum auf `members` ist `aktiv` / `passiv` / `ausgetreten` /
`verstorben` (`src/server/db/schema/members.ts`, abgeleitet in
`src/server/domain/member.ts` aus Linears `AktivPasiv`-Flag "A" / "P"). Es
mischt zwei Achsen, die nichts miteinander zu tun haben:

- **Lebenszyklus**: lebt die Mitgliedschaft, ruht sie (`ruhend`), beendet
  (`ausgetreten`), verstorben.
- **Teilnahmeart**: macht die Person aktiv Sport oder ist sie förderndes
  (passives) Mitglied.

`ausgetreten` und `verstorben` gehören zur ersten Achse, `aktiv` / `passiv` zur
zweiten. Als isoliertes Flag sagt `aktiv` / `passiv` nichts aus. Sinnvoll wird
die Unterscheidung erst über die Abteilungen.

## Befund: das Flag trägt heute fast nichts

Wo `status` tatsächlich ausgewertet wird:

- **Bestandserhebung / Verbandsmeldung** (`src/server/verbandsmeldung/
  bestandserhebung.ts`): zählt über `member_abteilungen` plus Lebenszyklus-Daten
  (`austritt`, `verstorben_am`, `deleted_at`). Das `aktiv` / `passiv`-Flag kommt
  **nicht** vor. Die offizielle LSB/DOSB-Zählung pro Sparte hängt also schon
  heute an der Abteilungszugehörigkeit, nicht am Flag.
- **"Aktive Mitglieder" in Listen, Stats, Dashboard** (`src/server/db/
  member-filters.ts`, `memberIsCurrent`): rein Lebenszyklus, also nicht gelöscht,
  nicht ausgetreten, nicht verstorben. Das `passiv`-Flag kommt **nicht** vor.
  Hier meint "aktiv" schlicht "lebende Mitgliedschaft".
- **Beitragslauf** (`src/server/sepa/build-fee-run.ts`): treibt den Beitrag aus
  dem Vertrag (`betrag`, `art`), nicht aus dem Flag. Ausschlüsse über
  `beitragsbefreit` / `ruhend` / `direct_debit_blocked`, nicht über `passiv`.
- **Anzeige** (`src/lib/member-status.ts`, `memberStatusView`): der einzige Ort,
  der "Passiv" wirklich als eigenes Badge rendert. "Aktiv" ist dort nur der
  Fallback, wenn nicht passiv, ausgetreten oder verstorben.

Die gesamte beobachtbare Wirkung des Flags ist also ein graues "Passiv"-Badge
statt eines grünen "Aktiv"-Badges. Geld, Verbandsmeldung und alle Mitgliederlisten
laufen ohne das Flag.

## Namens-Kollision

"Aktiv" bedeutet im Code zweierlei: in `member-filters.ts` "lebende
Mitgliedschaft", im `status`-Enum "nicht passiv". Dasselbe Wort, zwei
Bedeutungen, in derselben Codebasis. Das ist eine eigene Fehlerquelle und ein
zusätzliches Argument, die zweite Bedeutung loszuwerden oder umzubenennen.

## Empfehlung

Kein eigenes, manuell gepflegtes `aktiv` / `passiv`-Flag. Die echte Information
"macht Sport in welcher Abteilung" liegt bereits in `member_abteilungen`, das
Geld im Vertrag, der Lebenszyklus in den Daten. "Passiv / fördernd" ist
vollständig ableitbar:

> **passiv = Mitglied mit lebender Mitgliedschaft, aber ohne laufende
> Abteilungszugehörigkeit.** Sonst aktiv.

Konkret:

- Lebenszyklus bleibt eine eigene Achse (`ausgetreten` / `verstorben` aus den
  Daten, `ruhend` als eigenes Flag).
- Falls das "Passiv"-Badge erhalten bleiben soll, wird es aus
  `member_abteilungen` abgeleitet statt aus dem `status`-Enum gelesen.
- Das Legacy-Feld `aktivPasiv` bleibt nur als Import-Fallback für Zeilen ohne
  gepflegte Abteilung.

## Vorbehalt

Vor dem Rückbau prüfen, ob der Verein an "förderndes Mitglied" eine harte Regel
knüpft, die nicht aus Abteilung plus Vertrag folgt, zum Beispiel ein
eingeschränktes Stimmrecht in der Satzung. Findet sich keine solche Regel, ist
das Flag reine Dekoration und kann abgeleitet werden.
