# Kontor2 features

### Members and contacts

- Lossless mirror of the Linear `adresse` schema (247 columns). IBANs are
  AES-256-GCM encrypted at rest, and clients only ever see the last four digits.
- Full CRUD with edit, create, soft-delete and undelete.
- Many-to-many Abteilungen with per-Abteilung Eintritts- und Austrittsdaten.
- Verknüpfungen (Familienbeziehungen) imported from Linear and editable.
- Kontakt entries (Zahlende ohne eigene Mitgliedschaft) are first-class. They
  carry their own `K-` Kontaktnummer, fall back to `AdrNr` only for legacy rows,
  and get a "Kontakt" badge. An admin-only filter surfaces orphan Kontakte.
- A merged, chronological member timeline: audit changes, Mahnungen,
  Kulanz-Schreiben, Rundschreiben and SEPA-Rückläufer in one feed, with no extra
  storage.
- Per-member file attachments via S3. Signed URLs, PDF/PNG/JPEG only, 10 MB cap.
- vCard 3.0 export per member. Works with iOS and macOS Contacts.
- Clickable phone, email and address (`tel:`, `mailto:`, maps link).
- DSGVO panel on the member detail page links straight to Auskunft, Löschung
  und Einwilligungs-Log for that person.

### Families

- Familien group a Zahler with the members they pay for, with each membership's
  begin and (optional) end recorded.
- Add or end a member in a family, propose likely groupings from existing
  Verknüpfungen, and bill the family as one fee where that is how the club runs.

### Beitragsläufe und Beiträge

- Wizard that selects active mandates for a billing year, picks the right
  Beitragsart per member and assembles a draft run, with a simulate step that
  diffs against the previous year (direct-debit and invoice payers alike).
- Generates valid pain.008.001.02 XML, FRST and RCUR in separate `<PmtInf>`
  blocks per Bundesbank rules, with an honest Vorabankündigung. Generated
  direct debits stay pending until an administrator explicitly confirms the
  successful bank upload.
- Stornieren is supported and rolls back the invoice Sollstellungen it created.
- Beitragsarten are managed in the admin with amount, Sollstellungsregel,
  Verwendungszweck and an optional age range. Each can be tagged with an
  online-application role so the public form quotes that Beitragsart's price and
  approval pre-selects it. Proration and Kündigungsfrist are configurable.

### Online-Aufnahmeantrag

- Public multi-step Beitritts-Antrag with live address autocomplete from the
  OpenPLZ German directory, an age-based fee quote, Abteilungs-Auswahl, a drawn
  signature and a celebratory success screen.
- Age categories and their amounts are per-tenant; the quote can come straight
  from a role-tagged Beitragsart so there is one source for the price.
- Approval creates the member (and, for a family, partner and children),
  contract, SEPA mandate and the official Beitrittserklärung PDF, then mails it.

### Forderungen, Mahnwesen, SEPA-Rückläufer

- Forderungen-Dashboard. Open Sollstellungen grouped per member, filterable by
  Mahnstufe, batch "mark as paid" for cash and Überweisung.
- SEPA-Rückläufer erfassen. Pick a submitted `fee_run_item`, attach an
  R-Transaction reason code (AC04, AM04, MS03 and more) and optional
  Rücklastschriftgebühr. Reopens the matching Sollstellung as `returned`.
- Mahnläufe in up to three escalation levels (Erinnerung, 1. Mahnung, 2.
  Mahnung); a club can shorten the process to one or two stages. Configurable
  Mahngebühren per Stufe, one PDF per member, `mahnstufe` bumped on the touched
  Sollstellungen. Minors are addressed to their legal representative; the run
  warns when none is on file. Mahnungen can also be sent by email with a preview,
  and a re-send is blocked once an item is sent.
- Mahnsperre auf Mitgliedsebene wird respektiert. Stornieren eines Mahnlaufs
  rollt die Mahnstufe zurück.
- Kulanz-Brief. A payment reminder that also offers a goodwill Sonderkündigung:
  pay, or return the attached signed Kündigungsbestätigung and the open claim is
  waived.

### Rechnungen und Austritt

- Rechnungszahler (only `aufRechnung = 'J'`) get a proper Rechnung PDF with a
  sequential Rechnungsnummer instead of a SEPA debit.
- Austrittsbestätigung generation, for a single member or a whole family, with a
  configurable Kündigungsfrist and an optional alternate recipient.

### Mitgliederportal (Self-Service)

- Magic-link login per member. Admin issues a single-use token from the member
  detail page; the link is mailed via the existing SMTP config and spawns a
  30-day cookie session on first use.
- Members see their Stammdaten read-only and can propose changes to Anrede,
  Name, Anschrift, Telefon, E-Mail.
