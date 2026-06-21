/**
 * Curated release log + active app version. Single source of truth: the
 * version chip in the sidebar, the login/setup footer, and the "What's
 * new" dialog all read from here.
 *
 * Update protocol for future contributors:
 *
 *   1. Put new releases at the TOP of `RELEASES`. The first entry is
 *      always the current version.
 *   2. Use semver: bump `patch` for fixes, `minor` for non-breaking
 *      features, `major` for anything that needs operator action (env
 *      change, DB migration, re-import, etc.).
 *   3. Write `description` in German UI tone — short, direct, no marketing
 *      adjectives. The audience is one Vorstand reading a small dialog,
 *      not a press release.
 *   4. Skip `internal` for pure refactors that no user can observe; bump
 *      patch anyway so the change has a traceable version.
 *
 * The Bun version chip auto-bumps the unread indicator whenever
 * `CURRENT_VERSION` changes — no extra wiring needed.
 */

export type ReleaseCategory = "feature" | "fix" | "improvement" | "breaking" | "internal";

export type ReleaseChange = {
  category: ReleaseCategory;
  description: string;
};

export type Release = {
  version: string;
  date: string;
  /** Optional one-line headline shown above the change list. */
  title?: string;
  changes: ReleaseChange[];
};

/**
 * Chronological log, newest first. `RELEASES[0].version` is the active app
 * version surfaced in the UI; `package.json` is kept in sync manually.
 */
