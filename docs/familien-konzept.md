# Familien-Konzept

Wie der Verein Familienmitgliedschaften abbildet. Decision Record.
Status: **Umgesetzt** (Tabellen, Verwaltungsseite, Karte am Mitglied,
Seed-Assistent). Offene Ausbaustufen am Ende.

## Das Problem in einem Satz

"Familie" existierte nur implizit: ein Mitglied hält den Familienbeitrag,
Partner und Kinder sind beitragsfreie Mitglieder ohne Vertrag, verbunden
höchstens über unbeschriftete Linear-Verknüpfungen und eine gemeinsame
Adresse. Nichts im System konnte die Frage "wer gehört zu dieser
Familienmitgliedschaft?" beantworten.

## Befund im Bestand (Stand 2026-06-11)

- 42 lebende Mitglieder halten einen Vertrag der Beitragsart 101
  "Familienbeitrag"; je Familie genau einer (der Zahler).
- 175 lebende Mitglieder haben gar keinen Vertrag. 80 davon sind per
  Verknüpfung mit einem Familienbeitrag-Halter verbunden, 128 haben
  irgendeine Verknüpfung, 47 sind völlig isoliert (weder Vertrag noch
  Verknüpfung; Klärfälle).
- Alle 409 `relationships`-Zeilen tragen ein leeres `beziehung`/`art`:
  die Kanten existieren, aber ohne Semantik.
- 41 der 42 Halter haben Mitbewohner (gleiche Straße + PLZ), im Schnitt 2,9.

## Entscheidung

Familie wird eine **eigene, explizite Entität**, nicht aus Beitragsart oder
Verknüpfungen abgeleitet:

- `familien`: `id`, `name` ("Familie Brückner"), `zahler_member_id`, `notiz`.
- `familien_mitglieder`: Surrogat-`id`, `familie_id`, `member_id`,
  `rolle` (`zahler` | `partner` | `kind`), `von`, `bis`.
- Ein Mitglied gehört zu **höchstens einer aktiven** Familie (partieller
  Unique-Index auf `member_id where bis is null`). Beendete Zugehörigkeiten
  bleiben als Verlauf stehen (Kind wird 18, scheidet aus der Familie aus,
  bleibt Mitglied).

Bewusst **unabhängig von der Beitragsart**: eine Familie existiert auch ohne
laufenden Familienbeitrag (z. B. Großeltern zahlen für ein Enkelkind über die
Zahler-Rolle). Die Beitragsart ist ein Attribut der Verträge, nicht die
Definition der Gruppe. Das passt zum [Zahler-Konzept](zahler-konzept.md):
`familien.zahler_member_id` ist der natürliche Kandidat für den künftigen
`contracts.zahler_member_id`-Default der Familienmitglieder.

## Befüllung: Seed-Assistent statt Auto-Migration

Keine automatische Datenmigration. Die Seite **Familien** schlägt Gruppen vor
(Anker = lebendes Mitglied mit laufendem Familienbeitrag und ohne aktive
Familie; Kandidaten = lebende familienlose Mitglieder mit Verknüpfung zum
Anker oder gleicher Adresse, Rollenvorschlag nach Alter). Der Vorstand
bestätigt jede Familie einzeln, kann Rollen ändern und Kandidaten abwählen.
Gleiche Philosophie wie der Mitgliedsnummern-Guard: keine stillen Merges.

Die Familienbeitragsart wird über `fee_types.bezeichnung ilike '%famil%'`
erkannt, nicht über die hartkodierte 101, damit ein Re-Import mit anderen
Art-Nummern den Assistenten nicht bricht.

## Was bewusst NICHT Teil dieser Stufe ist

- **Beitragslauf/SEPA nach Zahler bündeln**: braucht das Zahler-Konzept
  (Mandat auf dem Zahler), eigene Stufe.
- **Antrag-Familie → Familie**: die Antragsfreigabe (`antragstyp = familie`)
  legt noch keine Familien-Gruppe an. Nächste Ausbaustufe; dann entsteht die
  Familie bei der Freigabe automatisch.
- **Datenqualitäts-Checks**: "Kind ist 18 geworden, steht aber noch als Kind
  in der Familie", "Familienbeitrag ohne Familie", "familienloses Mitglied
  ohne Vertrag" (die 47 Klärfälle) gehören in die nächtliche Datenqualität.
- **Austrittsbestätigung**: der Familien-Austritt füllt die Mitgliederliste
  noch nicht aus der Gruppe vor.