- Changes land as `portal_change_requests` (pending). Vorstand reviews them
  under "Portal-Anfragen" and applies the whole set, picks individual fields, or
  rejects with notes. Applied changes write through to `members` with an audit
  entry, and never overwrite a value that changed in the meantime.

### Ehrungen

- Record an honour per member, either a Vereinsjubiläum (10/25/40/50/60/70
  Jahre) or a Sonderehrung, with a per-year status view of who is due.
- Generate a printable Ehrenurkunde PDF in the club's configured brand colour,
  stored and re-downloadable.

### Rundschreiben (Serienbriefe)

- Compose a Serienbrief and target recipients by status and Abteilung, with a
  live preview and a separate postal list for members without email.
- Send a test mail, then send: each recipient gets a personalised email, and a
  combined postal PDF batch is produced for the rest. Every document carries its
  own reference number, and the send is recorded on each member's timeline.

### Aufgaben (Wiedervorlagen)

- A to-do list scoped to a member or seen globally, with open/done status,
  bulk complete, reopen and delete, and counts surfaced on the dashboard.

### DSGVO

- Auskunft nach Art. 15. Per-member dossier as JSON and PDF with masked IBANs
  and 24-hour-signed S3 download links. A deterministic SHA-256 over the
  canonical serialization is recorded in `dsgvo_requests` so an export can be
  reproduced and verified later.
- Löschung nach Art. 17 with an explicit pseudonymisation policy per column.
  Financial and SEPA-mandate fields are preserved per §147 AO (10 Jahre) and
  SEPA Rulebook (14 Monate). Two-step: a preview shows the before/after diff
  plus the earliest legal erasure date. Execution requires Admin role plus an
  explicit override and written reason when the retention window has not expired.
- Einwilligungs-Log. Append-only history per consent type (Datenverarbeitung,
  Foto/Name, Newsletter, Vereinszeitung) with free-text evidence.
- Anfragen-Ticketing. Auskunfts- und Löschanfragen zentral verwaltet; die
  30-Tage-Frist nach Art. 12 (3) DSGVO wird automatisch berechnet.

### Datenqualität

- Roughly two dozen read-only checks over the member base, each a single SQL
  predicate so the summary counts all of them in one round trip and the
  drill-down lists the affected rows with the same clause.
- Examples: Lastschrift ohne Mandat oder ohne IBAN, abgelaufenes oder bald
  ablaufendes SEPA-Mandat, unplausibles Geburtsdatum, Austritt vor Eintritt,
  mögliche Dubletten, Tarif passt nicht zum Alter, Volljährige auf Eltern-Konto.
- Severities (error / warn / info) drive the accent. Findings can be
  acknowledged so a known exception stops nagging, and the whole list exports to
  CSV and XLSX. Counts are captured in the nightly snapshot for a trend.

### Reports (Berichte)

- Geburtstagsliste with month and runden-Geburtstag filters.
- Ehrungen (10/25/40/50/60/70 Jahre) with year selector.
- Abteilungs-Statistik. Mitglieder je Abteilung, Altersverteilung, Geschlecht.
- Finanzbericht. Sollstellungen aggregated by Beitragsart.
- Bestandserhebung zum Stichtag. Pro Abteilung mal Geschlecht mal
  LSB-Altersgruppe. Mehrfachmitgliedschaften zählen mehrfach wie vom DOSB
  vorgegeben. CSV-Export plus Unterschriften-PDF. Each run is archived with a
  SHA-256 fingerprint so reprints do not diverge.
- A filterable member export that honours the current search, status and
  Abteilung. Every report exports to CSV and has a print-friendly view.

### Import and ingest

- Linear Webverein `mysqldump` upload up to 50 MB. Parsed in process, multi-row
  inserts split, MySQL escapes decoded, written in batches with live progress
  (published per tenant through Redis).
- The upload writes through the ingest pipeline. Diffs land in the audit log
  and trigger a pre-import snapshot. Contracts and SEPA mandates upsert in place,
  so app-created Sollstellungen survive a re-import.
- Historical tables are carried over, not discarded.
  - `mgsolln` becomes Sollstellungen (`source='linear_import'`), aggregated by
    summing `Betrag/Bezahlt/Offen` per Vertrag und Jahr. Linear's GUID is kept
    on `linear_guid` and used to join `lastprots.SollGUID`.
  - `mgartdat` populates `fee_type_price_history` so reports resolve the
    effective Beitragsart-Preis per Monat.
  - `sportarten` und `fachverbaende` load into `linear_sport_types` und
    `linear_federations` for Abteilungs-Picklists.
  - `lastprot` / `lastproth` become `legacy_sepa_runs` with the raw pain.008 XML
    preserved verbatim; `lastprots` / `lastprotsh` map to `legacy_sepa_run_items`.
  - Re-imports are idempotent via the `fee_runs_linear_guid_uk` unique index.
  - Linear's `pass` table (desktop UI prefs) is intentionally not imported.
    better-auth owns user accounts.