export const RELEASES: Release[] = [
  {
    version: "0.111.0",
    date: "2026-06-21",
    changes: [
      {
        category: "feature",
        description:
          "SQL-Archiv: Neue Auswertung der tatsächlich eingezogenen Beiträge aus dem Linear-Dump (inkl. Kennzeichnung von Rücklastschriften), auch über die KI-Schnittstelle. Hilft, Posten zu finden, die beim Import fälschlich als bezahlt markiert wurden.",
      },
    ],
  },
  {
    version: "0.110.2",
    date: "2026-06-21",
    changes: [
      {
        category: "improvement",
        description:
          "Das Browser-Symbol (Favicon) zeigt jetzt durchgängig das Kontor²-Zeichen statt eines Vereinslogos. Vereins-Logos bleiben auf den Briefen und im öffentlichen Antrag.",
      },
    ],
  },
  {
    version: "0.110.1",
    date: "2026-06-21",
    changes: [
      {
        category: "improvement",
        description:
          "Das Menü tritt jetzt durchgängig als Kontor² auf (Zeichen und Name); der Vereinsname steht als Kontext darunter, statt die Anwendung wie eine reine Vereins-App wirken zu lassen. Der aktive Menüpunkt ist durch einen Messing-Akzent klar erkennbar.",
      },
    ],
  },
  {
    version: "0.110.0",
    date: "2026-06-21",
    changes: [
      {
        category: "improvement",
        description:
          "Durchgängige Kontor²-Markenidentität: neues serifes K²-Zeichen samt Favicons und App-Icon, die offizielle Farbpalette (Ink Navy, Messing, Papier, Schiefer) und die Markenschriften Spectral und IBM Plex Sans. Heller Hintergrund ist jetzt warmes Papier, Schaltflächen in Ink Navy.",
      },
    ],
  },
  {
    version: "0.109.2",
    date: "2026-06-21",
    changes: [
      {
        category: "fix",
        description:
          "KI-Zugriff: Beim Wiederöffnen einer Forderung lässt sich jetzt das Fälligkeitsdatum mitkorrigieren, damit ein Erinnerungsbrief auf das richtige Datum gestellt werden kann.",
      },
    ],
  },
  {
    version: "0.109.1",
    date: "2026-06-20",
    changes: [
      {
        category: "fix",
        description:
          "Kulanzbrief: Bei vollem Anschreiben rutschte die neue Unterschriftszeile allein auf eine zweite Seite. Abstände gestrafft, sodass das Anschreiben mit ein bis zwei offenen Posten auf einer Seite bleibt.",
      },
    ],
  },
  {
    version: "0.109.0",
    date: "2026-06-20",
    changes: [
      {
        category: "feature",
        description:
          "KI-Zugriff: Neue Werkzeuge, um eine versehentlich stornierte Forderung wieder als offen zu setzen und einen Kulanz-/Erinnerungsbrief direkt über die Schnittstelle zu erzeugen.",
      },
    ],
  },
  {
    version: "0.108.0",
    date: "2026-06-19",
    changes: [
      {
        category: "feature",
        description:
          "Kulanzbrief: Unter dem Gruß steht jetzt eine Unterschriftszeile mit der Beschriftung Der Vorstand. Beim Erstellen lässt sich wählen, ob die hinterlegte Vorstand-Unterschrift eingesetzt oder eine leere Linie zum Unterschreiben gedruckt wird.",
      },
    ],
  },
  {
    version: "0.107.1",
    date: "2026-06-19",
    changes: [
      {
        category: "internal",
        description:
          "Veraltete Beispiel-Umgebungsvariablen (SVUWV_BOOTSTRAP_ADMIN_*) aus der Konfigurationsvorlage entfernt. Sie werden vom Code nicht mehr verwendet.",
      },
    ],
  },
  {
    version: "0.107.0",
    date: "2026-06-18",
    changes: [
      {
        category: "feature",
        description:
          "KI-Zugriff: Bestehende SEPA-Mandate lassen sich jetzt über die Schnittstelle aktualisieren, etwa das Unterschriftsdatum nachpflegen. Das verhindert ein ungültiges Unterschriftsdatum in der Lastschriftdatei.",
      },
    ],
  },
  {
    version: "0.106.2",
    date: "2026-06-18",
    changes: [
      {
        category: "fix",
        description:
          "Datenqualität: Die Prüfung „Beitrag deckt Partner ohne eigenen Vertrag“ ignoriert jetzt ausdrückliche Paar-Tarife (Beitragsart mit „dopp“), bei denen ein Vertrag für zwei Personen gewollt ist. Damit zeigt sie nur noch echte Fälle.",
      },
    ],
  },
  {
    version: "0.106.1",
    date: "2026-06-18",
    changes: [
      {
        category: "fix",
        description:
          "Verträge lassen sich über die Schnittstelle jetzt als Lastschrift anlegen. Damit kann eine zweite Haushaltsperson einen eigenen, einziehbaren Vertrag bekommen, der über das Konto des Partners läuft.",
      },
    ],
  },
  {
    version: "0.106.0",
    date: "2026-06-18",
    changes: [
      {
        category: "feature",
        description:
          "Datenqualität: Neue Prüfung „Beitrag deckt Partner ohne eigenen Vertrag“. Findet Fälle, in denen ein Beitrag auf das Doppelte des üblichen Satzes gesetzt wurde, während im selben Haushalt ein Mitglied ohne eigenen Vertrag geführt wird.",
      },
      {
        category: "feature",
        description:
          "KI-Zugriff: Zahler eines Vertrags setzen und Beziehungen zwischen Mitgliedern anlegen ist jetzt über die Schnittstelle möglich. So lassen sich Haushalte sauber strukturieren, etwa eine zweite Person mit eigenem Vertrag über das Konto des Partners.",
      },
    ],
  },
  {
    version: "0.105.1",
    date: "2026-06-18",
    changes: [
      {
        category: "fix",
        description:
          "Beitragslauf: Ausführen schlug fehl, weil das Fälligkeitsdatum beim Aktualisieren der Mandatsnutzung in einem Format an die Datenbank ging, das sie ablehnte. Lauf und Wiedereinzug laufen jetzt sauber durch.",
      },
    ],
  },
  {
    version: "0.105.0",
    date: "2026-06-17",
    changes: [
      {
        category: "feature",
        description:
          "Beitragslauf gezielt: Eine Vorschau und ein Lauf lassen sich jetzt auf eine ausgewählte Mitgliederliste begrenzen. So entsteht eine SEPA-Datei für genau bestimmte Personen, etwa Rückläufer und übersehene Fälle, ohne den Rest des Vereins erneut einzuziehen. Auch über die KI-Schnittstelle.",
      },
    ],
  },
  {
    version: "0.104.0",
    date: "2026-06-17",
    changes: [
      {
        category: "feature",
        description:
          "KI-Zugriff: Der Beitragslauf inklusive SEPA-Einzug ist jetzt über die Schnittstelle steuerbar. Vorschau, Lauf ausführen, pain.008 abrufen, Sollstellung stornieren, Rücklastschrift erfassen und Wiedereinzug. Jede Aktion wird wie im Programm protokolliert.",
      },
    ],
  },
  {
    version: "0.103.0",
    date: "2026-06-17",
    title: "SQL-Archiv",
    changes: [
      {
        category: "feature",
        description:
          "Neues SQL-Archiv: Linear-Webverein-Dumps lassen sich versioniert hochladen, getrennt von den Live-Daten. Jeder Upload wird eine eigene Version, die höchste ist die aktuelle. Die alte Datenbank wird komplett eingelesen und ist durchsuchbar. Tabellen, Spalten, Typen und Beziehungen werden für die Analyse aufbereitet.",
      },
      {
        category: "feature",
        description:
          "Die Archiv-Analyse ist auch über die KI-Schnittstelle (MCP) verfügbar: Versionen auflisten, Tabellen beschreiben, suchen, Werteverteilungen ansehen, Beziehungen erkennen und Schema-Versionen vergleichen.",
      },
    ],
  },
  {
    version: "0.102.0",
    date: "2026-06-17",
    changes: [
      {
        category: "feature",
        description:
          "Datenqualität: Neue Prüfung „Gleiches Geburtsdatum wie Beziehungspartner“. Findet Eltern-Datensätze, die beim Import das Geburtsdatum des Kindes übernommen haben. Über „Bearbeiten“ lässt sich das richtige Datum direkt setzen.",
      },
    ],
  },
  {
    version: "0.101.3",
    date: "2026-06-17",
    changes: [
      {
        category: "fix",
        description:
          "Mandate nachtragen: Ein verknüpfter Erwachsener wird auch dann als Vertreter vorgeschlagen, wenn sein Geburtsdatum (aus dem Import) fälschlich das des Kindes ist. Passt der Name zum Kontoinhaber, sticht das den Geburtsdatum-Check.",
      },
    ],
  },
  {
    version: "0.101.2",
    date: "2026-06-17",
    changes: [
      {
        category: "fix",
        description:
          "Mandate nachtragen: Besteht zum Kontoinhaber schon eine Beziehung, heißt die Aktion jetzt „… als Vertreter“ statt „Kontakt anlegen“ und übernimmt die vorhandene Beziehung, statt eine Dublette anzulegen.",
      },
    ],
  },
  {
    version: "0.101.1",
    date: "2026-06-16",
    changes: [
      {
        category: "fix",
        description:
          "Datenimport: Ein erneuter Linear-Import setzt einen im Kontor gepflegten Vertreter nicht mehr zurück. Vertreter-Beziehungen bleiben beim Re-Import erhalten, auch wenn Linear sie nicht kennt.",
      },
    ],
  },
  {
    version: "0.101.0",
    date: "2026-06-16",
    changes: [
      {
        category: "feature",
        description:
          "Datenqualität: Bei vielen Befunden führt jetzt ein „Bearbeiten“ direkt in das Mitglied und springt auf das fehlerhafte Feld. Adresse, PLZ, E-Mail, IBAN, Geburtsdatum und weitere Befunde lassen sich so ohne Suchen korrigieren.",
      },
    ],
  },
  {
    version: "0.100.1",
    date: "2026-06-16",
    changes: [
      {
        category: "fix",
        description:
          'Letzte Reste des Mandats-Ablaufs entfernt: Auch der Mandats-Nachtrag wertet ein importiertes „gültig bis" nicht mehr als Ablauf. Ein aktives, nie widerrufenes Mandat gilt als nutzbar, egal welches alte Datum daran hängt; nur ausdrücklich inaktiv gesetzte Mandate werden reaktiviert.',
      },
    ],
  },
  {
    version: "0.100.0",
    date: "2026-06-16",
    changes: [
      {
        category: "feature",
        description:
          'Datenqualität: Befunde mit eindeutiger Lösung lassen sich jetzt direkt korrigieren. Den Anfang macht die vertauschte Namensreihenfolge. Ein Klick auf „Korrigieren" tauscht Vor- und Nachname; vorher wird geprüft, ob der Befund noch besteht, und die Änderung steht in der Mitglieder-Historie und lässt sich dort zurücknehmen.',
      },
    ],
  },
  {
    version: "0.99.8",
    date: "2026-06-16",
    changes: [
      {
        category: "fix",
        description:
          'SEPA-Mandate laufen nicht mehr ab. Ein Mandat gilt unbefristet (es erlischt erst nach 36 Monaten ohne Nutzung), daher wird das alte „gültig bis"-Datum aus Linear nicht mehr als Ablauf gewertet. Wichtig: Mitglieder mit einem solchen Altmandat wurden bisher beim Beitragslauf übersprungen und werden jetzt wieder korrekt eingezogen. Die Datenqualitäts-Prüfungen „SEPA-Mandat abgelaufen" und „läuft bald ab" entfallen. Stattdessen ist „Lastschrift ohne SEPA-Mandat" jetzt ein Fehler, denn nur ein fehlendes Mandat verhindert den Einzug wirklich.',
      },
    ],
  },
  {
    version: "0.99.7",
    date: "2026-06-16",
    changes: [
      {
        category: "fix",
        description:
          "Import: Ein Mitglied geht nicht mehr verloren, wenn seine Mitgliedsnummer bereits an ein anderes Mitglied vergeben ist. Das Mitglied wird jetzt trotzdem importiert, die doppelte Nummer wird entfernt und der Fall als Warnung gemeldet, damit die richtige Nummer zugewiesen werden kann. Vorher wurde der Datensatz stillschweigend übersprungen.",
      },
    ],
  },
  {
    version: "0.99.6",
    date: "2026-06-15",
    changes: [
      {
        category: "fix",
        description:
          "Datumsangaben auf der DSGVO-Auskunft und im Serienbrief nutzen jetzt die feste Zeitzone und können sich nicht mehr um einen Tag verschieben. Die DSGVO-Auskunft wird außerdem auch dann vollständig erstellt, wenn ein einzelner Dateianhang gerade nicht abrufbar ist.",
      },
    ],
  },
  {
    version: "0.99.5",
    date: "2026-06-15",
    changes: [
      {
        category: "fix",
        description:
          "Drei Korrekturen unter der Haube: Ein Wiedereinzug mit mehreren Posten auf demselben Mandat erzeugt jetzt nur eine Erstlastschrift, sonst hätte die Bank die ganze Datei abgelehnt. Eine DSGVO-Löschung läuft komplett in einer Transaktion, sodass bei einem Abbruch keine halb gelöschten Daten zurückbleiben. Außerdem ein Fehler im Deploy-Skript für mehrere Vereine behoben.",
      },
    ],
  },
  {
    version: "0.99.4",
    date: "2026-06-15",
    changes: [
      {
        category: "improvement",
        description:
          "Die Adressvorschläge im Online-Antrag kommen jetzt aus dem amtlichen deutschen Verzeichnis (OpenPLZ). Straßen in kleinen Orten und Ortsteilen werden dadurch zuverlässig gefunden, auch bei Teileingaben. OpenStreetMap dient nur noch als Rückfallebene.",
      },
    ],
  },
  {
    version: "0.99.3",
    date: "2026-06-14",
    changes: [
      {
        category: "improvement",
        description:
          "Der sanfte Hintergrundschimmer und die Verlaufsüberschriften nutzen jetzt durchgehend die Markenfarben Navy und Messing. Vorher schimmerten noch Rot, Violett und Cyan aus der Vorgängeranwendung durch.",
      },
    ],
  },
  {
    version: "0.99.2",
    date: "2026-06-14",
    changes: [
      {
        category: "internal",
        description:
          "Aufräumen ohne sichtbare Änderung: doppelte Filter-Chips und die Größenformatierung wurden zu gemeinsamen Bausteinen zusammengeführt.",
      },
    ],
  },
  {
    version: "0.99.1",
    date: "2026-06-14",
    changes: [
      {
        category: "improvement",
        description:
          "Kleinere Politur in der Antragsansicht: Beträge erscheinen einheitlich als 0,00 € und Datumsangaben im gewohnten Format und ohne Zeitzonen-Verschiebung. Im PDF-Viewer ist der Knopf zum Öffnen in neuem Tab jetzt für Screenreader beschriftet.",
      },
    ],
  },
  {
    version: "0.99.0",
    date: "2026-06-14",
    changes: [
      {
        category: "feature",
        description:
          "Der Online-Antrag kann seinen Beitrag jetzt direkt aus den Beitragsarten ziehen. Unter Einstellungen > Beitragsarten lässt sich je Beitragsart eine Rolle im Online-Antrag setzen (Familie, Kind, Jugendlich usw.); dann wird deren Betrag angeboten und die Beitragsart bei der Genehmigung gleich vorausgewählt. So gibt es eine Quelle für den Preis statt zweier. Solange keine Beitragsart zugeordnet ist, gilt weiter die Beitragsstaffel unter Vereinsdaten. Für bestehende Vereine ändert sich nichts, bis sie eine Zuordnung setzen.",
      },
    ],
  },
  {
    version: "0.98.0",
    date: "2026-06-14",
    changes: [
      {
        category: "feature",
        description:
          "Die Anzahl der Mahnstufen lässt sich jetzt je Verein einstellen (Einstellungen > Vereinsdaten): nur Erinnerung, Erinnerung plus eine Mahnung, oder der bisherige dreistufige Ablauf. Voreingestellt bleiben drei Stufen, also unverändert.",
      },
    ],
  },
  {
    version: "0.97.0",
    date: "2026-06-14",
    changes: [
      {
        category: "feature",
        description:
          "Die Altersgrenzen der Beitragskategorien im Online-Antrag (Kind, Jugendlich, Junger Erwachsener) lassen sich jetzt je Verein einstellen (Einstellungen > Vereinsdaten). Voreingestellt bleiben 14, 18 und 25 Jahre, also unverändert zum bisherigen Verhalten.",
      },
    ],
  },
  {
    version: "0.96.7",
    date: "2026-06-14",
    changes: [
      {
        category: "internal",
        description:
          "Die Jahresbeiträge für den Online-Antrag müssen je Verein hinterlegt sein. Ist keine Beitragsstaffel gepflegt, weist der Online-Antrag darauf hin, statt stillschweigend eine fremde Preistabelle zu verwenden. Bestehende Vereine behalten ihre bisherigen Beträge unverändert.",
      },
    ],
  },
  {
    version: "0.96.6",
    date: "2026-06-14",
    changes: [
      {
        category: "improvement",
        description:
          "Die Ehrenurkunde nutzt jetzt die Markenfarbe des Vereins (Einstellungen > Vereinsdaten) statt einer festen roten Farbe. Ist keine Markenfarbe gesetzt, bleibt es beim bisherigen Rot.",
      },
    ],
  },
  {
    version: "0.96.5",
    date: "2026-06-14",
    changes: [
      {
        category: "improvement",
        description:
          "Aufrufe der bisherigen Adresse svuwv.sv-untereuerheim.de werden jetzt automatisch auf svu.kontor2.com weitergeleitet. Alte Lesezeichen und Links funktionieren damit weiter.",
      },
    ],
  },
  {
    version: "0.96.4",
    date: "2026-06-14",
    changes: [
      {
        category: "internal",
        description:
          "Abhängigkeiten aktualisiert (better-auth, sharp, Bun-Basis-Image und CI-Actions). Keine funktionalen Änderungen.",
      },
    ],
  },
  {
    version: "0.96.3",
    date: "2026-06-14",
    changes: [
      {
        category: "improvement",
        description:
          'Die Datenqualitäts-Prüfung „Volljährig auf Eltern-Konto" erkennt jetzt auch Altdaten ohne formale Zahler-Verknüpfung: über einen abweichenden Kontoinhaber oder eine IBAN, die sich mit einem älteren Mitglied gleichen Nachnamens deckt.',
      },
    ],
  },
  {
    version: "0.96.2",
    date: "2026-06-14",
    changes: [
      {
        category: "fix",
        description:
          "Härtung im Hintergrund: Eine bereits versendete Mahnung lässt sich nicht erneut versenden. Der Beitragslauf-Vergleich zählt jetzt auch Rechnungszahler korrekt mit. Eine Einladung, deren erster Versuch abbrach, übernimmt beim zweiten Versuch das neu gesetzte Passwort. Der KI-Zugang ist auch gegen ungültige Schlüssel gedrosselt. Kleinere Korrekturen an Fehlermeldungen und Sperren.",
      },
    ],
  },
  {
    version: "0.96.1",
    date: "2026-06-14",
    changes: [
      {
        category: "fix",
        description:
          "Kleinere Korrekturen: Portal-Änderungsanträge werden nicht mehr auf zwischenzeitlich gelöschte Mitglieder angewandt und doppelt gewählte Felder zählen nur einmal. Der Stichtag der Bestandserhebung wird taggenau angezeigt. Der öffentliche Antrag begrenzt die Anzahl von Kindern und Abteilungen.",
      },
    ],
  },
  {
    version: "0.96.0",
    date: "2026-06-14",
    changes: [
      {
        category: "feature",
        description:
          "KI-Zugriff: ein neues Werkzeug setzt die Altersgrenzen einer Beitragsart (Alter von/bis). Damit lässt sich die Datenqualitätsprüfung Beitragsart passt nicht zum Alter auch per Assistent scharf schalten. Nur diese Felder sind setzbar, die Änderung wird protokolliert; übrige Einstellungen bleiben gesperrt.",
      },
    ],
  },
  {
    version: "0.95.9",
    date: "2026-06-14",
    changes: [
      {
        category: "fix",
        description:
          "Der nächtliche Snapshot- und Status-Abgleich läuft jetzt für alle Vereine, nicht nur für den Hauptmandanten. Jeder Verein wird in seiner eigenen Datenbank gesichert.",
      },
    ],
  },
  {
    version: "0.95.8",
    date: "2026-06-14",
    changes: [
      {
        category: "fix",
        description:
          "Beim erneuten Import entstehen keine doppelten Abteilungs-Zuordnungen mehr, wenn sich das Eintrittsdatum geändert hat. Die Zuordnung wird jetzt ersetzt statt zusätzlich angelegt; manuell ergänzte Abteilungen bleiben erhalten.",
      },
    ],
  },
  {
    version: "0.95.7",
    date: "2026-06-14",
    changes: [
      {
        category: "fix",
        description:
          "Portal-Änderungsanträge überschreiben keine zwischenzeitlich geänderten Felder mehr. Wurde ein Feld nach dem Antrag bearbeitet, bleibt der neuere Wert erhalten und das übersprungene Feld wird vermerkt. Außerdem blockiert ein fehlgeschlagener KI-Schreibzugriff den verwendeten Idempotency-Key nicht mehr dauerhaft.",
      },
    ],
  },
  {
    version: "0.95.6",
    date: "2026-06-14",
    changes: [
      {
        category: "fix",
        description:
          "Kleinere Korrekturen: die globale Suche behandelt die Zeichen % und _ jetzt als normale Zeichen statt als Platzhalter. Die Spalte Aktiv/Passiv im Mitglieder-CSV nutzt überall denselben abgeleiteten Wert. Hochgeladene Unterschriften werden nur noch als PNG oder JPEG akzeptiert.",
      },
    ],
  },
  {
    version: "0.95.5",
    date: "2026-06-14",
    changes: [
      {
        category: "fix",
        description:
          "Die Anwendung läuft jetzt fest in der Zeitzone UTC. Damit verschieben sich Geburts-, Eintritts- und Austrittsdaten nicht mehr um einen Tag, falls der Server in einer anderen Zeitzone läuft.",
      },
    ],
  },
  {
    version: "0.95.4",
    date: "2026-06-14",
    changes: [
      {
        category: "fix",
        description:
          "Die Abteilungs-Statistik zählt gelöschte Mitglieder nicht mehr mit. Außerdem werden die Kennzahlen auf dem Dashboard (Umsatz, Zahlungsquote, Mahnstufen) jetzt nach Beitragsläufen, Zahlungen und Mahnläufen sofort aktualisiert statt erst nach einigen Minuten.",
      },
    ],
  },
  {
    version: "0.95.3",
    date: "2026-06-14",
    changes: [
      {
        category: "fix",
        description:
          "Antragsprozess robuster: ein Antrag kann nicht mehr durch gleichzeitiges Genehmigen doppelt zu Mitgliedern führen. Schlägt das Hochladen des unterschriebenen Dokuments wegen einer Speicher-Störung fehl, bleibt der Upload-Link nutzbar statt verbraucht. Die Unterschrift im Online-Antrag ist jetzt größenbegrenzt.",
      },
    ],
  },
  {
    version: "0.95.2",
    date: "2026-06-14",
    changes: [
      {
        category: "fix",
        description:
          "Das Wiederherstellen eines Mitglieds inklusive abhängiger Daten funktioniert jetzt auch für bereits abgerechnete Mitglieder. Verträge und SEPA-Mandate werden dabei aktualisiert statt gelöscht und neu angelegt, sodass verknüpfte Beitragsläufe und Sollstellungen erhalten bleiben. Vorher brach die Wiederherstellung mit einem Fehler ab.",
      },
    ],
  },
  {
    version: "0.95.1",
    date: "2026-06-14",
    changes: [
      {
        category: "fix",
        description:
          "KI-Zugriff: ein Schlüssel behält dauerhaft die Rechte, die bei der Ausstellung bestätigt wurden. Wird der zugehörige Benutzer später höher gestuft, gewinnt der Schlüssel keine zusätzlichen Rechte mehr. Bei einer Herabstufung gelten weiterhin die niedrigeren Rechte.",
      },
    ],
  },
  {
    version: "0.95.0",
    date: "2026-06-14",
    changes: [
      {
        category: "feature",
        description:
          "Datenqualität prüft jetzt Tarif gegen Alter. Beitragsarten können ein Alter von/bis bekommen; passt das Alter eines Mitglieds nicht zur Beitragsart, erscheint es unter Beitragsart passt nicht zum Alter. Zusätzlich zeigt Volljährig auf Eltern-Konto aktive Mitglieder ab 18, deren Lastschrift noch über ein Eltern-Konto läuft. Es wird nichts automatisch umgestellt.",
      },
    ],
  },
  {
    version: "0.94.12",
    date: "2026-06-14",
    changes: [
      {
        category: "fix",
        description:
          "Sperren, Rollenänderungen und erzwungenes Abmelden eines Benutzers wirken jetzt sofort statt erst nach einigen Minuten. Zuvor konnte ein gerade herabgestufter Administrator kurzzeitig weiter mit Adminrechten arbeiten.",
      },
      {
        category: "fix",
        description:
          "KI-Zugriff: der Finanzbericht gibt Beträge als Euro-Werte zurück. Die Werkzeugbeschreibung sprach fälschlich von Cent, was eine KI um den Faktor 100 verrechnen konnte.",
      },
    ],
  },
  {
    version: "0.94.11",
    date: "2026-06-14",
    changes: [
      {
        category: "fix",
        description:
          "Storno eines Beitragslaufs storniert jetzt auch die offenen Rechnungs-Sollstellungen, die er erzeugt hat, sofern noch nichts darauf bezahlt wurde. Vorher blieben sie offen und mahnbar. Außerdem geht die SEPA-Vorabankündigung an den tatsächlichen Kontoinhaber (Zahler), nicht mehr an das abgerechnete Mitglied.",
      },
    ],
  },
  {
    version: "0.94.10",
    date: "2026-06-14",
    changes: [
      {
        category: "fix",
        description:
          "SEPA-Beitragslauf robuster: ein neues Mandat erzeugt auch bei mehreren Verträgen nur noch eine Erstlastschrift (FRST). Anteilige Beiträge, die auf 0,00 EUR runden, erzeugen keine ungültige Lastschrift mehr. Die Vorabankündigung gilt nur als versendet, wenn mindestens eine Mail wirklich rausging, und Fehler werden jetzt protokolliert statt verschluckt.",
      },
    ],
  },
  {
    version: "0.94.9",
    date: "2026-06-14",
    changes: [
      {
        category: "fix",
        description:
          "Ein erneuter Import überschreibt Verträge und SEPA-Mandate jetzt am Platz, statt sie zu löschen und neu anzulegen. Vorher gingen dabei alle in der App erzeugten Sollstellungen samt Zahlungen und Mahnstufen verloren. Bestehende Buchungen bleiben jetzt erhalten.",
      },
    ],
  },
  {
    version: "0.94.8",
    date: "2026-06-14",
    changes: [
      {
        category: "fix",
        description:
          "Zahlungseingänge werden jetzt sicher verbucht, auch wenn zwei gleichzeitig auf dieselbe Sollstellung gebucht werden. Vorher konnte bei zeitgleicher Buchung eine Zahlung verloren gehen.",
      },
    ],
  },
  {
    version: "0.94.7",
    date: "2026-06-14",
    changes: [
      {
        category: "fix",
        description:
          "Beim Zurücksetzen eines einzelnen Feldes aus einem Snapshot wurde eine IBAN im Klartext ins Änderungsprotokoll geschrieben. Solche Geheimfelder werden jetzt auch hier nur noch verkürzt (letzte vier Stellen) protokolliert.",
      },
    ],
  },
  {
    version: "0.94.6",
    date: "2026-06-14",
    changes: [
      {
        category: "fix",
        description:
          "DSGVO-Löschung überarbeitet: Mahnungen werden nicht mehr gelöscht, sondern als Beleg behalten (Aufbewahrungspflicht nach §147 AO), wobei das gerenderte PDF und der Empfänger entfernt werden. Hochgeladene Dokumente eines Mitglieds werden bei der Löschung jetzt auch aus dem Dateispeicher entfernt, und der Freitext im Einwilligungs-Log wird geleert.",
      },
    ],
  },
  {
    version: "0.94.5",
    date: "2026-06-14",
    changes: [
      {
        category: "fix",
        description:
          "Genehmigte oder neu angelegte Mitglieder mit Bankverbindung werden jetzt korrekt per Lastschrift eingezogen. Vorher wurde der Vertrag fälschlich als Rechnung geführt und nie abgebucht, obwohl ein SEPA-Mandat vorlag.",
      },
      {
        category: "fix",
        description:
          "Die Kachel Kontakte in der Mitgliederübersicht zählte in der App angelegte echte Mitglieder mit. Jetzt werden nur noch echte Kontakte ohne Mitgliedsnummer gezählt.",
      },
      {
        category: "fix",
        description:
          "Beim Genehmigen eines Kind-Antrags ohne Namen der Erziehungsberechtigten ging die Bankverbindung verloren. Jetzt wird in dem Fall trotzdem ein Zahler-Kontakt mit IBAN und Mandat angelegt.",
      },
    ],
  },
  {
    version: "0.94.4",
    date: "2026-06-14",
    changes: [
      {
        category: "fix",
        description:
          "Sicherheitsfix für die Mandantenfähigkeit: zwischengespeicherte Daten (Mitgliederliste, Suche, Dashboard, Abteilungen, Beitragsarten) werden jetzt streng pro Verein getrennt. Vorher konnten sich bei gleichen Abfragen Daten zwischen Vereinen über den gemeinsamen Cache vermischen.",
      },
    ],
  },
  {
    version: "0.94.3",
    date: "2026-06-14",
    changes: [
      {
        category: "fix",
        description:
          "Antragsgenehmigung: zahlt ein Antragsteller von einem fremden Konto, wird der abweichende Kontoinhaber jetzt übernommen und als Name der SEPA-Lastschrift geführt. Vorher erschien fälschlich der Name des Mitglieds.",
      },
      {
        category: "improvement",
        description:
          "Beim Genehmigen ohne Beitragsart weist ein Hinweis jetzt darauf hin, dass kein Vertrag angelegt wird und das Mitglied bis dahin nicht abgerechnet wird.",
      },
    ],
  },
  {
    version: "0.94.2",
    date: "2026-06-14",
    changes: [
      {
        category: "improvement",
        description:
          "Die Beitrittserklärung folgt jetzt ebenfalls der DIN-5008-Seitengeometrie: Rand 25 mm links und 20 mm rechts, Falz- und Lochmarken und eine bündige Fußzeile. Damit faltet und locht sie sich wie die übrigen Schreiben.",
      },
    ],
  },
  {
    version: "0.94.1",
    date: "2026-06-14",
    changes: [
      {
        category: "improvement",
        description:
          "Serienbriefe tragen jetzt eine eigene Dokumentnummer im Infoblock und in der Fußzeile, so wie die übrigen Schreiben. Damit hat jedes erzeugte Dokument eine nachvollziehbare Nummer.",
      },
    ],
  },
  {
    version: "0.94.0",
    date: "2026-06-14",
    changes: [
      {
        category: "fix",
        description:
          "Beitrittserklärung: die Anrede passt jetzt zum Text. Statt den Antragsteller mit Sehr geehrter Herr anzureden, beginnt das Dokument mit Sehr geehrte Damen und Herren, da der Antrag an den Verein gerichtet ist.",
      },
      {
        category: "improvement",
        description:
          "Antrags- und Dokumentnummern sind jetzt zufällig und nicht mehr fortlaufend, so wie die Mitgliedsnummern. Sie verraten damit keine Reihenfolge oder Anzahl mehr. Rechnungsnummern bleiben fortlaufend, wie es für Rechnungen vorgeschrieben ist.",
      },
    ],
  },
  {
    version: "0.93.0",
    date: "2026-06-14",
    changes: [
      {
        category: "feature",
        description:
          "Wiedervorlagen überarbeitet: Mehrfachauswahl mit gemeinsamem Erledigen, Wieder-öffnen und Löschen. Über den Filter Offen, Erledigt oder Alle lassen sich auch erledigte Aufgaben einsehen. Einzelne Aufgaben können jetzt gelöscht werden.",
      },
    ],
  },
  {
    version: "0.92.0",
    date: "2026-06-14",
    changes: [
      {
        category: "feature",
        description:
          "Anträge lassen sich jetzt archivieren und endgültig löschen. Archivierte Anträge sind über den Filter Archiviert weiter einsehbar, tauchen aber nicht mehr in der Standardliste auf. Löschen entfernt den Antrag samt Dokumenten dauerhaft.",
      },
    ],
  },
  {
    version: "0.91.3",
    date: "2026-06-14",
    changes: [
      {
        category: "fix",
        description:
          "Zuletzt angesehen zeigte die alte Mitgliedsnummer. Jetzt erscheint dort die aktuelle Nummer, passend zum Rest der Anwendung.",
      },
    ],
  },
  {
    version: "0.91.2",
    date: "2026-06-14",
    changes: [
      {
        category: "improvement",
        description:
          "Der CSV-Export der Mitgliederliste liegt jetzt im Export-Center bei den übrigen Auswertungen. Der Knopf Export in der Mitgliederliste öffnet das Export-Center und übernimmt die aktuelle Suche, den Status und die Abteilung. Im Export-Center gibt es dafür ein neues Suchfeld.",
      },
    ],
  },
  {
    version: "0.91.1",
    date: "2026-06-14",
    changes: [
      {
        category: "fix",
        description:
          "Der Filter Aktiv zeigt jetzt nur noch sport-aktive Mitglieder. Passive (fördernde) Mitglieder erscheinen nicht mehr in der Aktiv-Liste, sondern über die Kachel Passiv. Die Zähler Aktiv und Passiv passen damit zum Mitglieder-Badge.",
      },
    ],
  },
  {
    version: "0.91.0",
    date: "2026-06-14",
    changes: [
      {
        category: "improvement",
        description:
          "Antragsansicht überarbeitet: Dokumente öffnen sich jetzt in einem eingebauten PDF-Viewer statt heruntergeladen zu werden. Die IBAN wird vollständig angezeigt (eine IBAN ist kein Geheimnis), und Status, Antragsnummer und Art sind klarer beschriftet.",
      },
    ],
  },
  {
    version: "0.90.3",
    date: "2026-06-14",
    changes: [
      {
        category: "improvement",
        description:
          "Kleinere Oberflächen-Politur: die Rolle wird ausgeschrieben (z. B. Administrator statt admin), und die Trennlinie der oberen Leiste liegt jetzt bündig mit der Linie der Seitenleiste.",
      },
    ],
  },
  {
    version: "0.90.2",
    date: "2026-06-14",
    changes: [
      {
        category: "fix",
        description:
          "Browser-Symbol (Favicon), Seitentitel und Designfarbe werden jetzt auf allen Seiten zuverlässig gesetzt. Auf manchen Seiten (etwa dem Betreiber-Bereich) fehlten sie und es erschien kein Logo im Browser-Tab.",
      },
    ],
  },
  {
    version: "0.90.1",
    date: "2026-06-14",
    changes: [
      {
        category: "improvement",
        description:
          "Auch Browser-Symbol (Favicon), App-Symbol und das Logo in PDF-Dokumenten zeigen jetzt das neue Kontor2-Zeichen in Navy und Messing. Vereine mit eigenem Logo bleiben unverändert.",
      },
    ],
  },
  {
    version: "0.90.0",
    date: "2026-06-14",
    changes: [
      {
        category: "improvement",
        description:
          "Kontor2 hat ein neues Erscheinungsbild: tiefes Navy mit warmem Messing-Akzent und ein neues Logo, passend zum Namen (Handelskontor). Vereine mit eigenem Logo und eigener Farbe bleiben unverändert.",
      },
    ],
  },
  {
    version: "0.89.0",
    date: "2026-06-14",
    changes: [
      {
        category: "improvement",
        description:
          "Unbekannte Adressen (eine vertippte oder nicht vergebene Subdomain) zeigen jetzt den Betreiber-Bereich statt versehentlich die Daten eines bestimmten Vereins. Die gewohnten Adressen der bestehenden Vereine funktionieren unverändert.",
      },
    ],
  },
  {
    version: "0.88.1",
    date: "2026-06-14",
    changes: [
      {
        category: "fix",
        description:
          "App-Symbol, Web-Manifest, Datei-Downloads und der Portal-Zugang nutzen jetzt durchgängig die Daten des jeweiligen Vereins statt der des Hauptvereins. Bei mehreren Vereinen wurde sonst teils das falsche Logo oder die falsche Datenbank verwendet. Für den bestehenden Verein ändert sich nichts.",
      },
    ],
  },
  {
    version: "0.88.0",
    date: "2026-06-14",
    changes: [
      {
        category: "feature",
        description:
          "Eigenständiger Betreiber-Bereich mit eigenem Login und eigener Datenbank, getrennt von allen Vereinen. Dort lassen sich Vereine anlegen, sperren und entfernen. Für die Vereine selbst ändert sich nichts.",
      },
    ],
  },
  {
    version: "0.87.2",
    date: "2026-06-14",
    changes: [
      {
        category: "internal",
        description:
          "Grundlage für den Betreiber-Bereich: die Vereins-Registry kann jetzt aus einer eigenen Control-Datenbank gelesen werden, getrennt von den Vereinsdaten. Ohne gesetzte Control-Datenbank bleibt alles wie bisher.",
      },
    ],
  },
  {
    version: "0.87.1",
    date: "2026-06-13",
    changes: [
      {
        category: "internal",
        description:
          "Die Vereinsverwaltung wird aus der Vereins-App herausgelöst und zieht in einen eigenständigen Betreiber-Bereich um (eigener Login, eigene Datenbank). Bis dieser bereitsteht ist die Vereinsverwaltung kurzzeitig nicht in der App. Für den laufenden Betrieb ändert sich nichts.",
      },
    ],
  },
  {
    version: "0.87.0",
    date: "2026-06-13",
    changes: [
      {
        category: "feature",
        description:
          "Neuer Bereich Vereine für den Hauptverein: weitere Vereine anlegen, sperren oder entfernen. Beim Anlegen werden Datenbank, Aktualisierungen und ein eigener Schlüssel automatisch eingerichtet. Nur für Admins des Hauptvereins sichtbar.",
      },
    ],
  },
  {
    version: "0.86.0",
    date: "2026-06-13",
    changes: [
      {
        category: "internal",
        description:
          "Jeder Verein verschlüsselt seine sensiblen Daten (z. B. IBANs) jetzt mit einem eigenen Schlüssel, getrennt von den anderen Vereinen. Für den bestehenden Verein bleibt der Schlüssel unverändert, es ist keine Aktion nötig.",
      },
    ],
  },
  {
    version: "0.85.0",
    date: "2026-06-13",
    changes: [
      {
        category: "internal",
        description:
          "Ein neuer Verein lässt sich jetzt automatisiert einrichten: eigene Datenbank, alle Migrationen und der Registry-Eintrag werden in einem Schritt angelegt. Grundlage für die Vereinsverwaltung im Adminbereich. Für den bestehenden Verein ändert sich nichts.",
      },
    ],
  },
  {
    version: "0.84.4",
    date: "2026-06-13",
    changes: [
      {
        category: "internal",
        description:
          "Internes Wartungswerkzeug: der Migrations-Stand jeder Vereins-Datenbank lässt sich jetzt per Befehl abrufen. Keine sichtbare Änderung in der Anwendung.",
      },
    ],
  },
  {
    version: "0.84.3",
    date: "2026-06-13",
    changes: [
      {
        category: "internal",
        description:
          "Beim Ausrollen werden Datenbank-Aktualisierungen jetzt auf alle Vereins-Datenbanken angewendet, nicht mehr nur auf die des Hauptvereins. So bleibt kein Verein bei einer Schema-Änderung zurück. Für den bestehenden Verein ändert sich nichts.",
      },
    ],
  },
  {
    version: "0.84.2",
    date: "2026-06-13",
    changes: [
      {
        category: "internal",
        description:
          "Die Vereins-Registry kann ihre Einträge jetzt aus einer Datenbanktabelle lesen, nicht mehr nur aus einer Umgebungsvariable. Grundlage für die spätere Verwaltung mehrerer Vereine. Die bisherige Konfiguration bleibt als Rückfallebene aktiv, für den bestehenden Verein ändert sich nichts.",
      },
    ],
  },
  {
    version: "0.84.1",
    date: "2026-06-13",
    changes: [
      {
        category: "internal",
        description:
          "Auch Mahnungen, Rundschreiben, Beitragslauf-Benachrichtigungen und Antrags-Mails nutzen jetzt die SMTP-Konfiguration des jeweiligen Vereins, und der Antrags-Statuslink zeigt auf dessen Subdomain. Das App-Symbol (PWA) eines Vereins ohne eigenes Logo ist jetzt das Kontor2-Logo statt eines fremden Wappens. Für den bestehenden Verein unverändert.",
      },
    ],
  },
  {
    version: "0.84.0",
    date: "2026-06-13",
    changes: [
      {
        category: "improvement",
        description:
          "Das Standard-Erscheinungsbild ist jetzt die Produktmarke Kontor2 (Logo, Name). Ein Verein überschreibt das mit seinem eigenen Logo, Anzeigenamen und seiner Farbe unter Einstellungen > Vereinsdaten > Branding. Wer noch nichts gesetzt hat, sieht das Kontor2-Standard.",
      },
    ],
  },
  {
    version: "0.83.3",
    date: "2026-06-13",
    changes: [
      {
        category: "internal",
        description:
          "Einladungs-, Passwort-zurücksetzen- und Test-Mails sowie die Einladungs- und Portal-Links nutzen jetzt die Daten (SMTP, Name, Adresse) des jeweiligen Vereins. Für den bestehenden Verein unverändert. Weitere Mail-Wege (Mahnungen, Rundschreiben, Anträge) folgen pro Verein in einem nächsten Schritt.",
      },
    ],
  },
  {
    version: "0.83.2",
    date: "2026-06-13",
    changes: [
      {
        category: "internal",
        description:
          "Benutzerverwaltung (anlegen, sperren, entsperren, löschen, Passwort setzen), der Letzter-Admin-Schutz, API-Schlüssel und der MCP-Zugriff wirken jetzt pro Verein auf dessen eigene Daten. Für den bestehenden Verein ändert sich nichts.",
      },
    ],
  },
  {
    version: "0.83.1",
    date: "2026-06-13",
    changes: [
      {
        category: "fix",
        description:
          "Zwei Korrekturen für Vereine auf eigener Subdomain: beim vollständigen Seitenaufruf wird jetzt der richtige Verein erkannt (vorher konnte das Branding eines anderen Vereins erscheinen), und die Vereinsdaten-Seite lädt auch dann, wenn noch keine Stammdaten hinterlegt sind (vorher Dauerladekreis) -- das Formular startet mit Vorgaben und legt beim ersten Speichern den Datensatz an.",
      },
    ],
  },
  {
    version: "0.83.0",
    date: "2026-06-13",
    changes: [
      {
        category: "internal",
        description:
          "Anmeldung und Sitzungen laufen jetzt pro Verein getrennt: jeder Verein hat seine eigene Anmeldung, seine eigenen Konten und seine eigene Erstinstallation unter seiner Subdomain. Für den bestehenden Verein ändert sich nichts (gleiche Adresse, gleiche Sitzungen). Grundlage für weitere Vereine auf eigenen Subdomains.",
      },
    ],
  },
  {
    version: "0.82.1",
    date: "2026-06-13",
    changes: [
      {
        category: "internal",
        description:
          "Härtung der Mandanten-Auflösung: der primäre Verein wird direkt aus der Konfiguration aufgelöst, ohne die optionale Mehr-Vereine-Liste zu parsen. Ein fehlerhafter Eintrag in dieser Liste betrifft damit nur zusätzliche Vereine und kann den laufenden Betrieb nicht mehr stören.",
      },
    ],
  },
  {
    version: "0.82.0",
    date: "2026-06-13",
    changes: [
      {
        category: "internal",
        description:
          "Fundament für Mehr-Vereine-Fähigkeit: Anfragen werden anhand der Subdomain einem Verein zugeordnet, jeder Verein bekommt seinen eigenen Datenbank-Pool. Bei aktuell einem Verein landet jeder Aufruf wie bisher bei diesem, kein sichtbarer Unterschied im Betrieb.",
      },
    ],
  },
  {
    version: "0.81.0",
    date: "2026-06-13",
    changes: [
      {
        category: "feature",
        description:
          "Neue Admin-Seite Einstellungen > Verschlüsselung. Sie zeigt je verschlüsselter Spalte (IBANs, SMTP-Passwort), wie viele Felder auf dem aktuellen und wie viele noch auf einem alten Schlüssel liegen, und erlaubt das Umschlüsseln auf den aktuellen Schlüssel per Knopf. Ein Statusbanner sagt, ob ein alter Schlüssel gefahrlos entfernt werden kann.",
      },
    ],
  },
  {
    version: "0.80.3",
    date: "2026-06-13",
    changes: [
      {
        category: "fix",
        description:
          "Member-facing Texte zeigen jetzt durchgängig den eingestellten Vereinsnamen statt eines festen Werts: der Footer der DSGVO-Auskunft (PDF) und die Betreffzeilen von Einladungs- und Test-E-Mail im Versandprotokoll. Die geloggte Betreffzeile entspricht jetzt auch exakt der tatsächlich versendeten. Das App-Manifest war bereits dynamisch; der gebündelte Fallback ist jetzt neutral statt vereinsgebunden.",
      },
    ],
  },
  {
    version: "0.80.2",
    date: "2026-06-13",
    changes: [
      {
        category: "internal",
        description:
          "Der env-gesteuerte Bootstrap-Admin ist entfernt. Das erste Admin-Konto entsteht ausschließlich über die /setup-Seite, solange noch kein Nutzer existiert. Damit liegt kein Admin-Passwort mehr in der Konfiguration.",
      },
    ],
  },
  {
    version: "0.80.1",
    date: "2026-06-13",
    changes: [
      {
        category: "internal",
        description:
          "Abschluss der Schlüsselumstellung: nachdem alle verschlüsselten Felder auf den neuen Schlüssel überführt waren, ist der alte Übergangsschlüssel entfernt. svuwv ist damit vollständig aus der Anwendung verschwunden. Keine Auswirkung im Betrieb.",
      },
    ],
  },
  {
    version: "0.80.0",
    date: "2026-06-13",
    changes: [
      {
        category: "improvement",
        description:
          "Die internen Verschlüsselungs- und Sitzungsschlüssel laufen jetzt unter dem neuen Projektnamen, svuwv ist damit aus der Konfiguration verschwunden. Es bleibt der eine APP_SECRET als einziger zu pflegender Wert. Einmalig ist dafür eine neue Anmeldung nötig, bestehende Sitzungen werden beendet. Verschlüsselte Felder (IBANs, SMTP-Passwort) bleiben erhalten und werden verlustfrei auf den neuen Schlüssel überführt.",
      },
    ],
  },
  {
    version: "0.79.5",
    date: "2026-06-12",
    changes: [
      {
        category: "internal",
        description:
          "Die Schlüsselrotation für verschlüsselte Felder ist jetzt verlustfrei abgesichert. Eine verschlüsselte Spalte (IBAN aus Online-Anträgen) fehlte in der Umschlüsselungs-Liste und wäre bei einer Rotation verwaist. Die Liste ist ergänzt, ein Test erzwingt ihre Vollständigkeit, ein weiterer beweist den vollen Rotations-Zyklus, und eine Schranke verhindert das Entfernen eines Schlüssels, solange noch Daten darauf liegen. Doku unter docs/key-rotation.md.",
      },
    ],
  },
  {
    version: "0.79.4",
    date: "2026-06-12",
    changes: [
      {
        category: "fix",
        description:
          "Der Präfix der SEPA-Mandatsreferenz ist jetzt optional und wird nicht mehr von einem festen Wert überschrieben. Wer das Feld in den Vereinseinstellungen leer lässt, bekommt für neue Mandate eine Referenz nur aus Jahr und Nummer. Behoben ist außerdem ein Fehler, bei dem ein leer abgeschicktes Feld still einen festen Präfix gesetzt und damit den eingestellten Wert überschrieben hat. Bestehende Mandatsreferenzen bleiben unverändert.",
      },
    ],
  },
  {
    version: "0.79.3",
    date: "2026-06-12",
    changes: [
      {
        category: "internal",
        description:
          "Weitere interne svuwv-Reste auf Kontor2 umgestellt: Animationsnamen, Cache-Schlüssel, MCP-Servername, der Geocoding-Kontakt und diverse Kommentare. Die Hell/Dunkel-Wahl und der Was-ist-neu-Hinweis bleiben erhalten, weil der alte Speicher einmalig mitgelesen wird. Verschlüsselung, Mandatsreferenzen, Konfiguration und Daten bleiben unverändert.",
      },
    ],
  },
  {
    version: "0.79.2",
    date: "2026-06-12",
    changes: [
      {
        category: "internal",
        description:
          "Interne Umbenennung des Projekts von svuwv auf Kontor2 (Repo, Paketname, Doku). Kein Effekt auf den laufenden Betrieb. Verschlüsselung, Konfiguration und Daten bleiben unverändert.",
      },
    ],
  },
  {
    version: "0.79.1",
    date: "2026-06-12",
    changes: [
      {
        category: "internal",
        description:
          "Backup- und Restore-Skripte je Mandant (pg_dump/pg_restore, lokal oder nach S3) plus eine Mandanten-Liste als Grundlage für spätere Mehr-Vereine-Fähigkeit. Kein sichtbarer Effekt im laufenden Betrieb.",
      },
    ],
  },
  {
    version: "0.79.0",
    date: "2026-06-12",
    changes: [
      {
        category: "feature",
        description:
          "Für Rechnungszahler lässt sich jetzt eine Rechnung als PDF erzeugen. Auf der Mitgliedsseite erscheint bei offenen Posten ein Knopf Rechnung. Das PDF führt die offenen Beiträge mit Rechnungsnummer, Gesamtbetrag, Zahlungsziel und der Vereins-Bankverbindung zum Überweisen.",
      },
    ],
  },
  {
    version: "0.78.0",
    date: "2026-06-12",
    changes: [
      {
        category: "feature",
        description:
          "Der Beitragslauf berücksichtigt jetzt auch Rechnungszahler. Statt sie zu überspringen, legt er für sie eine offene Sollstellung an (ohne SEPA-Datei). Diese erscheint sofort in den Offenen Posten und im Mahnwesen. Die Vorschau und das Ergebnis zeigen die Zahl der offenen Rechnungen getrennt von den Lastschriften.",
      },
    ],
  },
  {
    version: "0.77.0",
    date: "2026-06-12",
    changes: [
      {
        category: "feature",
        description:
          "Die Zahlart lässt sich jetzt je Vertrag umschalten: Lastschrift oder Rechnung. Auf der Mitgliedsseite genügt ein Klick auf die Zahlart beim Vertrag. Erster Schritt für die Rechnungs-Abwicklung.",
      },
    ],
  },
  {
    version: "0.76.0",
    date: "2026-06-12",
    changes: [
      {
        category: "fix",
        description:
          "Die Zahlart wird wieder korrekt erkannt. Verträge mit dem Linear-Kürzel L (für Lastschrift) galten fälschlich als Rechnung, obwohl der Verein keine Rechnung anbietet. Jetzt zählt nur noch ein echtes Rechnungs-Kennzeichen, der Rest ist Lastschrift. Der Bestand wurde entsprechend korrigiert.",
      },
    ],
  },
  {
    version: "0.75.1",
    date: "2026-06-12",
    changes: [
      {
        category: "improvement",
        description:
          "Kleinere optische Verbesserungen: In der Mitgliederliste steht der Nachname hervorgehoben vor dem helleren Vornamen, ohne Komma. Auf der Mitgliedsseite bleibt der Titel nie leer. Dazu ein paar barrierefreie Beschriftungen und einheitliche Auslassungspunkte.",
      },
    ],
  },
  {
    version: "0.75.0",
    date: "2026-06-12",
    changes: [
      {
        category: "feature",
        description:
          "Die Datenqualität lässt sich jetzt auch als Excel-Datei exportieren. Sie enthält ein Blatt Übersicht mit der Zählung je Prüfung und ein Blatt Befunde mit allen Treffern. Kopfzeile in der Vereinsfarbe, Schweregrad farbig hinterlegt, mit Filter und fixierter Kopfzeile.",
      },
    ],
  },
  {
    version: "0.74.0",
    date: "2026-06-12",
    changes: [
      {
        category: "improvement",
        description:
          "Beim Übernehmen einer Beziehung als Vertreter wird die Bankverbindung des Kindes jetzt mitgezogen, wenn der Name zum Kontoinhaber passt und der Vertreter noch keine eigene IBAN hat. Damit ist der Zahler mit einem Klick einzugsfähig. Ein vorhandenes Konto des Vertreters bleibt unangetastet.",
      },
    ],
  },
  {
    version: "0.73.1",
    date: "2026-06-12",
    changes: [
      {
        category: "improvement",
        description:
          "Beim Anlegen eines Kontakts werden die mitgliedschaftlichen Felder ausgeblendet (Funktion, Spender, Eintritt, Austritt, Beitragsstatus) und der zweite Schritt mit Beitrag und Abteilung entfällt. Ein Kontakt braucht nur Name, Anschrift und Bankverbindung.",
      },
    ],
  },
  {
    version: "0.73.0",
    date: "2026-06-12",
    changes: [
      {
        category: "feature",
        description:
          "Wird ein Kind-Antrag genehmigt, entsteht der Erziehungsberechtigte jetzt als Kontakt mit Bankverbindung und Mandat, und das Kind wird als Vertreter mit ihm verknüpft. Die Bankverbindung liegt nicht mehr beim Kind. Bei einem Familienantrag wird eine Familie angelegt, in der der Antragsteller zahlt. So ist der Zahler von Anfang an sauber hinterlegt.",
      },
    ],
  },
  {
    version: "0.72.0",
    date: "2026-06-12",
    changes: [
      {
        category: "feature",
        description:
          "Im Formular Neues Mitglied lässt sich jetzt zwischen Mitglied und Kontakt umschalten. Ein Kontakt ist kein Mitglied, sondern zum Beispiel ein Zahler, und bekommt eine eigene Kontaktnummer.",
      },
    ],
  },
  {
    version: "0.71.0",
    date: "2026-06-12",
    changes: [
      {
        category: "feature",
        description:
          "Bei Mandate nachtragen lässt sich für ein minderjähriges Mitglied ohne Beziehung jetzt aus dem hinterlegten Kontoinhaber ein Zahler-Kontakt ableiten. Gibt es den Namen schon, wird verknüpft, sonst wird ein Kontakt angelegt und die Bankverbindung des Kindes übernommen. Danach lässt sich das Mandat nachtragen.",
      },
    ],
  },
  {
    version: "0.70.0",
    date: "2026-06-12",
    changes: [
      {
        category: "feature",
        description:
          "Bei Mandate nachtragen lässt sich für ein minderjähriges Mitglied ohne gepflegten Vertreter die vorhandene Beziehung zu einem Erwachsenen mit einem Klick als Vertreter übernehmen. Passt der Name zum hinterlegten Kontoinhaber, wird das als starker Treffer gekennzeichnet. Danach lässt sich das Mandat wie üblich nachtragen oder reaktivieren.",
      },
    ],
  },
  {
    version: "0.69.0",
    date: "2026-06-12",
    changes: [
      {
        category: "feature",
        description:
          "Befunde mit Betrag 0 lassen sich jetzt direkt aus der Datenqualität beheben. Über das Stift-Symbol öffnet sich je betroffenem Mitglied die Vertragsliste. Dort lässt sich der Betrag setzen oder ein beitragsfreier Vertrag als beitragsfrei kennzeichnen, sodass er nicht mehr als Lastschrift gilt.",
      },
    ],
  },
  {
    version: "0.68.0",
    date: "2026-06-12",
    changes: [
      {
        category: "feature",
        description:
          "Einen Datenqualitäts-Befund lässt sich jetzt als geprüft markieren, wenn er bewusst in Ordnung ist (zum Beispiel zahlt über die Familie oder beitragsfrei). Der Befund verschwindet dann aus der Liste, der Zählung und dem Export und löst keine Aufgabe mehr aus. Ein optionaler Grund lässt sich hinterlegen. Geprüfte Befunde stehen je Prüfung unter Geprüft und lassen sich wieder aufnehmen.",
      },
    ],
  },
  {
    version: "0.67.1",
    date: "2026-06-12",
    changes: [
      {
        category: "fix",
        description:
          "Ein am Vertrag gesetzter Zahler bleibt jetzt auch nach einem erneuten Linear-Import erhalten. Vorher hat der Import den Zahler still entfernt.",
      },
    ],
  },
  {
    version: "0.67.0",
    date: "2026-06-12",
    changes: [
      {
        category: "feature",
        description:
          "Pro Vertrag lässt sich jetzt ein expliziter Zahler festlegen, wenn jemand anderes den Beitrag zahlt und sich das nicht aus Familie oder Vertretung ergibt. Der gewählte Zahler hat Vorrang: sein Konto wird belastet und sein SEPA-Mandat geprüft. Zu finden über das Geldbeutel-Symbol beim Vertrag.",
      },
    ],
  },
  {
    version: "0.66.0",
    date: "2026-06-12",
    changes: [
      {
        category: "improvement",
        description:
          "Die Datenqualitäts-Prüfungen für SEPA-Mandat und IBAN folgen jetzt dem Zahler: bei Kindern und Minderjährigen wird das Mandat des Familien-Zahlers oder Vertreters geprüft, nicht das des Kindes. Verträge mit 0 € lösen keinen Treffer mehr aus. Beitragsfreie Verträge, die fälschlich als Lastschrift markiert waren, wurden bereinigt.",
      },
    ],
  },
  {
    version: "0.65.0",
    date: "2026-06-12",
    changes: [
      {
        category: "improvement",
        description:
          "Das eigene Logo erscheint jetzt auch als Browser-Symbol (Favicon) und beim Installieren als App. Name und Farbe der installierten App ziehen mit. Ohne eigenes Logo bleibt das Standardsymbol.",
      },
    ],
  },
  {
    version: "0.64.0",
    date: "2026-06-12",
    changes: [
      {
        category: "improvement",
        description:
          "Das konfigurierte Logo erscheint jetzt auch auf den erzeugten PDFs (Mahnung, Austrittsbestätigung, Beitrittserklärung, Urkunden, Serienbriefe). Einladungs-, Passwort- und Test-E-Mails sprechen vom eigenen Vereinsnamen statt vom Standardkürzel.",
      },
    ],
  },
  {
    version: "0.63.0",
    date: "2026-06-12",
    title: "Eigenes Erscheinungsbild",
    changes: [
      {
        category: "feature",
        description:
          "Die App lässt sich an den eigenen Verein anpassen: Anzeigename, Logo und Markenfarbe werden unter Vereinsdaten gesetzt und gelten überall, auch auf der Anmeldung, im Setup und im Mitgliederportal. Browser-Tab-Titel und Akzentfarbe ziehen mit. Ohne Anpassung bleibt das bisherige Aussehen.",
      },
    ],
  },
  {
    version: "0.62.0",
    date: "2026-06-12",
    changes: [
      {
        category: "feature",
        description:
          "Die Datenqualitäts-Seite kann alle Befunde als CSV exportieren. Eine Zeile je Prüfung und Mitglied, ohne Seitenlimit, für die Abarbeitung außerhalb der App.",
      },
      {
        category: "improvement",
        description:
          "Copyright-Hinweis auf Anmeldung, Setup und in den Versionshinweisen. Die Lizenzangabe im Projekt verweist jetzt auf die LICENSE-Datei.",
      },
    ],
  },
  {
    version: "0.61.0",
    date: "2026-06-12",
    title: "Zahler-Konzept, Stufe 1",
    changes: [
      {
        category: "feature",
        description:
          "Der Beitragslauf belastet jetzt das Konto des Zahlers statt immer das des Mitglieds. Für aktive Kinder einer Familie zahlt der Familien-Zahler, für Minderjährige der in den Beziehungen hinterlegte Vertreter, sonst das Mitglied selbst. Mandat und IBAN werden beim Zahler geprüft, Ausschlussgründe nennen den Zahler.",
      },
      {
        category: "improvement",
        description:
          "Mandate nachtragen arbeitet jetzt Zahler-bezogen. Mandate werden nie beim minderjährigen Mitglied angelegt, sondern beim Zahler, mit Unterschriftsdatum der frühesten Beitrittserklärung. Minderjährige ohne Vertreter oder Familie erscheinen als Datenqualitätsfall ohne Aktion.",
      },
    ],
  },
  {
    version: "0.60.0",
    date: "2026-06-12",
    changes: [
      {
        category: "feature",
        description:
          "Neue Funktion Mandate nachtragen auf der Beitragslauf-Seite. Lastschrift-Mitglieder ohne nutzbares SEPA-Mandat werden aufgelistet. Fehlende Mandate werden mit Unterschriftsdatum gleich Eintrittsdatum nachgetragen, da die Beitrittserklärung das Mandat enthält. Nur scheinbar abgelaufene Mandate aus dem Linear-Import werden reaktiviert. Widerrufene Mandate bleiben unangetastet. Alles wird auditiert.",
      },
    ],
  },
  {
    version: "0.59.0",
    date: "2026-06-11",
    changes: [
      {
        category: "feature",
        description:
          "Sollstellungen lassen sich stornieren. Gedacht für importierte Posten, die in Linear fälschlich als eingezogen standen, etwa nach einer geplatzten Lastschrift. Nach dem Storno zieht der nächste Beitragslauf den Vertrag wieder ein. Posten aus einem App-Beitragslauf sind geschützt, dort bleibt der Weg über Rückläufer und Wiedereinzug.",
      },
    ],
  },
  {
    version: "0.58.0",
    date: "2026-06-11",
    changes: [
      {
        category: "improvement",
        description:
          "Die Seite Netzwerk entfällt. Die Familien-Seite beantwortet die Frage nach Zusammengehörigkeit jetzt direkt und mit klaren Rollen. Beziehungen am einzelnen Mitglied bleiben erhalten, ebenso die Vertreter-Regelung für das Mahnwesen.",
      },
    ],
  },
  {
    version: "0.57.0",
    date: "2026-06-11",
    title: "Familienmitgliedschaften",
    changes: [
      {
        category: "feature",
        description:
          "Familien sind jetzt ein eigenes Konzept. Die neue Seite Familien zeigt, wer zu welcher Familienmitgliedschaft gehört und wer zahlt. Vorschläge entstehen aus Familienbeitrag, Verknüpfungen und gemeinsamer Adresse und werden einzeln bestätigt.",
      },
      {
        category: "feature",
        description:
          "Auf der Mitgliederseite zeigt eine neue Karte die Familie des Mitglieds. Dort lassen sich Familien anlegen, Mitglieder aufnehmen und Zugehörigkeiten beenden. Rollen: Zahler, Partner, Kind.",
      },
    ],
  },
  {
    version: "0.56.5",
    date: "2026-06-11",
    changes: [
      {
        category: "fix",
        description:
          "In der Mitgliederliste wird aktiv und passiv wieder korrekt angezeigt. Durch einen Fehler in der Abfrage galten zuletzt alle Mitglieder als passiv, obwohl die Detailansicht den Status richtig zeigte.",
      },
    ],
  },
  {
    version: "0.56.4",
    date: "2026-06-11",
    changes: [
      {
        category: "fix",
        description:
          "Die Anmeldung funktioniert wieder. Ein Servermodul war versehentlich im Browser-Code gelandet und ließ die Oberfläche nach dem Laden abstürzen, sodass das Anmeldeformular nur zurückgesetzt wurde und nichts passierte.",
      },
    ],
  },
  {
    version: "0.56.3",
    date: "2026-06-11",
    changes: [
      {
        category: "internal",
        description:
          "Das Laufzeit-Image enthält keine Build-Werkzeuge mehr und ist rund 80 MB kleiner. Deployments übertragen und starten dadurch schneller.",
      },
    ],
  },
  {
    version: "0.56.2",
    date: "2026-06-11",
    changes: [
      {
        category: "internal",
        description:
          "Der Health-Check prüft jetzt die PDF-Erzeugung mit. Ein fehlerhaftes Deployment fällt dadurch beim Start auf und geht nicht mehr live, die laufende Version bleibt aktiv.",
      },
    ],
  },
  {
    version: "0.56.1",
    date: "2026-06-10",
    changes: [
      {
        category: "fix",
        description:
          "Läuft die Anmeldung während der Nutzung ab, bleibt die App nicht mehr im Ladebildschirm hängen, sondern leitet zur Anmeldung weiter.",
      },
    ],
  },
  {
    version: "0.56.0",
    date: "2026-06-10",
    title: "Mitgliederliste leichter bedienen",
    changes: [
      {
        category: "improvement",
        description:
          "In der Mitgliederliste öffnet ein Klick auf die ganze Zeile das Mitglied, nicht mehr nur der Klick auf den Namen.",
      },
      {
        category: "improvement",
        description:
          "Der Schnellzugriff am Status, über den sich aus der Liste eine Abteilung hinzufügen ließ, entfällt. Abteilungen pflegt man im Mitglied oder über die Massenaktion. Der Status zeigt aktiv oder passiv jetzt nur noch an.",
      },
      {
        category: "improvement",
        description:
          "Der helle Modus bekommt einen weichen Farbverlauf im Hintergrund, passend zum dunklen Modus.",
      },
    ],
  },
  {
    version: "0.55.0",
    date: "2026-06-10",
    title: "KI-Schnittstelle und Datenqualität",
    changes: [
      {
        category: "fix",
        description:
          "Die Mitgliedersuche mit Status Alle liefert wieder den gesamten Bestand, also auch ausgetretene und gekündigte Mitglieder sowie Kontakte, statt nur die aktiven.",
      },
      {
        category: "fix",
        description:
          "Die KI-Schnittstelle antwortet bei zu vielen Anfragen jetzt mit 429 und einem Retry-After-Hinweis statt mit 401. Ein gültiger Schlüssel wird unter Last nicht mehr fälschlich als ungültig gemeldet.",
      },
      {
        category: "fix",
        description:
          "Mitglieder lassen sich über die KI-Schnittstelle auch über ihre interne ID abrufen. Bestimmte Kontakte führten vorher zu einem Fehler.",
      },
      {
        category: "feature",
        description:
          "Neues Werkzeug für den Massenexport aller Mitglieder über die KI-Schnittstelle, seitenweise per Cursor, statt vieler Einzelabrufe. Die Drill-down-Listen der Datenqualität geben jetzt zusätzlich die Obergrenze und einen Cursor zurück.",
      },
      {
        category: "feature",
        description:
          "Neue Datenqualitäts-Prüfungen: abgelaufene SEPA-Mandate, bald ablaufende Mandate, doppelt vergebene Mitgliedsnummern, vertauschte Vor- und Nachnamen, mehrere Personen in einem Datensatz, Telefon nur Vorwahl, Straße ohne Hausnummer, Vertrag mit Betrag 0 und mögliche Dubletten ohne Geburtsdatum. Echte Fehler werden farblich hervorgehoben.",
      },
      {
        category: "feature",
        description:
          "Nächtliche Auswertung der Datenqualität mit Verlauf im Dashboard, sodass ein fehlerhafter Import am nächsten Morgen als Ausschlag sichtbar wird. Für Fehler wird automatisch eine Aufgabe am betroffenen Mitglied angelegt.",
      },
      {
        category: "feature",
        description:
          "Gemeinsame Prüf- und Normalisierungsregeln für Import und Mitgliederformular. Der Import zeigt vor dem Übernehmen einen Qualitätsbericht mit Zählern je Feld und doppelten Mitgliedsnummern.",
      },
      {
        category: "improvement",
        description:
          "KI-Zugriff: neue Schlüssel sind standardmäßig nur lesend. Schreibrechte müssen beim Anlegen ausdrücklich erlaubt werden. Schreibende Aktionen lassen sich mit einem Idempotency-Key gegen doppelte Ausführung absichern.",
      },
      {
        category: "improvement",
        description:
          "Mitgliedsnummern müssen jetzt eindeutig sein. Vor dem Einspielen müssen vorhandene Doppelvergaben aufgelöst werden, sonst bricht die Datenbank-Migration mit Hinweis auf die betroffenen Datensätze ab.",
      },
    ],
  },
  {
    version: "0.54.0",
    date: "2026-06-10",
    title: "Aktiv und passiv aus den Abteilungen",
    changes: [
      {
        category: "improvement",
        description:
          "Ob ein Mitglied aktiv oder passiv ist, ergibt sich jetzt aus den Abteilungen statt aus einem getrennt gepflegten Schalter. Wer in mindestens einer echten Abteilung aktiv ist, gilt als aktiv, sonst als passiv. Der Schalter im Mitgliederformular, der Schnellumschalter in der Liste, die Sammelaktion Aktiv und Passiv sowie die Option Auf passiv setzen beim Austritt entfallen. Mitgliederliste, Statistik, CSV-Export und Rundschreiben-Segmente rechnen einheitlich nach dieser Regel.",
      },
    ],
  },
  {
    version: "0.53.0",
    date: "2026-06-10",
    title: "Detailansichten für Rundschreiben und Bestandserhebung",
    changes: [
      {
        category: "feature",
        description:
          "Rundschreiben: Der Verlauf hat jetzt je Eintrag eine Detailansicht mit allen Empfängern und ihrem Zustellstatus, inklusive der Fehlermeldung bei nicht zugestellten E-Mails.",
      },
      {
        category: "feature",
        description:
          "Bestandserhebung: Archivierte Erhebungen lassen sich aufklappen und zeigen Stichtag, Signoff, vollständigen SHA-256 und die hinterlegte Notiz.",
      },
    ],
  },
  {
    version: "0.52.0",
    date: "2026-06-10",
    title: "Beziehungen bearbeiten, Ehrungen zurücknehmen",
    changes: [
      {
        category: "feature",
        description:
          "Beziehungen am Mitglied lassen sich jetzt bearbeiten: Beziehungsart, Notiz sowie Von- und Bis-Datum können nachträglich geändert werden, nicht nur die Vertretung und das Löschen.",
      },
      {
        category: "feature",
        description:
          "Ehrungen: Ein versehentlich gesetzter Ehrungsvermerk lässt sich in der Ehrungsliste direkt zurücknehmen.",
      },
    ],
  },
  {
    version: "0.51.0",
    date: "2026-06-10",
    title: "DSGVO-Status und KI-Schlüssel deaktivieren",
    changes: [
      {
        category: "feature",
        description:
          "DSGVO-Anträge lassen sich jetzt bearbeiten: Status setzen (Offen, In Bearbeitung, Erledigt, Abgelehnt) und Notizen pflegen. Wird ein Antrag auf Erledigt gesetzt, wird der Abschlusszeitpunkt vermerkt. Jede Änderung landet im Audit-Protokoll.",
      },
      {
        category: "feature",
        description:
          "KI-Zugriff: API-Schlüssel können deaktiviert und wieder aktiviert werden, ohne sie zu löschen. Ein deaktivierter Schlüssel wird abgewiesen, behält aber seine Historie.",
      },
    ],
  },
  {
    version: "0.50.0",
    date: "2026-06-10",
    title: "Anträge bearbeiten, Portal-Zugänge widerrufen",
    changes: [
      {
        category: "feature",
        description:
          "Anträge: In der Detailansicht lassen sich jetzt der Bearbeitungsstatus (Eingegangen, Scan eingegangen, Dokument hochgeladen, In Bearbeitung) setzen und interne Notizen pflegen, ohne den Antrag schon genehmigen oder ablehnen zu müssen.",
      },
      {
        category: "feature",
        description:
          "Anträge: CSV-Export der Liste und eine kurze Übersicht (gesamt, genehmigt, offen) oben auf der Seite.",
      },
      {
        category: "feature",
        description:
          "Portal-Zugang: Beim Mitglied werden die ausgegebenen Zugangslinks mit Status angezeigt und lassen sich einzeln widerrufen. Ein widerrufener Link beendet auch eine bereits laufende Portal-Sitzung.",
      },
    ],
  },
  {
    version: "0.49.0",
    date: "2026-06-10",
    title: "Passwörter und Sitzungen",
    changes: [
      {
        category: "feature",
        description:
          "Passwort vergessen: Auf der Anmeldeseite gibt es jetzt einen Link, über den man sich einen Link zum Zurücksetzen per E-Mail schicken lassen kann. Der Link ist eine Stunde gültig. Funktioniert nur, wenn SMTP eingerichtet ist.",
      },
      {
        category: "feature",
        description:
          "Eigenes Passwort ändern: In der Benutzer-Verwaltung lässt sich das Passwort des eigenen Kontos ändern. Andere offene Sitzungen werden dabei beendet.",
      },
      {
        category: "feature",
        description:
          "Admin-Werkzeuge je Benutzer: Passwort zurücksetzen (erzeugt ein temporäres Passwort, das einmalig angezeigt wird) und alle Sitzungen beenden (erzwingt eine erneute Anmeldung). Beides wird im Audit-Protokoll vermerkt.",
      },
    ],
  },
  {
    version: "0.48.0",
    date: "2026-06-10",
    title: "Benutzer verwalten: sperren und löschen",
    changes: [
      {
        category: "feature",
        description:
          "Die Benutzer-Verwaltung kann Konten jetzt sperren und endgültig löschen, nicht nur einladen und die Rolle ändern. Gesperrte Benutzer können sich nicht mehr anmelden, laufende Sitzungen werden beendet, die Sperre lässt sich wieder aufheben. Beim Löschen werden Sitzungen, Zugänge und API-Schlüssel mit entfernt. Der letzte aktive Administrator und das eigene Konto sind geschützt. Beides landet im Audit-Protokoll.",
      },
      {
        category: "feature",
        description:
          "Versendete Einladungen sind jetzt sichtbar. Eine neue Liste zeigt offene, eingelöste, widerrufene und abgelaufene Einladungen mit Status; offene Einladungen lassen sich direkt widerrufen.",
      },
    ],
  },
  {
    version: "0.47.0",
    date: "2026-06-10",
    title: "Mitglieder zusammenführen",
    changes: [
      {
        category: "feature",
        description:
          "Doppelt erfasste Mitglieder lassen sich jetzt zusammenführen. Alle Verträge, SEPA-Mandate, Sollstellungen, Beziehungen, Ehrungen, Abteilungen, Aufgaben und Dokumente wandern auf den behaltenen Datensatz, der andere wird gelöscht. Einträge, die sonst eine Dublette erzeugen würden, bleiben am gelöschten Datensatz und werden im Ergebnis ausgewiesen. Nichts wird unwiderruflich entfernt. Die Funktion ist nur für Administratoren und steht auch KI-Assistenten mit Admin-Schlüssel zur Verfügung.",
      },
    ],
  },
  {
    version: "0.46.0",
    date: "2026-06-10",
    title: "KI-Zugriff: Datenqualität beheben",
    changes: [
      {
        category: "feature",
        description:
          "KI-Assistenten (MCP) können erkannte Datenqualitätsprobleme jetzt auch direkt beheben, nicht nur anzeigen. Am Mitglied lassen sich IBAN, BIC und die gesetzliche Vertretung pflegen, Verträge anlegen und ändern sowie SEPA-Mandate anlegen. Die Beitragsarten sind dafür über die Schnittstelle abrufbar. Alle Änderungen brauchen Vorstand-Rechte und landen im Audit-Protokoll. Mitglieder zusammenführen, Beitragsläufe, Import und Einstellungen bleiben gesperrt.",
      },
    ],
  },
  {
    version: "0.45.0",
    date: "2026-06-10",
    title: "KI-Zugriff: Datenqualität im Detail",
    changes: [
      {
        category: "feature",
        description:
          "KI-Assistenten (MCP) können jetzt nicht nur die Datenqualität zählen, sondern auch die betroffenen Mitglieder einer Kategorie auflisten. So lässt sich direkt nachfragen, welche Mitglieder etwa eine Lastschrift ohne Mandat oder keinen laufenden Vertrag haben. Lesend, nur mit Vorstand-Rechten, höchstens 500 Treffer.",
      },
    ],
  },
  {
    version: "0.44.0",
    date: "2026-06-10",
    title: "KI-Zugriff (MCP)",
    changes: [
      {
        category: "feature",
        description:
          "Neue Schnittstelle für KI-Assistenten wie Claude (MCP). Unter Einstellungen, KI-Zugriff können Administratoren Zugriffsschlüssel erstellen und widerrufen. Ein Schlüssel handelt mit der Rolle des verknüpften Benutzers: Readonly-Schlüssel können nur lesen, Vorstand-Schlüssel zusätzlich Mitglieder und Aufgaben bearbeiten. Beitrags- und Mahnläufe, SEPA und Einstellungen bleiben gesperrt, jede Änderung landet im Audit-Protokoll.",
      },
    ],
  },
  {
    version: "0.43.0",
    date: "2026-06-10",
    title: "Sicherheits-Update",
    changes: [
      {
        category: "improvement",
        description:
          "Anmeldung, Einladungs-Links, Portal-Zugangslinks und die Antrags-Statusabfrage sind jetzt gegen automatisiertes Durchprobieren abgesichert. Nach zu vielen Versuchen in kurzer Zeit wird kurz pausiert. Im normalen Gebrauch ist davon nichts zu merken.",
      },
      {
        category: "internal",
        description:
          "Datei-Downloads setzen den Dateinamen jetzt nach Standard und entschärfen Sonderzeichen. Der Dokumente-Import begrenzt die entpackte Größe gegen manipulierte ZIP-Dateien. Der Server läuft im Container ohne Root-Rechte.",
      },
    ],
  },
  {
    version: "0.42.0",
    date: "2026-06-10",
    title: "SVUMS Antrags-Import",
    changes: [
      {
        category: "feature",
        description:
          "Bereits bearbeitete Anträge aus der alten SVUMS-Anwendung lassen sich jetzt unter Datenimport übernehmen. Grundlage ist der JSON-Export der SVUMS-Antragsliste. Status, Stammdaten, Familie, Bankverbindung und Einwilligungen werden importiert, genehmigte Anträge werden mit dem passenden Mitglied verknüpft. Der Import ist idempotent, mehrfaches Hochladen erzeugt keine Duplikate.",
      },
      {
        category: "feature",
        description:
          "Der SVUMS-Import braucht keine Exporte: Adresse der laufenden SVUMS-Instanz und Admin-Passwort eingeben, Anträge und Dokumente (unterschriebene Scans, genehmigte PDFs) werden automatisch abgerufen und dem richtigen Antrag zugeordnet. Alternativ funktioniert der Datei-Weg mit JSON-Export und optionalem Dokumente-ZIP.",
      },
    ],
  },
  {
    version: "0.41.1",
    date: "2026-06-10",
    changes: [
      {
        category: "internal",
        description:
          "Alle Abhängigkeiten auf den aktuellen Stand gebracht. Keine Änderung an der Bedienung.",
      },
    ],
  },
  {
    version: "0.41.0",
    date: "2026-06-09",
    title: "Übersichtlicheres Beziehungsnetzwerk",
    changes: [
      {
        category: "improvement",
        description:
          "Das Beziehungsnetzwerk ist neu angeordnet. Jede Familie sitzt jetzt als eigene farbige Blase in einer runden Karte, die größten Familien in der Mitte, statt als gleichförmiges Raster aus Punkten. Verbindungen sind leicht geschwungen und Gruppen sind auf einen Blick zu erkennen.",
      },
    ],
  },
  {
    version: "0.40.0",
    date: "2026-06-09",
    title: "Klarere Auswertungen und deutsche Beschriftungen",
    changes: [
      {
        category: "improvement",
        description:
          "Die Diagramme auf der Übersicht zeigen beim Überfahren mit der Maus jetzt eine saubere Sprechblase mit Jahr und Wert statt des grauen Browser-Hinweises. Der gerade betrachtete Balken oder Punkt wird hervorgehoben.",
      },
      {
        category: "improvement",
        description:
          "Englische Menüpunkte sind übersetzt: aus Dashboard wird Übersicht, aus Audit Log wird Änderungsprotokoll, aus Import wird Datenimport.",
      },
      {
        category: "improvement",
        description:
          "Der Kopfbereich einer Mitgliederseite ist aufgeräumt. Mitglieds-, Alt- und Adressnummer stehen als kompakte Felder nebeneinander, mit Erklärung beim Überfahren.",
      },
      {
        category: "improvement",
        description:
          "Nach dem Anlegen oder Speichern eines Mitglieds erscheint eine kurze Bestätigung.",
      },
      {
        category: "fix",
        description:
          "Beim Erfassen von Rückläufern tauchen gelöschte Mitglieder nicht mehr in der Auswahl auf.",
      },
      {
        category: "fix",
        description:
          "Die Finanzkennzahlen der Übersicht werden jetzt centgenau aus der Datenbank summiert, ohne Rundungsabweichung.",
      },
      {
        category: "fix",
        description:
          "Ein am 29. Februar eingetretenes Mitglied bekommt sein Jubiläum in einem Nicht-Schaltjahr korrekt auf den 28. Februar gelegt, nicht mehr auf den 1. März.",
      },
      {
        category: "fix",
        description:
          "Bei den Vereinsdaten wird die BIC auf das gültige Format geprüft, damit eine fehlerhafte Eingabe nicht erst beim Bankupload auffällt.",
      },
      {
        category: "improvement",
        description:
          "Symbol-Schaltflächen wie Bearbeiten, Löschen oder Speichern haben jetzt durchgängig eine Beschriftung für Screenreader. Ladehinweise nutzen das richtige Auslassungszeichen, und eine fehlende Mandatsreferenz wird einheitlich als Leerwert angezeigt.",
      },
    ],
  },
  {
    version: "0.39.0",
    date: "2026-06-09",
    title: "Zurückgelastete Beiträge erneut einziehen",
    changes: [
      {
        category: "feature",
        description:
          "Eine zurückgelastete Sollstellung lässt sich jetzt erneut per SEPA einziehen, ohne sie vorher löschen zu müssen. Unter Beitragsläufe gibt es dafür den Punkt Erneut einziehen. Korrigieren Sie beim Mitglied zuerst die IBAN oder das Mandat, wählen Sie die Posten aus und erzeugen Sie eine neue pain.008-Datei für den Bankupload.",
      },
      {
        category: "improvement",
        description:
          "Die Wiedereinzug-Liste zeigt zu jedem Rückläufer direkt an, ob er einziehbar ist. Fehlt ein Mandat oder eine IBAN, ist der Einzug ausgesetzt oder läuft der Vertrag auf Rechnung, steht der Grund dahinter und der Posten kann nicht ausgewählt werden.",
      },
    ],
  },
  {
    version: "0.38.0",
    date: "2026-06-09",
    title: "Frischeres Erscheinungsbild und ruhigeres Formular",
    changes: [
      {
        category: "improvement",
        description:
          "Die ganze Oberfläche bekommt einen dezenten, animierten Farbverlauf im Hintergrund, und das öffentliche Beitrittsformular hat jetzt einen Kopfbereich im Vereinsrot. Wer Animationen reduziert eingestellt hat, sieht den ruhenden Verlauf.",
      },
      {
        category: "improvement",
        description:
          "Die Familienangaben im Beitrittsformular sind eingeklappt und öffnen sich erst per Klick. Der häufige Fall einer Einzel- oder Kindmitgliedschaft bleibt dadurch übersichtlich. Vorhandene Angaben aus einem Entwurf bleiben sichtbar.",
      },
      {
        category: "improvement",
        description:
          "Korrekt ausgefüllte Pflichtfelder im Beitrittsformular zeigen jetzt ein grünes Häkchen, sodass auf einen Blick erkennbar ist, was passt.",
      },
      {
        category: "improvement",
        description:
          "Fehlt beim Weiterklicken eine Angabe, springt das Formular zum ersten markierten Feld und zeigt an, wie viele Felder noch zu prüfen sind.",
      },
      {
        category: "improvement",
        description:
          "Schon während der Eingabe weist ein dezenter Hinweis darauf hin, falls zu Name und Geburtsdatum bereits ein Antrag bestehen könnte. Abschicken bleibt jederzeit möglich.",
      },
      {
        category: "improvement",
        description:
          "Mehrere Kinder lassen sich jetzt einzeln ein- und ausklappen, eine Telefonnummer kann bewusst weggelassen werden, und kurze Hilfetexte erklären das SEPA-Mandat.",
      },
      {
        category: "improvement",
        description:
          "Der Fußbereich des Beitrittsformulars zeigt jetzt Anschrift, Kontakt und Links zu Datenschutz und Satzung des Vereins.",
      },
    ],
  },
  {
    version: "0.37.0",
    date: "2026-06-09",
    title: "Beitrittsformular mit mehr Politur",
    changes: [
      {
        category: "improvement",
        description:
          "Das öffentliche Beitrittsformular führt jetzt klarer durch: ein kurzer Überblick „So funktioniert's“ am Anfang, eine hervorgehobene Tarifkarte mit Jahresbeitrag, ein Fortschrittsbalken über die drei Schritte und sanfte Übergänge zwischen ihnen.",
      },
      {
        category: "improvement",
        description:
          "Nach dem Absenden gibt es eine eigene Bestätigungsseite mit Antragsnummer zum Kopieren und einer Übersicht der nächsten Schritte. Die Statusseite zeigt den Fortschritt als Zeitleiste.",
      },
      {
        category: "improvement",
        description:
          "Bei der IBAN-Eingabe wird die erkannte Bank direkt angezeigt, und die Abteilungsauswahl ist deutlicher als aktiv markiert.",
      },
      {
        category: "feature",
        description:
          "Eingaben im Beitrittsformular werden automatisch zwischengespeichert und beim erneuten Öffnen wiederhergestellt, solange der Browser-Tab offen bleibt.",
      },
      {
        category: "feature",
        description:
          "Die Unterschrift lässt sich jetzt im Vollbild zeichnen, was besonders auf dem Smartphone angenehmer ist.",
      },
      {
        category: "improvement",
        description:
          "Vor dem Absenden weist das Formular dezent darauf hin, wenn zu Name und Geburtsdatum bereits ein Antrag oder eine Mitgliedschaft bestehen könnte.",
      },
      {
        category: "feature",
        description:
          "Die Adresseingabe im Beitrittsformular schlägt jetzt Straßen vor und ergänzt den Ort automatisch anhand der Postleitzahl (über OpenStreetMap).",
      },
      {
        category: "feature",
        description:
          "Wer die Beitrittserklärung schon auf Papier ausgefüllt hat, kann unter /antrag/papierformular einen Scan hochladen, ohne das Online-Formular auszufüllen. Der Antrag landet als Papier-Scan im Bereich Anträge zur Erfassung durch den Vorstand.",
      },
    ],
  },
  {
    version: "0.36.0",
    date: "2026-06-09",
    title: "Klareres Online-Beitrittsformular",
    changes: [
      {
        category: "improvement",
        description:
          "Das öffentliche Beitrittsformular hat jetzt erklärende Hinweise an jedem Schritt: erkannter Tarif und Jahresbeitrag direkt bei den Mitgliedsdaten, der vollständige SEPA-Mandatstext mit Gläubiger-ID, eine ausführliche Zusammenfassung mit Bearbeiten-Sprüngen und beschriftete Optionen für die Unterschrift.",
      },
      {
        category: "fix",
        description:
          "Überschrift und Titel im Versionshinweise-Dialog werden wieder in voller Schriftfarbe dargestellt statt in blassem Grau.",
      },
    ],
  },
  {
    version: "0.35.0",
    date: "2026-06-09",
    title: "Versandprotokoll, Gegenzeichnung und Antrags-Dokumente",
    changes: [
      {
        category: "feature",
        description:
          "Neues Versandprotokoll unter Verwaltung: alle von der App versendeten E-Mails an einer Stelle, mit Status (versendet, übersprungen, fehlgeschlagen). Erfasst werden Antragsbestätigungen, Vereinsbenachrichtigungen, Genehmigungen und Ablehnungen, Mahnungen, Benutzereinladungen, Portalzugänge und Test-E-Mails.",
      },
      {
        category: "feature",
        description:
          "Der Vorstand kann eine Gegenzeichnung als Bild hinterlegen. Sie wird beim Genehmigen in die Beitrittserklärung eingebettet, zusammen mit der Unterschrift des Antragstellers, und dem Antragsteller als genehmigtes PDF zugeschickt.",
      },
      {
        category: "feature",
        description:
          "Die Antrags-Detailseite zeigt jetzt alle erzeugten Dokumente zum Öffnen sowie den E-Mail-Verlauf des Antrags aus dem Versandprotokoll.",
      },
      {
        category: "internal",
        description:
          "Neuer Generator für Testanträge und ein Hinweis, dass die alte svums-Schnittstelle abgelöst ist.",
      },
    ],
  },
  {
    version: "0.34.1",
    date: "2026-06-09",
    changes: [
      {
        category: "fix",
        description:
          "Das Annehmen einer Einladung legt das Benutzerkonto wieder korrekt an. Die voreingestellte Rolle war nicht erlaubt und führte beim Speichern zu einem Fehler.",
      },
    ],
  },
  {
    version: "0.34.0",
    date: "2026-06-09",
    title: "Anträge bearbeiten",
    changes: [
      {
        category: "feature",
        description:
          "Neuer Bereich „Anträge“ in der Seitenleiste. Eingegangene Online-Aufnahmeanträge lassen sich dort suchen, filtern und im Detail ansehen.",
      },
      {
        category: "feature",
        description:
          "Ein Antrag kann genehmigt werden: Daraus entsteht ein Mitglied (bei Familienanträgen inklusive Partner und Kindern) mit Bankverbindung als SEPA-Mandat und optionalem Beitragsvertrag. Eine Ablehnung mit Begründung wird dem Antragsteller per E-Mail mitgeteilt.",
      },
      {
        category: "feature",
        description:
          "Wer die Beitrittserklärung lieber auf Papier unterschreibt, bekommt sie per E-Mail und kann den unterschriebenen Scan über einen Link (30 Tage gültig) wieder hochladen.",
      },
    ],
  },
  {
    version: "0.33.0",
    date: "2026-06-09",
    title: "Online-Aufnahmeantrag",
    changes: [
      {
        category: "feature",
        description:
          "Neue Beitrittserklärungen können online unter /antrag gestellt werden. Das Formular führt in drei Schritten durch Mitgliedsdaten, SEPA-Lastschrift und Zusammenfassung, erkennt Einzel-, Kind- und Familienanträge automatisch, berechnet den Jahresbeitrag und nimmt die Unterschrift direkt entgegen oder schickt die Erklärung per E-Mail zum Unterschreiben.",
      },
      {
        category: "feature",
        description:
          "Unter /antrag/status können Antragsteller mit ihrer Antragsnummer jederzeit den Bearbeitungsstand einsehen.",
      },
    ],
  },
  {
    version: "0.32.0",
    date: "2026-06-09",
    title: "Aufnahmeantrag: Grundlagen",
    changes: [
      {
        category: "feature",
        description:
          "Die Vereinsdaten haben einen neuen Abschnitt „Aufnahmeantrag“. Dort lassen sich die Jahresbeiträge je Alterskategorie, das Mandatsreferenz-Präfix und die Benachrichtigung über neue Anträge festlegen. Das ist die Grundlage für das kommende Online-Antragsformular.",
      },
      {
        category: "internal",
        description:
          "Verarbeitung für eingehende Aufnahmeanträge: Beitrag und Kategorie werden automatisch aus dem Geburtsdatum bestimmt, die Beitrittserklärung als PDF erzeugt und an Antragsteller und Verein versendet.",
      },
    ],
  },
  {
    version: "0.31.0",
    date: "2026-06-09",
    title: "Ruhend und Beitragsbefreiung",
    changes: [
      {
        category: "feature",
        description:
          "Ein Mitglied lässt sich jetzt als „Ruhend“ oder „Beitragsbefreit“ kennzeichnen. Beide bleiben vollwertige Mitglieder und zählen im Bestand, werden im Beitragslauf aber übersprungen. Die Einstellung steht im Reiter Stammdaten unter „Beitrag“.",
      },
      {
        category: "improvement",
        description:
          "Im Beitragslauf erscheinen übersprungene Mitglieder mit dem Grund „Ruhend“ oder „Beitragsbefreit“ in der Ausschlussliste, sodass nachvollziehbar ist, warum keine Sollstellung erstellt wurde.",
      },
    ],
  },
  {
    version: "0.30.0",
    date: "2026-06-09",
    title: "Geplante Austritte",
    changes: [
      {
        category: "feature",
        description:
          "Ein Austritt mit Datum in der Zukunft zählt jetzt richtig: Das Mitglied bleibt bis zum Austrittstag aktiv und wird mit dem Hinweis „Kündigt zum …“ angezeigt. Erst am Stichtag wechselt der Status auf ausgetreten.",
      },
      {
        category: "feature",
        description:
          "In der Mitgliederliste gibt es den neuen Status „Gekündigt“ als Filter und als Kachel. So sind alle Mitglieder mit anstehendem Austritt auf einen Blick sichtbar.",
      },
      {
        category: "improvement",
        description:
          "Gekündigte Mitglieder werden bis zum Austrittstag weiterhin in der Mitgliederzahl, in der Bestandserhebung und im Beitragslauf berücksichtigt. So stimmen Auswertungen und Abrechnung mit dem tatsächlichen Mitgliederbestand überein.",
      },
    ],
  },
  {
    version: "0.29.2",
    date: "2026-06-09",
    changes: [
      {
        category: "improvement",
        description:
          "Bei einem Update fährt die Anwendung jetzt sauber herunter. Laufende Anfragen werden noch zu Ende bearbeitet, bevor der Dienst neu startet. Dadurch kommt es während einer Aktualisierung seltener zu abgebrochenen Aktionen.",
      },
    ],
  },
  {
    version: "0.29.1",
    date: "2026-06-09",
    changes: [
      {
        category: "fix",
        description:
          "Das Nachtragen der Abteilung „Keine Abteilung“ im Adminbereich schlug mit einem Datenbankfehler fehl. Mitglieder ohne aktive Abteilung werden jetzt wieder korrekt zugeordnet.",
      },
    ],
  },
  {
    version: "0.29.0",
    date: "2026-06-08",
    title: "Systemprotokoll",
    changes: [
      {
        category: "feature",
        description:
          "Unter Verwaltung gibt es das Systemprotokoll. Es zeigt die Anwendungslogs aus dem laufenden Betrieb mit Stufe, Meldung, Zeitpunkt und allen technischen Feldern. So lassen sich Ereignisse und Fehler nachvollziehen, ohne auf die Serverkonsole zuzugreifen. Die Seite ist nur für Administratoren sichtbar.",
      },
      {
        category: "feature",
        description:
          "Das Protokoll lässt sich nach Stufe, Zeitraum und Freitext filtern, nach einer Anfrage oder Prozedur eingrenzen und im Live-Modus automatisch aktualisieren. Über die Anfrage-ID lassen sich alle Einträge eines Vorgangs zusammenführen.",
      },
      {
        category: "improvement",
        description:
          "Die Logs werden zusätzlich zur Konsole in der Datenbank gespeichert. Sie werden gebündelt geschrieben, damit der Betrieb nicht ausgebremst wird, und nach 14 Tagen oder beim Erreichen der Höchstmenge automatisch aufgeräumt. Sensible Werte wie IBANs oder Passwörter werden nie protokolliert.",
      },
    ],
  },
  {
    version: "0.28.0",
    date: "2026-06-08",
    title: "Massenbearbeitung und UI-Feinschliff",
    changes: [
      {
        category: "feature",
        description:
          "Die Mitgliederliste kann für die Auswahl jetzt die Mahnsperre und die Einzugssperre setzen oder aufheben und Mitglieder gesammelt in den Papierkorb verschieben.",
      },
      {
        category: "feature",
        description:
          "Auf der Datenpflege gibt es einen Knopf, der bestehende aktive Mitglieder ohne Sparte der Abteilung Keine Abteilung zuordnet. Das holt die Mitglieder nach, die vor der Importänderung keine Zuordnung bekamen.",
      },
      {
        category: "improvement",
        description:
          "Leere Felder werden überall einheitlich mit einem Strich dargestellt, statt mal k.A., mal Bindestrich, mal leer. Die alte Mitgliedsnummer steht klar beschriftet als Alt-Nr.",
      },
      {
        category: "improvement",
        description:
          "Kleinere Verbesserungen: einheitliche Auslassungspunkte, beschriftete Symbolschaltflächen für Screenreader und korrekte Bindestriche in der Bestandserhebung.",
      },
      {
        category: "improvement",
        description:
          "SEPA-Rückläufer zeigen den Rückgabegrund im Klartext, zum Beispiel AM04: Konto ohne Deckung, statt nur den Code.",
      },
      {
        category: "improvement",
        description:
          "Ladeanzeigen auf den Forderungs- und Portalseiten nutzen einheitliche Platzhalter, Telefonnummern werden sauberer dargestellt und der Mandatswiderruf nutzt den gestylten Bestätigungsdialog.",
      },
    ],
  },
  {
    version: "0.27.0",
    date: "2026-06-08",
    title: "Datenpflege und Keine Abteilung",
    changes: [
      {
        category: "feature",
        description:
          'Auf der Datenqualität-Seite lassen sich doppelte Beitragsarten und doppelte Abteilungen zusammenführen. Alle Verträge bzw. Mitgliedschaften wandern auf den Zieleintrag, der Quelleintrag wird gelöscht. Damit verschwindet zum Beispiel eine Altlast wie "Erwachsene doppelt".',
      },
      {
        category: "feature",
        description:
          'Die Mitgliederliste hat einen Filter "Ohne Abteilung", der alle aktiven Mitglieder ohne Spartenzuordnung zeigt.',
      },
      {
        category: "improvement",
        description:
          'Der Import legt für die Linear-Markierung "Keine-Abteilung" jetzt eine echte Abteilung "Keine Abteilung" an, statt sie zu verwerfen. Betroffene Mitglieder bleiben so auffindbar. Wirkt beim nächsten Import.',
      },
    ],
  },
  {
    version: "0.26.1",
    date: "2026-06-08",
    title: "Korrekturen und Feinschliff",
    changes: [
      {
        category: "fix",
        description:
          "Mahnungen für Minderjährige gehen nicht mehr an einen gelöschten oder verstorbenen gesetzlichen Vertreter. Die Anschrift fällt dann auf das Mitglied selbst zurück.",
      },
      {
        category: "fix",
        description:
          "Der Beitragslauf bricht mit klarer Meldung ab, wenn die Vereins-BIC fehlt, statt eine SEPA-Datei zu erzeugen, die die Bank ablehnt.",
      },
      {
        category: "fix",
        description:
          "Die DSGVO-Löschfrist berücksichtigt jetzt auch Posten aus Beitragsläufen. So werden steuerlich aufzubewahrende Daten nicht zu früh gelöscht.",
      },
      {
        category: "fix",
        description:
          "Die Anmeldung im Mitgliederportal setzt das Sitzungscookie hinter dem Server-Proxy wieder als Secure.",
      },
      {
        category: "fix",
        description:
          "Die Liste der Beitragsarten zeigt bei einem Ladefehler eine Fehlermeldung mit Wiederholen statt fälschlich 'Noch keine Beitragsarten'.",
      },
      {
        category: "fix",
        description: "Im Portal lässt sich kein leerer Änderungsvorschlag mehr absenden.",
      },
      {
        category: "improvement",
        description:
          "Warnhinweise beim Zahlungsabgleich und bei Rücklastschriften nutzen die einheitliche Warnfarbe und passen sich dem Dunkelmodus an.",
      },
    ],
  },
  {
    version: "0.26.0",
    date: "2026-06-08",
    title: "Beitragslauf und Rücklastschriften",
    changes: [
      {
        category: "feature",
        description:
          "Der Beitragslauf läuft jetzt inkrementell. Ein erneuter Lauf für dasselbe Jahr zieht nur Mitglieder ein, die seit dem letzten Lauf dazugekommen oder wieder freigegeben wurden. Sind bereits alle abgerechnet, bleibt der Lauf leer. Ein kompletter Storno ist dafür nicht mehr nötig.",
      },
      {
        category: "feature",
        description:
          "Rücklastschriften lassen sich als camt.054-Datei der Bank importieren. Die Rückläufer werden über die End-to-End-ID automatisch dem Beitragslauf zugeordnet. Bestätigte Treffer setzen die Sollstellung wieder offen.",
      },
      {
        category: "feature",
        description:
          'Neuer Schalter je Mitglied unter Bankverbindung. Mit "Einzug ausgesetzt" überspringt der Beitragslauf das Mitglied, bis der Einzug wieder aktiv geschaltet wird. Das ist getrennt von der Mahnsperre.',
      },
      {
        category: "improvement",
        description:
          "Ein erfasster Rückläufer setzt die Mahnstufe der Sollstellung zurück. Die Mahnung beginnt damit wieder bei der Erinnerung statt auf der vorherigen Stufe.",
      },
      {
        category: "fix",
        description:
          "Die Versionsnummer in den Versionshinweisen war im hellen Modus schlecht lesbar. Sie steht jetzt als klar abgesetzte Plakette mit ausreichendem Kontrast.",
      },
      {
        category: "improvement",
        description:
          "Irgendwo in der App versteckt sich jetzt eine Kleinigkeit für neugierige Klicks.",
      },
    ],
  },
  {
    version: "0.25.2",
    date: "2026-06-08",
    changes: [
      {
        category: "fix",
        description:
          "Die Vorschau für den Beitragslauf lädt wieder. Die Verträge im Abrechnungsjahr wurden wegen eines Datumsfehlers nicht abgefragt, die Vorschau brach mit einem Serverfehler ab.",
      },
    ],
  },
  {
    version: "0.25.1",
    date: "2026-06-08",
    changes: [
      {
        category: "internal",
        description:
          "Fehlgeschlagene Server-Anfragen schreiben jetzt den tatsächlichen Grund ins Protokoll, nicht nur die Anfrage selbst. Datenbankfehler lassen sich damit ohne Rätselraten zuordnen.",
      },
    ],
  },
  {
    version: "0.25.0",
    date: "2026-06-08",
    changes: [
      {
        category: "improvement",
        description:
          "Schreiben an Mitglieder zeigen jetzt zusätzlich die alte Mitgliedsnummer aus Linear. Mahnung, Kulanz-Brief, Serienbrief und Austrittsbestätigung führen sie als eigene Zeile, die Ehrenurkunde nennt sie klein in der Fußzeile. So finden sich Mitglieder mit ihrer gewohnten Nummer wieder, während die neue Nummer weiter oben steht.",
      },
    ],
  },
  {
    version: "0.24.1",
    date: "2026-06-08",
    changes: [
      {
        category: "fix",
        description:
          "Kulanz-Brief: Die Grußformel landet nicht mehr allein auf einer fast leeren zweiten Seite. Das Anschreiben passt jetzt zuverlässig auf eine Seite, die Kündigungsbestätigung folgt wie gehabt auf der nächsten.",
      },
    ],
  },
  {
    version: "0.24.0",
    date: "2026-06-08",
    title: "Ehrungsverwaltung, übersichtlicheres Netzwerk und sauberer Kulanz-Brief",
    changes: [
      {
        category: "feature",
        description:
          "Neue Ehrungsverwaltung: Anstehende Vereinsjubiläen lassen sich direkt als vergeben vermerken, damit niemand doppelt geehrt wird. Zu jeder Ehrung kann eine Ehrenurkunde als PDF erzeugt und gedruckt werden. Am Mitglied gibt es einen eigenen Bereich Ehrungen für Jubiläen und Sonderehrungen (zum Beispiel Ehrenmitglied oder Goldene Ehrennadel); erfasste Ehrungen erscheinen zusätzlich im Verlauf.",
      },
      {
        category: "improvement",
        description:
          "Beziehungsnetzwerk: Ein Klick auf eine Person öffnet jetzt ihre Verbindungen in einer Seitenleiste, statt sofort zur Mitgliedsseite zu springen. Von dort lässt sich zu verbundenen Personen weiterklicken, ein eigener Knopf öffnet das Mitglied. Das funktioniert auch per Fingertipp auf dem Touchscreen.",
      },
      {
        category: "fix",
        description:
          "Kulanz-Brief: Das Schreiben bricht nicht mehr ungünstig auf eine zweite Seite um, wenn die SEPA-Gebühr ausgewiesen wird. Außerdem wird das Wort Kulanz im Text nicht mehr mehrfach wiederholt.",
      },
    ],
  },
  {
    version: "0.23.0",
    date: "2026-06-08",
    title: "SEPA-Gebühr auf dem Kulanz-Brief mit sinnvollem Standard",
    changes: [
      {
        category: "improvement",
        description:
          "Die Rücklastschriftgebühr unter Vereinsdaten ist jetzt auf 3,00 Euro voreingestellt (übliches Rücklastschriftentgelt der Banken) und wird damit auf jedem Kulanz-Brief als SEPA-Gebühr ausgewiesen und zum offenen Betrag addiert. Stand der Wert bisher auf 0, wird er einmalig auf 3,00 Euro gesetzt. Du kannst ihn jederzeit unter Einstellungen, Vereinsdaten anpassen oder mit 0 wieder abschalten.",
      },
    ],
  },
  {
    version: "0.22.0",
    date: "2026-06-08",
    title: "Beziehungsnetzwerk und schärfere Datenprüfung",
    changes: [
      {
        category: "feature",
        description:
          "Neue Ansicht Netzwerk: alle Verknüpfungen zwischen Mitgliedern und Kontakten als Karte. Ziehen zum Verschieben, scrollen zum Zoomen, Suche nach Personen, Klick öffnet das Mitglied. Vertretungen sind eigens hervorgehoben.",
      },
      {
        category: "improvement",
        description:
          "Datenqualität prüft jetzt neun weitere Punkte: fehlender Name, Mitglied ohne Vertrag, unplausibles Geburtsdatum, Austritt vor Eintritt, unplausible E-Mail, mehrfach vergebene E-Mail, unplausible PLZ, nicht bestimmbares Geschlecht und gesetzte Mahnsperre. Neuer Filter nach Warnungen und Hinweisen.",
      },
      {
        category: "fix",
        description:
          "Geschlecht im Dashboard wird jetzt aus der Anrede abgeleitet, wenn kein Geschlecht hinterlegt ist. Damit zeigt die Auswertung die echte Verteilung statt überall Unbekannt.",
      },
      {
        category: "fix",
        description:
          "Diagramme schneiden die äußeren Jahreszahlen und den Wert am Rand nicht mehr ab.",
      },
    ],
  },
  {
    version: "0.21.0",
    date: "2026-06-08",
    title: "Wiedervorlagen, Verlauf und Finanz-Werkzeuge",
    changes: [
      {
        category: "fix",
        description:
          "Sicherheit: Einladungs-Links werden jetzt nur noch als Hash gespeichert, nicht mehr im Klartext. Bereits versendete, noch offene Einladungen werden dadurch ungültig und müssen einmalig neu verschickt werden.",
      },
      {
        category: "feature",
        description:
          "Wiedervorlagen: Aufgaben mit Fälligkeit pro Mitglied anlegen (etwa IBAN nachfordern), direkt am Mitglied abhaken und in einer gemeinsamen Liste über alle Mitglieder abarbeiten. Überfällige werden in der Seitenleiste rot markiert.",
      },
      {
        category: "feature",
        description:
          "Neuer Aktivitäts-Verlauf am Mitglied im Reiter Verlauf: Änderungen, Mahnungen, Kulanz-Schreiben, Rundschreiben und SEPA-Rückläufer in einer gemeinsamen Zeitleiste, neueste zuerst.",
      },
      {
        category: "improvement",
        description:
          "Schnellbearbeitung in der Mitgliederliste: Status (aktiv/passiv) direkt am Eintrag umschalten und ein Mitglied per Klick einer Abteilung zuordnen, ohne die Detailseite zu öffnen.",
      },
      {
        category: "improvement",
        description:
          "Die Schnellsuche (Strg/Cmd K) findet jetzt auch Verträge und SEPA-Mandate und springt direkt zum zugehörigen Mitglied. Außerdem lässt sich der Suchbegriff mit einem Klick im Audit-Log nachschlagen.",
      },
      {
        category: "feature",
        description:
          "Neues Export-Center unter Berichte: Mitgliederliste, Geburtstage, Ehrungen, Abteilungs-Statistik und Finanzbericht als CSV an einer Stelle, jeweils mit Jahr- und Monatsauswahl.",
      },
      {
        category: "feature",
        description:
          "SEPA-Vorabankündigung: Am abgeschlossenen Beitragslauf lässt sich jedem Zahler der bevorstehende Einzug per E-Mail ankündigen (Betrag, Fälligkeit, Mandatsreferenz, Gläubiger-ID). Der Versandzeitpunkt wird am Lauf vermerkt.",
      },
      {
        category: "feature",
        description:
          "Beitragslauf-Vorschau zeigt auf Wunsch einen Vorjahresvergleich: wer neu dazukommt, wer wegfällt und bei wem sich der Betrag ändert, mit Summen für beide Jahre. So lässt sich ein Lauf vor dem Abschluss prüfen.",
      },
      {
        category: "feature",
        description:
          "Serienbrief als PDF: Aus dem Rundschreiben lässt sich für alle Mitglieder ohne E-Mail ein fertiges PDF mit einem Brief je Empfänger im DIN-5008-Format erzeugen, mit denselben Platzhaltern wie die E-Mail. So ist jedes Mitglied digital oder per Post erreichbar.",
      },
      {
        category: "feature",
        description:
          "Zahlungsabgleich: Den CSV-Export der Bankumsätze hochladen, Gutschriften werden automatisch offenen Posten zugeordnet (über Mitgliedsnummer, Name und Betrag). Sichere Treffer sind vorausgewählt, nach Bestätigung werden die Posten als bezahlt verbucht.",
      },
    ],
  },
  {
    version: "0.20.0",
    date: "2026-06-08",
    title: "Verträge und SEPA-Mandate bearbeiten",
    changes: [
      {
        category: "feature",
        description:
          "Bestehende Verträge lassen sich jetzt direkt bearbeiten: Vertragsnummer, Betrag, Beginn, Ende und Kündigungsdaten ändern, ohne den Vertrag löschen und neu anlegen zu müssen.",
      },
      {
        category: "feature",
        description:
          "SEPA-Mandate sind bearbeitbar: Typ, Lastschriftart, Unterschriftsdatum sowie Gültig ab und Gültig bis lassen sich nachträglich anpassen.",
      },
      {
        category: "feature",
        description:
          "Der Kulanz-Brief weist jetzt auf jedem Schreiben die SEPA-Gebühr aus den Vereinsdaten als eigene Position aus und rechnet sie zum offenen Betrag hinzu. Beim Erlass aus Kulanz wird sie wieder abgezogen. Den Betrag pflegst du unter Einstellungen, Vereinsdaten.",
      },
      {
        category: "feature",
        description:
          "Neue Seite Datenqualität prüft den Bestand auf typische Lücken: Lastschrift ohne SEPA-Mandat oder IBAN, fehlende E-Mail oder Anschrift, Minderjährige ohne gesetzliche Vertretung, Verträge ohne Beitragsart, Austritte mit offenem Vertrag und mögliche Dubletten. Jeder Treffer verlinkt direkt zum Mitglied, die Anzahl offener Hinweise steht als Zähler in der Seitenleiste.",
      },
      {
        category: "feature",
        description:
          "Das Dashboard hat einen neuen Bereich Auswertungen: Mitgliederentwicklung über zehn Jahre, Ein- und Austritte pro Jahr, Beitragsvolumen mit Soll und Bezahlt, Zahlart-Verteilung und offene Posten nach Mahnstufe. Die Altersstruktur zeigt jetzt eine Pyramide nach Geschlecht.",
      },
      {
        category: "fix",
        description:
          "Das Geschlecht wird jetzt korrekt als eigenes Merkmal geführt und nicht mehr mit der Anrede verwechselt. Bei Import und Neuanlage wird es aus der Anrede abgeleitet (Herr, Frau), lässt sich aber jederzeit im Mitglied überschreiben. Für den vorhandenen Bestand einmalig den Befehl db:backfill:geschlecht ausführen, danach stimmt die Geschlechter-Auswertung im Dashboard.",
      },
      {
        category: "feature",
        description:
          "Neue Rundschreiben-Funktion: eine E-Mail an ein ganzes Segment (aktiv, passiv, einzelne Abteilung) mit Platzhaltern für Anrede, Vorname, Nachname und Mitgliedsnummer. Vorschau, Testmail an sich selbst, Versandprotokoll je Empfänger und ein Adress-Export für Mitglieder ohne E-Mail, damit auch sie per Serienbrief erreichbar bleiben.",
      },
    ],
  },
  {
    version: "0.19.0",
    date: "2026-06-08",
    title: "Eigene Mitglieds- und Kontaktnummern",
    changes: [
      {
        category: "breaking",
        description:
          "Mitglieder und Kontakte haben jetzt app-eigene Nummern im Format M-XXXXXX bzw. K-XXXXXX statt der alten Linear-Nummern. Der gesamte Bestand wurde einmalig neu nummeriert. Die alte Mitgliedsnummer bleibt erhalten und durchsuchbar, damit Verweise auf alten Mahnungen und Zahlungen weiter auffindbar sind.",
      },
      {
        category: "improvement",
        description:
          "Reine Zahler und Kontakte ohne Mitgliedschaft bekommen eine eigene Kontaktnummer (K-…). Die frühere Notlösung über die interne Adressnummer entfällt.",
      },
    ],
  },
  {
    version: "0.18.4",
    date: "2026-06-07",
    changes: [
      {
        category: "fix",
        description:
          "DSGVO-Löschung reicht jetzt vollständig durch: Neben dem Mitglied werden auch Snapshots, Mahnungen samt PDF und die personenbezogenen Felder in Beziehungen gelöscht bzw. bereinigt. Alte Personenwerte im Änderungsprotokoll werden entfernt, der Löschvorgang selbst bleibt nachvollziehbar protokolliert.",
      },
      {
        category: "fix",
        description:
          "Beitragslauf überspringt Verträge mit negativem Betrag und weist sie in der Ausschlussliste aus, statt eine ungültige Lastschrift zu erzeugen.",
      },
      {
        category: "fix",
        description:
          "Sicherheit: Das Cookie der Mitgliederportal-Sitzung nutzt jetzt SameSite=Strict. Portal-Änderungswünsche sind pro Feld in der Länge begrenzt.",
      },
    ],
  },
  {
    version: "0.18.3",
    date: "2026-06-07",
    changes: [
      {
        category: "fix",
        description:
          "SEPA-Lastschriftdatei: Namen und Verwendungszwecke mit Umlauten oder ß (z. B. „Schäfer“, „München“, „Straße“) werden jetzt in den von Banken zugelassenen Zeichensatz umgesetzt (ae, oe, ue, ss). Vorher konnte ein einziger Umlaut dazu führen, dass die Bank die komplette Datei ablehnt.",
      },
      {
        category: "fix",
        description:
          "Suche: Eingaben mit % oder _ werden jetzt wörtlich gesucht statt als Platzhalter. Eine Suche nach „50%“ liefert keine unerwarteten Treffer mehr.",
      },
      {
        category: "fix",
        description:
          "DSGVO-Löschung entfernt jetzt auch die hinterlegte gesetzliche Vertretung (Name und Anschrift), den abweichenden Kontoinhaber sowie Firma und Funktion. Veraltete Regeln für längst entfernte Felder wurden bereinigt.",
      },
    ],
  },
  {
    version: "0.18.2",
    date: "2026-06-07",
    changes: [
      {
        category: "fix",
        description:
          "Mahnlauf: Klicken zwei Personen gleichzeitig auf „Mahnlauf erstellen“, entstehen keine doppelten Mahnungen und keine doppelte Mahngebühr mehr. Der zweite Lauf erkennt die bereits gemahnten Posten und überspringt sie.",
      },
      {
        category: "fix",
        description:
          "Bearbeiten zwei Personen dasselbe Mitglied gleichzeitig, wird die zweite Speicherung mit einem Hinweis abgelehnt, statt die erste Änderung unbemerkt zu überschreiben. Vor dem erneuten Speichern die Seite neu laden.",
      },
    ],
  },
  {
    version: "0.18.1",
    date: "2026-06-07",
    changes: [
      {
        category: "fix",
        description:
          "Blättern in langen Listen: Die Schaltfläche „Weiter“ ist jetzt auf der letzten Seite korrekt deaktiviert. Vorher konnte man auf eine leere Seite klicken, wenn die Anzahl genau aufging.",
      },
      {
        category: "fix",
        description:
          "Unmögliche Datumsangaben wie der 30.02. werden beim Speichern abgewiesen, statt still auf den 02.03. zu rutschen.",
      },
      {
        category: "fix",
        description:
          "Namen und andere Textfelder werden beim Speichern von führenden und folgenden Leerzeichen befreit. Ein Name aus reinen Leerzeichen wird nicht mehr akzeptiert, und die Suche findet betroffene Einträge wieder.",
      },
      {
        category: "fix",
        description:
          "CSV-Export: Felder, die mit = + - oder @ beginnen, werden so geschrieben, dass Excel oder LibreOffice sie nicht als Formel ausführen.",
      },
      {
        category: "fix",
        description:
          "Nach dem endgültigen Löschen oder Aufräumen im Adminbereich werden Listen, Dashboard und Abteilungszahlen sofort aktualisiert, statt bis zu fünf Minuten veraltet zu bleiben.",
      },
    ],
  },
  {
    version: "0.18.0",
    date: "2026-06-07",
    changes: [
      {
        category: "feature",
        description:
          "Papierkorb in der Mitgliederliste. Über den Filter „Papierkorb“ lassen sich gelöschte Mitglieder finden und mit „Wiederherstellen“ zurückholen. Auch auf der Profilseite eines gelöschten Mitglieds gibt es jetzt einen Hinweis und einen Wiederherstellen-Knopf. Bisher ließ sich eine versehentliche Löschung im Programm nicht rückgängig machen.",
      },
      {
        category: "fix",
        description:
          "Die Mitgliedsnummer eines gelöschten Mitglieds ist wieder frei und kann erneut vergeben werden. Vorher blieb sie dauerhaft belegt.",
      },
      {
        category: "fix",
        description:
          "Ein gelöschtes Mitglied verliert sofort den Zugang zum Mitgliederportal, auch wenn die Anmeldung im Browser noch gespeichert war.",
      },
      {
        category: "fix",
        description:
          "Lässt sich ein verschlüsseltes Feld (z. B. eine IBAN) nicht entschlüsseln, bleibt nur dieses Feld leer. Listen, Einstellungen und Berichte funktionieren weiter, statt komplett zu blockieren.",
      },
    ],
  },
  {
    version: "0.17.1",
    date: "2026-06-07",
    changes: [
      {
        category: "fix",
        description:
          "Kulanzbrief: Die erlassene SEPA-Rücklastgebühr steht jetzt nachvollziehbar in der Betragsübersicht. Sie wird als Position aufgeführt und direkt darunter als Erlass wieder abgezogen, sodass sich der offene Beitrag als Summe ergibt. Hinweis: Eine Gebühr gibt es nur bei einer erfassten Rücklastschrift; ohne eine solche bleibt der Schalter ohne Wirkung.",
      },
    ],
  },
  {
    version: "0.17.0",
    date: "2026-06-07",
    changes: [
      {
        category: "feature",
        description:
          "Kulanzbrief: Die SEPA-Rücklastgebühr kann pro Lauf aus Kulanz erlassen werden. Dann fordert das Schreiben nur den offenen Beitrag und weist die erlassene Gebühr aus.",
      },
      {
        category: "improvement",
        description:
          "Kulanzbrief: Kontakte ohne Mitgliedsnummer bekommen statt einer erfundenen Nummer eine klare Referenz (z. B. A123), die im Schreiben, im Verwendungszweck und auf der Kündigungsbestätigung als Referenz statt als Mitgliedsnummer steht.",
      },
    ],
  },
  {
    version: "0.16.4",
    date: "2026-06-05",
    changes: [
      {
        category: "improvement",
        description:
          "Mitglieder, die in der Altsoftware gelöscht waren, werden jetzt überall einheitlich wie im Programm gelöschte Mitglieder behandelt und damit konsistent ausgeblendet (Listen, Berichte, Mahnwesen, Lastschrift, Snapshots).",
      },
      {
        category: "internal",
        description:
          "DSGVO-Löschung entfernt jetzt auch die unveränderten Originaldaten aus dem Import-Beleg, damit bei einer Anonymisierung keine Kopie der personenbezogenen Daten zurückbleibt.",
      },
      {
        category: "internal",
        description:
          "Datenmodell vollständig aufgeräumt: alle ungenutzten Linear-Altspalten aus der Mitgliedertabelle entfernt (von 265 auf 46 klar benannte Felder). Bearbeitungsmaske, Portal und Anzeige nutzen durchgehend die aufgeräumten Felder. Keine sichtbare Änderung.",
      },
    ],
  },
  {
    version: "0.16.3",
    date: "2026-06-05",
    changes: [
      {
        category: "internal",
        description:
          "Der Import befüllt die aufgeräumten Mitgliederfelder jetzt automatisch mit und legt zu jedem Mitglied die unveränderten Originaldaten aus der Altsoftware als Beleg ab. Die bisherigen Felder bleiben unverändert, es ändert sich nichts an der Anzeige.",
      },
    ],
  },
  {
    version: "0.16.2",
    date: "2026-06-05",
    changes: [
      {
        category: "internal",
        description:
          "Aufgeräumte Mitgliederfelder vorbereitet: Mitgliedsnummer, E-Mail, Status (aktiv, passiv, ausgetreten, verstorben) und Mahnsperre stehen jetzt zusätzlich in klar benannten Feldern, automatisch aus den Altdaten befüllt. Noch keine sichtbare Änderung, die alten Felder bleiben unverändert erhalten.",
      },
    ],
  },
  {
    version: "0.16.1",
    date: "2026-06-05",
    changes: [
      {
        category: "internal",
        description:
          "Grundlage für eine aufgeräumte Mitglieder-Datenbasis: Der Import behält ab sofort die Original-Daten aus der Altsoftware unverändert als Beleg, damit künftig nur noch die tatsächlich genutzten Felder im Hauptdatensatz stehen. Keine sichtbare Änderung, die Daten bleiben vollständig erhalten.",
      },
    ],
  },
  {
    version: "0.16.0",
    date: "2026-06-04",
    title: "Mitglied austreten und Eintritt mit Assistent",
    changes: [
      {
        category: "feature",
        description:
          "Neuer Austritt in einem Schritt: Über die Schaltfläche Austritt auf der Mitgliedsseite wird das Austrittsdatum auf das Mitglied und zugleich auf alle offenen Abteilungs-Mitgliedschaften, laufenden Verträge und aktiven SEPA-Mandate übertragen. Auf Wunsch wird das Mitglied auf passiv gesetzt und die Mandate werden widerrufen. Offene Forderungen werden im Dialog angezeigt, aber nicht storniert. Danach kann direkt die Austrittsbestätigung erstellt werden.",
      },
      {
        category: "feature",
        description:
          "Austritt rückgängig: Ein versehentlicher oder rückgängig zu machender Austritt lässt sich mit einem Klick zurücknehmen. Es werden genau die Datensätze wieder geöffnet, die der Austritt zum selben Datum geschlossen hat.",
      },
      {
        category: "feature",
        description:
          "Geführte Neuanlage: Ein neues Mitglied wird jetzt in zwei Schritten angelegt. Zuerst die Stammdaten, dann Abteilungen, optional ein Beitrag und ein SEPA-Mandat. Alles wird gemeinsam gespeichert.",
      },
    ],
  },
  {
    version: "0.15.2",
    date: "2026-06-04",
    changes: [
      {
        category: "internal",
        description:
          "Der Docker-Build auf Railway lief wegen eines fehlerhaften Cache-Eintrags nicht durch. Der Paket-Cache hat jetzt eine feste Kennung, sodass Deployments wieder bauen.",
      },
    ],
  },
  {
    version: "0.15.1",
    date: "2026-06-04",
    changes: [
      {
        category: "internal",
        description:
          "Schnellere und zuverlässigere Deployments: Der Docker-Build nutzt jetzt einen Paket-Cache, baut auf einer fest gepinnten Bun-Version und die Datenbank-Migration beim Deploy läuft unter Bun statt Node.",
      },
    ],
  },
  {
    version: "0.15.0",
    date: "2026-06-04",
    title: "Briefe im DIN-5008-Format",
    changes: [
      {
        category: "improvement",
        description:
          "Mahnung, Austrittsbestätigung und Kulanz-Brief folgen jetzt dem Geschäftsbrief-Standard DIN 5008. Das Anschriftfeld sitzt an der richtigen Stelle für Fensterumschläge, darüber steht die Rücksendeangabe, rechts ein Informationsblock mit Datum, Dokumentnummer und Mitgliedsnummer. Dazu kommen eine fette Betreffzeile, feste Ränder sowie Falz- und Lochmarken am linken Rand.",
      },
    ],
  },
  {
    version: "0.14.0",
    date: "2026-06-04",
    title: "Eigene E-Mail für Mitgliedschaftsangelegenheiten",
    changes: [
      {
        category: "feature",
        description:
          "Unter Vereinsdaten lässt sich jetzt zusätzlich zur allgemeinen Kontakt E-Mail eine eigene Mitgliedschaft E-Mail hinterlegen (zum Beispiel mitgliedschaft@verein.de). Kündigungen aus dem Kulanz-Brief und der Kontakt auf der Austrittsbestätigung gehen an diese Adresse. Ist sie leer, wird wie bisher die allgemeine Kontakt E-Mail verwendet.",
      },
      {
        category: "improvement",
        description:
          "Auf der Kündigungsbestätigung im Kulanz-Brief steht jetzt deutlich, dass eine formlose E-Mail mit Name und Mitgliedsnummer ebenso als Kündigung gilt. Das Formular muss nicht zwingend zurückgeschickt werden.",
      },
    ],
  },
  {
    version: "0.13.0",
    date: "2026-06-04",
    title: "Dokumentnummern auf allen erzeugten Schreiben",
    changes: [
      {
        category: "feature",
        description:
          "Mahnung, Austrittsbestätigung, DSGVO-Auskunft und Bestandserhebung tragen jetzt wie der Kulanz-Brief eine eindeutige Dokumentnummer. Sie ist auf dem Dokument aufgedruckt und steht im Dateinamen beim Download. Bei der Mitgliederliste und der DSGVO-Anfrage wird sie zusätzlich angezeigt.",
      },
      {
        category: "improvement",
        description:
          "Die Nummern werden zentral vergeben (Format zum Beispiel MA-2026-0042 oder AU-2026-0042), je Dokumentart und Jahr fortlaufend. Die Bestandserhebung wird über ihren Stichtag eindeutig benannt (BE-2026-12-31).",
      },
    ],
  },
  {
    version: "0.12.0",
    date: "2026-06-04",
    title: "Kündigung per E-Mail und eindeutige Dokumentnummern",
    changes: [
      {
        category: "feature",
        description:
          "Der Kulanz-Brief bietet jetzt zusätzlich an, die Kündigung formlos per E-Mail an die hinterlegte Kontaktadresse zu schicken, statt die unterschriebene Kündigungsbestätigung zurückzusenden. Die Adresse wird aus den Vereinsdaten übernommen.",
      },
      {
        category: "improvement",
        description:
          "Jeder erzeugte Sammelbrief bekommt eine eindeutige Dokumentnummer (zum Beispiel KS-2026-0001). Sie ist auf jeder Seite des Briefs aufgedruckt und steht zusätzlich in der Liste der früheren Schreiben und im Dateinamen beim Download, damit sich zwei Briefe vom selben Tag nicht mehr verwechseln lassen.",
      },
    ],
  },
  {
    version: "0.11.0",
    date: "2026-06-04",
    title: "Antwortmöglichkeiten im Kulanz-Brief und sauberere Lastschrift-Erkennung",
    changes: [
      {
        category: "improvement",
        description:
          "Der Kulanz-Brief enthält die Kündigungsbestätigung jetzt als eigene zweite Seite mit Rücksendeadresse, Unterschriftsfeld und Datum, damit sie direkt zurückgeschickt werden kann. Ist unter Vereinsdaten eine Kontakt-E-Mail hinterlegt, wird zusätzlich die Rücksendung per E-Mail angeboten.",
      },
      {
        category: "internal",
        description:
          "Ob ein Vertrag per Lastschrift zahlt, wird jetzt einmalig beim Import als Feld gespeichert statt bei jeder Abfrage neu aus den Altsystem-Spalten abgeleitet. Die mitgelieferte Migration füllt bestehende Verträge automatisch.",
      },
    ],
  },
  {
    version: "0.10.2",
    date: "2026-06-04",
    title: "Korrekturen an Berichten, Forderungen und Verlinkungen",
    changes: [
      {
        category: "fix",
        description:
          "Der Finanzbericht zählt keine Sollstellungen gelöschter Mitglieder mehr mit. Summen und Anzahlen stimmen jetzt mit den übrigen Berichten überein.",
      },
      {
        category: "fix",
        description:
          "Wird ein Beitragslauf storniert, werden zwischenzeitlich zurückgebuchte Sollstellungen nicht mehr überschrieben. Ein SEPA-Rückläufer bleibt als offene Forderung im Mahnwesen.",
      },
      {
        category: "fix",
        description:
          "Der CSV-Export mit Status aktiv oder passiv enthält keine ausgetretenen Mitglieder mehr und stimmt mit der Mitgliederliste überein.",
      },
      {
        category: "fix",
        description:
          "DSGVO-Anfragen von Kontakten ohne Mitgliedsnummer verlinken jetzt korrekt auf das Mitglied statt auf eine Fehlerseite.",
      },
      {
        category: "fix",
        description:
          "Der erweiterte Admin-Bereich schickt angemeldete Nutzer ohne Adminrecht zurück in die App statt auf die Anmeldeseite.",
      },
      {
        category: "fix",
        description:
          "Beim Wechsel der Mahnstufe in den Forderungen wird die Auswahl zurückgesetzt, damit nicht versehentlich ausgeblendete Posten als bezahlt markiert werden.",
      },
      {
        category: "improvement",
        description:
          "Die DSGVO-Liste zeigt beim Laden einen Hinweis statt kurz fälschlich keine Anfragen.",
      },
      {
        category: "improvement",
        description:
          "Bisherige Austrittsbestätigungen zeigen das Austrittsdatum jetzt im deutschen Format.",
      },
    ],
  },
  {
    version: "0.10.1",
    date: "2026-06-04",
    title: "Korrekturen an Listen, Sichtbarkeit und Dialogen",
    changes: [
      {
        category: "fix",
        description:
          "Im Altsystem gelöschte Mitglieder tauchen nicht mehr in der Mitgliederliste, den Zählern, den Geburtstags- und Ehrungslisten oder den CSV-Exporten auf.",
      },
      {
        category: "fix",
        description:
          "Konten mit Nur-Lese-Recht sehen die vollständige IBAN eines Mitglieds nicht mehr. Die maskierte Anzeige der letzten vier Stellen bleibt.",
      },
      {
        category: "fix",
        description:
          "Wird ein SEPA-Rückläufer rückgängig gemacht, wird die Sollstellung wieder auf eingezogen gesetzt und verschwindet aus dem Mahnlauf.",
      },
      {
        category: "fix",
        description:
          "Dokumente gelöschter Mitglieder lassen sich nicht mehr über einen direkten Link herunterladen.",
      },
      {
        category: "improvement",
        description:
          "Schlägt das Laden einer Seite fehl, erscheint jetzt ein Hinweis mit Schaltfläche zum erneuten Versuchen statt einer leeren Liste.",
      },
      {
        category: "improvement",
        description:
          "Löschen und andere endgültige Aktionen fragen über einen einheitlichen Dialog nach, nicht mehr über ein Browser-Fenster.",
      },
    ],
  },
  {
    version: "0.10.0",
    date: "2026-06-04",
    title: "Zahlungserinnerung mit Sonderkündigung aus Kulanz",
    changes: [
      {
        category: "feature",
        description:
          "Neuer Sammelbrief unter Forderungen: eine Zahlungserinnerung, die zugleich aus Kulanz eine Sonderkündigung anbietet. Das Mitglied kann zahlen oder die beigelegte Kündigungsbestätigung unterschrieben zurücksenden, dann wird auf die offene Forderung verzichtet.",
      },
      {
        category: "feature",
        description:
          "Jedes Schreiben enthält unten eine abtrennbare Kündigungsbestätigung mit Name, Mitgliedsnummer und Unterschriftsfeld. Alle Briefe eines Laufs liegen in einem gemeinsamen PDF zum Ausdrucken.",
      },
      {
        category: "feature",
        description:
          "Die Empfängerliste zeigt standardmäßig nur Mitglieder ohne E-Mail-Adresse, da der Brief für den Postweg gedacht ist. Frühere Sammelbriefe lassen sich erneut herunterladen.",
      },
    ],
  },
  {
    version: "0.9.0",
    date: "2026-06-03",
    title: "Austrittsbestätigung denkt mit, Mitgliederseiten aufgeräumt",
    changes: [
      {
        category: "improvement",
        description:
          "Die Austrittsbestätigung übernimmt jetzt mehr aus dem Mitglied selbst. Abteilungen werden als Auswahl aus den tatsächlichen Mitgliedschaften angeboten, ein Freitext bleibt möglich.",
      },
      {
        category: "improvement",
        description:
          "Der abweichende Empfänger lässt sich direkt aus den Beziehungen übernehmen. Zahler und gesetzliche Vertretung stehen mit Adresse zur Auswahl, statt sie erneut zu tippen.",
      },
      {
        category: "improvement",
        description:
          "Familienmitglieder für ein gemeinsames Schreiben werden aus den Beziehungen vorgeschlagen und mit Geburtsdatum und Mitgliedsnummer vorausgefüllt.",
      },
      {
        category: "improvement",
        description:
          "Die Mitglied-Seite ist in Reiter gegliedert: Übersicht, Beiträge & SEPA, Dokumente und Verlauf. Der Status des Mitglieds steht jetzt direkt neben dem Namen.",
      },
      {
        category: "improvement",
        description:
          "Über der Mitgliederliste zeigt eine Übersicht die Anzahl nach Status. Ein Klick darauf setzt den passenden Filter.",
      },
    ],
  },
  {
    version: "0.8.1",
    date: "2026-06-03",
    title: "Auslieferung der Austrittsbestätigungen repariert",
    changes: [
      {
        category: "fix",
        description:
          "Die vorherige Version ließ sich nicht ausliefern, weil eine Datenbankänderung für Austrittsbestätigungen nicht zum Datentyp der Mitglieder-ID passte. Das ist korrigiert, das Speichern erstellter Schreiben funktioniert jetzt.",
      },
    ],
  },
  {
    version: "0.8.0",
    date: "2026-06-02",
    title: "Anmeldung bleibt nach Schließen des Browsers bestehen",
    changes: [
      {
        category: "fix",
        description:
          "Nach dem Schließen und erneuten Öffnen der Seite wurde man bisher abgemeldet. Die Sitzung bleibt jetzt bestehen, weil das Anmelde-Cookie beim ersten Laden der Seite serverseitig korrekt mitgelesen wird.",
      },
      {
        category: "feature",
        description:
          "Admins können die Sitzungsdauer und das Verlängerungsintervall unter Benutzer einstellen. Die Änderung gilt sofort für neue Anmeldungen, ohne neuen Deploy.",
      },
      {
        category: "feature",
        description:
          "Auf der Mitgliederseite lässt sich eine Austrittsbestätigung als PDF erstellen. Das Mitglied wird vorausgefüllt, ein abweichender Empfänger und eine Familienmitgliedschaft sind möglich. Erstellte Schreiben werden archiviert und können erneut geöffnet werden.",
      },
      {
        category: "feature",
        description:
          "Unter Vereinsdaten lassen sich Kontakt-E-Mail, Telefon und die Links zu Datenschutzerklärung und Satzung hinterlegen. Sie erscheinen im Datenschutzhinweis der Briefe.",
      },
    ],
  },
  {
    version: "0.7.0",
    date: "2026-06-01",
    title: "Mahnungen per E-Mail senden, mit Vorschau",
    changes: [
      {
        category: "feature",
        description:
          "Mahnungen lassen sich jetzt direkt per E-Mail mit angehängtem PDF versenden. Vor dem Versand zeigt eine Vorschau Empfänger, Betreff und Text. Bei minderjährigen Mitgliedern geht die E-Mail an die gesetzliche Vertretung, sofern dort eine Adresse hinterlegt ist.",
      },
      {
        category: "improvement",
        description:
          "Die Vereinsanschrift steht auf dem Mahnschreiben nur noch einmal, in der Absenderzeile über der Empfängeradresse. Der doppelte Briefkopf entfällt.",
      },
      {
        category: "improvement",
        description:
          "Das Erstellen und Stornieren eines Mahnlaufs nutzt jetzt den regulären Bestätigungsdialog statt der alten Browser-Abfrage.",
      },
      {
        category: "improvement",
        description:
          "Die Anmeldung bleibt länger bestehen (90 Tage bei Nutzung). Läuft die Sitzung doch ab, führt ein Hinweis zurück zur Anmeldung statt einer Fehlermeldung.",
      },
    ],
  },
  {
    version: "0.6.0",
    date: "2026-06-01",
    title: "Mahnungen mit Logo, voller IBAN und Vertretung für Minderjährige",
    changes: [
      {
        category: "improvement",
        description:
          "Mahnungen tragen jetzt das Vereinslogo und zeigen die vollständige IBAN statt der abgekürzten. Damit ist die Überweisung direkt vom Schreiben möglich.",
      },
      {
        category: "feature",
        description:
          "Bei minderjährigen Mitgliedern wird die Mahnung an die gesetzliche Vertretung adressiert: entweder an eine als Vertretung markierte Beziehung oder an die neuen Vertretungs-Felder in den Stammdaten. Die Beziehung hat Vorrang.",
      },
      {
        category: "improvement",
        description:
          "Der Mahnlauf warnt jetzt, wenn ein minderjähriges Mitglied keine hinterlegte Vertretung hat, bevor das Schreiben direkt an das Mitglied geht.",
      },
    ],
  },
  {
    version: "0.5.0",
    date: "2026-06-01",
    title: "Mitgliederliste, Beitragsläufe und viele Korrekturen",
    changes: [
      {
        category: "feature",
        description:
          "Mitgliederliste: Navigation per Tastatur, gespeicherte Ansichten und Mehrfachauswahl mit Massenaktionen.",
      },
      {
        category: "feature",
        description:
          "Beitragsläufe: anteilige Berechnung (Proration) und Kündigungsfrist sind jetzt konfigurierbar.",
      },
      {
        category: "feature",
        description:
          "Linear-Import schreibt in Stapeln und zeigt den Fortschritt live an, auch bei großen Dumps.",
      },
      {
        category: "improvement",
        description:
          "Dashboard, Abteilungen und Beitragsarten werden zwischengespeichert und laden spürbar schneller.",
      },
      {
        category: "improvement",
        description:
          "Löschen von Verträgen und Beziehungen läuft über einen In-App-Bestätigungsdialog statt eines Browser-Popups.",
      },
      {
        category: "improvement",
        description:
          "Strukturiertes Logging und zusätzliche Sicherheits-Header im gesamten Backend.",
      },
      {
        category: "fix",
        description:
          "iOS: Die Oberfläche ist nach der ersten Anmeldung nicht mehr leicht hineingezoomt.",
      },
      {
        category: "fix",
        description:
          "Lastschrift-Fälle werden korrekt eingezogen statt angemahnt, Verträge ohne Lastschrift-Kennung zählen als Lastschrift, und bereits eingezogene Sollstellungen lassen sich zurücksetzen.",
      },
      {
        category: "fix",
        description:
          "SEPA und Beitragsarten: korrekte Cent-Beträge, deutsche Zahlenformate und stabile Belegnummern auch bei gleichzeitigen Zugriffen.",
      },
      {
        category: "fix",
        description:
          "Magic-Link-Anmeldung im Mitgliederportal ist jetzt wirklich nur einmal verwendbar.",
      },
      {
        category: "fix",
        description:
          "Dashboard und Verbandsmeldung: gelöschte Altdatensätze und Doppelzählungen bei der Bestandserhebung werden ausgeschlossen.",
      },
      {
        category: "fix",
        description:
          "Weitere Korrektheits- und Stabilitätsfehler in Finanzbuchung, DSGVO-Auskunft, Snapshots, Anhängen und Formularen behoben.",
      },
    ],
  },
  {
    version: "0.4.0",
    date: "2026-05-25",
    title: "Versionshinweise in der App",
    changes: [
      {
        category: "feature",
        description:
          "Aktuelle Version und Änderungen sind jetzt in der App sichtbar: kleines Versions-Chip unten in der Seitenleiste sowie auf Login- und Setup-Seite. Anklicken öffnet die vollständigen Hinweise.",
      },
      {
        category: "feature",
        description:
          "Ungelesene Hinweise werden mit einem kleinen roten Punkt markiert, bis der Dialog einmal geöffnet wurde.",
      },
    ],
  },
  {
    version: "0.3.0",
    date: "2026-05-25",
    title: "Linear-Historie wird beim Import übernommen",
    changes: [
      {
        category: "feature",
        description:
          "Historische Sollstellungen aus Linear (mgsolln) werden beim SQL-Import in die Forderungen übernommen. Mehrere Zeiträume pro Vertrag und Jahr werden zusammengefasst.",
      },
      {
        category: "feature",
        description:
          "SEPA-Läufe aus Linear (lastprot inkl. pain.008-XML) werden als Archiv übernommen. Sichtbar über DB-Abfragen, UI-Anzeige folgt.",
      },
      {
        category: "feature",
        description:
          "BLSV-Sportarten- und Fachverbände-Kataloge werden beim Import als Nachschlage-Tabellen geladen. Vorbereitung für Picklists in der Abteilungs-Verwaltung.",
      },
      {
        category: "feature",
        description:
          "Beitragsart-Preishistorie (mgartdat) wird übernommen. Reports können künftig den effektiven Preis je Monat auflösen.",
      },
    ],
  },
  {
    version: "0.2.0",
    date: "2026-05-25",
    title: "Sechs Catch-22-Situationen behoben",
    changes: [
      {
        category: "feature",
        description:
          "Setup-Seite (/setup) für das erste Admin-Konto, falls SVUWV_BOOTSTRAP_ADMIN_* nicht gesetzt sind.",
      },
      {
        category: "improvement",
        description:
          "SMTP-Konfiguration kann jetzt direkt aus dem Formular getestet werden, ohne sie vorher zu speichern.",
      },
      {
        category: "improvement",
        description:
          "APP_SECRET kann ohne Datenverlust rotiert werden. Neuer Keyring (APP_SECRET_PREV) plus 'Daten neu verschlüsseln'-Aktion in den Einstellungen.",
      },
      {
        category: "fix",
        description:
          "Letzter Admin kann sich nicht mehr selbst sperren oder entfernen. Vorher konnte die Instanz dauerhaft ausgesperrt werden.",
      },
      {
        category: "fix",
        description:
          "Eine fehlgeschlagene Einladungs-Annahme kann erneut versucht werden. Vorher blieb die E-Mail nach einem teilweisen Fehler dauerhaft blockiert.",
      },
      {
        category: "internal",
        description:
          "Nightly-Snapshot-Scheduler startet zuverlässig nach jedem Deploy, auch wenn vor 02:30 kein Traffic anliegt.",
      },
    ],
  },
  {
    version: "0.1.0",
    date: "2026-05-24",
    title: "Erstausgabe",
    changes: [
      {
        category: "feature",
        description:
          "Mitgliederverwaltung mit verlustfreiem Spiegel der Linear-adresse-Tabelle (247 Spalten), AES-256-GCM-verschlüsselte IBANs, Per-Mitglieds-Anhänge via S3.",
      },
      {
        category: "feature",
        description:
          "Beitragsläufe mit pain.008.001.02-XML-Erzeugung, Stornierung, SEPA-Rückläufer-Erfassung, Mahnwesen in drei Eskalationsstufen.",
      },
      {
        category: "feature",
        description:
          "Mitgliederportal mit Magic-Link-Login und Änderungsanträgen, die der Vorstand prüft.",
      },
      {
        category: "feature",
        description:
          "DSGVO: Auskunft als PDF + JSON, Anonymisierung mit Aufbewahrungsfristen, Einwilligungs-Log.",
      },
      {
        category: "feature",
        description:
          "Berichte (Geburtstage, Ehrungen, Abteilungs-Statistik, Finanzbericht), Snapshots mit feld-genauer Wiederherstellung, vollständiges Audit-Log.",
      },
      {
        category: "feature",
        description:
          "Linear-Import (SQL-Dump bis 50 MB) und SVUMS-Push (HMAC-signiert) verwenden denselben Ingest-Pfad.",
      },
    ],
  },
];

