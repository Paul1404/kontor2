# Mitglieder und Familien ab Version 5

## Vor der Freigabe

Migrationen werden wie bisher über `bun run db:migrate:prod` für alle Mandanten
angewandt. Migration 0083 ergänzt die Familienrollen, Vertragsverläufe,
historische Mitgliedsreferenzen und den Versandnachweis der Geburtstagserinnerung.

Unter **Familien > Altzuordnungen prüfen** steht eine reine Bestandsvorschau.
Sie umfasst bestehende Familien, Altbeziehungen, Vertreterangaben und explizite
Vertragszahler. Erst die bestätigte Übernahme schreibt eindeutige Fälle.
Widersprüche bleiben als Prüffälle erhalten. Mehrere vorhandene Familien werden
niemals automatisch zusammengeführt. Die Vorschau trägt einen Bestandshash;
zwischenzeitliche Änderungen verlangen eine neue Vorschau. Die Übernahme läuft
in einer Transaktion und hält die betroffenen Tabellen für konkurrierende
Schreibzugriffe gesperrt. Altbeziehungen bleiben mit Enddatum erhalten.

Vor einem Beitrags- oder Mahnlauf müssen unklare Zahler und Hauptempfänger
geklärt werden. Die Verarbeitung darf nicht stillschweigend auf das eigene
Konto eines Kindes zurückfallen. Die Datenqualität meldet fehlende Familien und
Hauptempfänger. Familienrollen werden in der Mitgliedsansicht bearbeitet.
Zahler und Sorgeberechtigter dürfen verschiedene Personen sein. Mehrere
Sorgeberechtigte sind möglich; eine Person ist Hauptempfänger für Kinder.

## Mitgliedsdefinition

`member_no` bestimmt die echte Mitgliedschaft, `kontakt_no` einen Kontakt.
Die alte Linear-Mitgliedsnummer ist kein geeigneter Typindikator.
Aktuelle Mitglieder sind echte Mitglieder ohne Löschung und ohne bereits
wirksames Austritts- oder Todesdatum. Aktiv und Passiv teilen diese Menge nach
laufender Zugehörigkeit zu einer echten Abteilung auf. Finanzberichte bewahren
hingegen auch Forderungen historischer Datensätze und Kontakte.

## Tarifwechsel

**Beiträge & SEPA > Tarif wechseln** zeigt alten und neuen Tarif,
Wirksamkeitsdatum und bestehende Sollstellungen vor dem Speichern.
`contracts.series_id` verbindet die Verträge eines Verlaufs. Das Vertragsende
beim Wechsel ist exklusiv; der Nachfolger beginnt am selben Tag.
Je Verlauf gilt für einen Jahreslauf der Vertrag am Fälligkeitsdatum.
Eine bestehende nicht stornierte Jahressollstellung irgendeines Vorgängers
verhindert einen zweiten Beitrag des Nachfolgers. Unabhängige Verträge bleiben
unabhängig abrechenbar. Bereits gestellte oder eingereichte Beiträge werden
nicht geändert. Überschneidungen innerhalb eines Verlaufs blockieren den Lauf
und erscheinen in der Datenqualität.

## Kontaktkorrektur

**In Kontakt umwandeln** korrigiert versehentlich angelegte Mitglieder.
Die Vorschau nennt die künftige K-Nummer, Familien, Verträge, Abteilungen,
Mandate, Sollstellungen und Portalzugänge. Eine Begründung ist Pflicht.
Vertrags-, Abteilungs- oder Finanzhistorie und ein Austritts- oder Todesdatum
blockieren die automatische Konvertierung. Nichts davon wird gelöscht.
Familienrollen und Mandate bleiben erhalten. Portalzugänge werden beendet.
Die frühere M-Nummer bleibt über `previous_member_no` suchbar. Änderungen
werden atomar auditiert und als Mitgliedssnapshot gespeichert.

## Geburtstagserinnerung

Unter **Vereinsdaten > Geburtstagserinnerung** werden Aktivierung, Uhrzeit
(Standard 08:00 Uhr), Benutzer und zusätzliche Adressen konfiguriert.
Versandtag ist Montag in Europe/Berlin, Zeitraum Montag bis Sonntag.
Ein Test geht ausschließlich an den angemeldeten Administrator.
Der Scheduler prüft jede Minute alle Mandanten. Ausgewählte Benutzer werden
mit ihrer aktuellen Adresse aufgelöst; gesperrte und gelöschte Benutzer sind
nicht erreichbar. Adressen werden normalisiert und dedupliziert.

`birthday_reminder_deliveries` reserviert Woche und Empfänger vor dem Versand.
Auch parallele Prozesse senden deshalb höchstens einmal. Fehlgeschlagene oder
beim Prozessabbruch reservierte Ausführungen werden nicht automatisch erneut
versendet, um doppelte Nachrichten zu vermeiden. SMTP-Annahme ist kein
Zustellnachweis. Erfolgreiche, übersprungene und fehlgeschlagene Versuche stehen
im Versandprotokoll unter Geburtstagserinnerung. Ohne gültigen Empfänger wird
ein übersprungener Lauf protokolliert. Die Funktion startet deaktiviert.