### Snapshots and audit

- Automatic nightly snapshot of every member at 02:30, per tenant. Skips
  unchanged rows. Manual button plus a pre-import snapshot before any upload.
- Granular restore. Pick a member, pick a snapshot, see the field-level diff,
  restore the whole row or individual fields. A Postgres advisory lock keeps
  replicas from colliding.
- Audit log. Every change records actor, source (UI, import, legacy push,
  system, DSGVO), before/after JSON and a human-readable summary. Full-text
  search over actor, member number, summary and field name; filter by source,
  date and member.

### Auth and access

- better-auth with `tanstackStartCookies`. Email plus password, per tenant.
- Invite-only signup with single-use tokens. A partially-failed acceptance can
  be retried (and reuses the password just entered) instead of permanently
  blocking the address.
- Three roles: Admin, Vorstand, Readonly. Every protected oRPC procedure checks
  role server-side.
- First admin created interactively at `/setup`, reachable without auth only
  while the user table is empty.
- Last-admin guard. The better-auth admin endpoints (`set-user-banned`,
  `remove-user`, `set-role`) are intercepted before they can leave the instance
  with zero active admins.
- SMTP configurable per tenant from the admin UI, with SNI hostname, a
  self-signed-cert toggle and a "Test mail" button that validates a config
  before it is saved.

### MCP endpoint (KI-Zugriff)

- Remote MCP server (Model Context Protocol, Streamable HTTP) at `/api/mcp`
  for AI assistants like Claude Code and Claude Desktop.
- Auth via admin-issued API keys (better-auth api-key plugin, hashed at rest,
  per-key rate limit and optional expiry), sent as an `x-api-key` header, with
  per-IP throttling in front so invalid keys cannot hammer verification. Keys
  are managed under Einstellungen, KI-Zugriff and shown exactly once.
- A key acts with the lower of its granted role and the owner's current role.
  Tools call the existing oRPC procedures, so role checks, audit entries and
  logging are identical to browser requests. Readonly keys get query tools only
  (member search/detail, dashboard, reports, dunning status); Vorstand keys
  additionally get curated mutations (members, tasks, mark postings paid, set a
  Beitragsart age range). Beitrags-/Mahnläufe, SEPA, imports, settings and the
  danger zone are not exposed.
- Connect: `claude mcp add --transport http kontor2 https://<host>/api/mcp
  --header "x-api-key: <KEY>"` (Claude Desktop goes through `mcp-remote`; the
  settings page shows ready-to-copy snippets).

### Admin and operator console

- CRUD for Abteilungen, Beitragsarten, Benutzer, SMTP, Vereinsdaten (including
  branding: Anzeigename, Logo, Markenfarbe, white-label over the Kontor2 brand).
- Snapshot run history with bytes, member counts and trigger reason.
- Verschlüsselung. Inspect the active keyring and run "Daten neu verschlüsseln"
  after an `APP_SECRET` rotation. v1 ciphertexts stay readable via per-key
  fallback.
- Danger zone (admin-only). Live-count cards with type-to-confirm dialogs:
  delete orphan Kontakte, purge old soft-deleted members, trim the audit log,
  and a double-confirm "wipe everything" that keeps users, Abteilungen,
  Beitragsarten and settings. Every execution writes a `danger_zone` audit row
  first.
- A separate operator console (its own host, login and control database) lists,
  provisions, suspends and removes tenant clubs without touching their data.

### UI niceties

- Command palette (`⌘K` / `Ctrl K`) with a Redis-backed live member search.
- Keyboard shortcuts. `?` opens the cheatsheet; `g d/m/a/b/s` navigate, `n` new
  member, `e` edit.
- Sortable member list with column state synced into the URL.
- Mobile drawer navigation with body-scroll lock, safe-area insets and no iOS
  zoom on input focus.
- Route-level error boundaries with retry, a NotFoundPanel for unknown routes,
  and skeleton placeholders while loading.
- An on-brand animated aurora backdrop (Navy and Messing), glass surfaces and a
  subtle, `prefers-reduced-motion`-aware motion vocabulary. Destructive actions
  use a type-to-confirm dialog.
- Version chip in the sidebar and on login/setup. One click opens a "Was ist
  neu" dialog from the curated release log, with an unread dot per new version.
- Light and dark theme. Full favicon set built from the configured club logo.