export const CURRENT_VERSION: string = RELEASES[0]?.version ?? "0.0.0";

/**
 * Copyright-Hinweis, einheitlich für Login, Setup und Versionshinweise.
 * Muss zur LICENSE-Datei im Repo passen (proprietär, alle Rechte vorbehalten).
 */
export const COPYRIGHT = "© 2026 Paul Dresch. Alle Rechte vorbehalten.";

export const CATEGORY_LABELS: Record<ReleaseCategory, string> = {
  feature: "Neu",
  fix: "Behoben",
  improvement: "Verbessert",
  breaking: "Breaking",
  internal: "Intern",
};

/**
 * Sort order for rendering category groups within a release. Breaking
 * changes first (because they need operator attention), internals last
 * (because they're noise for most readers).
 */
export const CATEGORY_ORDER: ReleaseCategory[] = [
  "breaking",
  "feature",
  "improvement",
  "fix",
  "internal",
];

const LAST_SEEN_KEY = "kontor2:release-notes:last-seen-version";
// Vorgaenger-Key: mitlesen, damit nach der Umbenennung nicht bei allen
// faelschlich der "Was ist neu"-Hinweis aufpoppt.
const LEGACY_LAST_SEEN_KEY = "svuwv:release-notes:last-seen-version";

/**
 * Persists the version the user has acknowledged. Used by the sidebar
 * chip to hide the "new" dot until the next release. Falls back to a
 * no-op on the server (no `window`).
 */
export function readLastSeenVersion(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return (
      window.localStorage.getItem(LAST_SEEN_KEY) ??
      window.localStorage.getItem(LEGACY_LAST_SEEN_KEY)
    );
  } catch {
    return null;
  }
}

export function writeLastSeenVersion(version: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LAST_SEEN_KEY, version);
  } catch {
    // localStorage may be disabled (private mode, quota); the chip will
    // just show "new" on every visit. Acceptable trade-off.
  }
}

/**
 * `true` when CURRENT_VERSION hasn't been acknowledged by this browser
 * yet. Returning `false` on the server keeps SSR output stable so the
 * initial render matches the client hydration.
 */
export function hasUnseenRelease(): boolean {
  if (typeof window === "undefined") return false;
  const seen = readLastSeenVersion();
  return seen !== CURRENT_VERSION;
}
