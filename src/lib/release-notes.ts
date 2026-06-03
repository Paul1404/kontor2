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

const LAST_SEEN_KEY = "svuwv:release-notes:last-seen-version";

/**
 * Persists the version the user has acknowledged. Used by the sidebar
 * chip to hide the "new" dot until the next release. Falls back to a
 * no-op on the server (no `window`).
 */
export function readLastSeenVersion(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(LAST_SEEN_KEY);
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
