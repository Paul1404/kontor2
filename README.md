# Kontor2

Self-hosted, multi-tenant Vereinsverwaltung. It began as a replacement for one
club's commercial Linear "Online Vereinsverwaltung", a per-seat cloud
subscription advertised at 292,80 € a year, and grew into a single web app that
many clubs can run and own outright. The original Linear database was migrated
losslessly, not re-keyed by hand.

One app runs the entire back office: members and families, contributions and
SEPA direct debit, open items and a dunning workflow, SEPA returns, invoices,
honours, mass mailings, a member self-service portal, DSGVO tooling, a data
quality cockpit, reports, snapshots and a full audit trail. There is even a
built-in MCP endpoint so an AI assistant can read the books. Internal admin
tool, German UI, React 19 on Bun.

## Why this exists

Clubs used Linear's hosted Vereinsverwaltung. The data sat in a vendor cloud,
every extra Vorstand seat cost money, and the underlying schema was the kind you
can still admire in the hidden `/app/museum` route: 247 columns for one address,
a credit-card number in cleartext, the same consent field spelled two different
ways. So the whole thing was rebuilt as software the club controls.

- **Own your data.** It lives in your own Postgres, encrypted at rest. IBANs and
  SMTP passwords are AES-256-GCM, not on someone else's "deutsches
  Rechenzentrum".
- **No per-seat pricing.** Unlimited accounts, three roles, invite-only signup.
- **One container, one secret.** Deploys to Railway (or any Docker host) from a
  single `APP_SECRET`. Every other key is derived from it.
- **Multi-tenant by design.** Each Verein gets its own database, encryption
  keyring and branding, resolved by request host. An operator console
  provisions new clubs without touching another club's data.
- **Migrated once, completely.** Members, contracts, SEPA mandates and the
  historical Sollstellungen and Lastschrift runs all came across, so there is
  nothing to keep the old subscription alive for.

## At a glance

One app, the whole back office.

- **Members and families.** A lossless mirror of the legacy database with full
  CRUD, attachments, relationships, families and vCard export.
- **Beiträge und SEPA.** Direct-debit billing that emits real pain.008.001.02
  XML, plus an online application that quotes the matching Beitragsart.
- **Forderungen und Mahnwesen.** Open-item tracking, SEPA return handling, a
  configurable one-to-three-stage dunning workflow with PDF letters, and a
  goodwill Kulanz path.
- **Rechnungen.** Invoice payers get a proper Rechnung with a sequential
  Rechnungsnummer instead of a debit.
- **Mitgliederportal.** Magic-link self-service with a Vorstand review queue for
  member-proposed changes.
- **Ehrungen.** Honours by tenure or merit, with a printable Ehrenurkunde in the
  club's own colour.
- **Rundschreiben.** Serienbriefe to filtered recipients, by email and as a
  postal PDF batch.
- **Aufgaben (Wiedervorlagen).** A per-member and global to-do list with a
  worklist and bulk actions.
- **DSGVO.** Art. 15 Auskunft, Art. 17 Löschung with a legal retention policy,
  and an append-only consent log, all reproducible and audited.
- **Datenqualität.** Two dozen read-only checks over the member base with
  severities, drill-down, acknowledgements and XLSX export.
- **Berichte.** Birthdays, honours, statistics, finance and the DOSB-style
  Bestandserhebung, every one CSV- and print-ready.
- **Import und ingest.** One pipeline for both a 50 MB Linear `mysqldump` and a
  live HMAC-signed JSON push.
- **Snapshots und audit.** Nightly versioning with field-level restore and a
  searchable record of every change.
- **KI-Zugriff.** A built-in remote MCP server so an assistant can query the
  club with the role of an issued API key.

## Technical feats

The parts that took real engineering, not just CRUD.

- **Lossless legacy mirror.** All 247 columns of Linear's `adresse` table map
  onto `members` without truncation. `bit(1)` flags become real booleans,
  single-letter status codes stay text because that is what they are, and
  historical tables (`mgsolln`, `mgartdat`, `lastprot`, `sportarten` and more)
  are carried over rather than thrown away.
- **One secret, derived keyring.** You set a single `APP_SECRET` (32-byte hex).
  Everything else is derived from it with HKDF-SHA256: the better-auth signing
  key, the data-at-rest encryption key, the legacy push HMAC. IBANs and SMTP
  passwords are AES-256-GCM encrypted at rest through a transparent
  `encryptedText` Drizzle column type. A keyring keeps rotated-out keys
  readable, so an `APP_SECRET` rotation plus a re-encrypt pass never strands
  existing ciphertext.
- **Per-tenant isolation.** A host-based resolver maps each request to a tenant,
  and each tenant has its own database pool, better-auth instance and encryption
  keyring. New clubs are provisioned (database, migrations, registry row, key)
  from a separate operator console with its own accounts and control database,
  so one club can never read another's data. An unknown or apex host resolves to
  the operator realm, never to a club's data.
- **Standards-correct SEPA.** The pain.008.001.02 writer splits FRST and RCUR
  into separate `<PmtInf>` blocks per Bundesbank rules, a single new mandate
  yields exactly one FRST even across several contracts, finalising a run flips
  its mandates FRST to RCUR for the next cycle, and money is summed in integer
  cents end to end to avoid float drift.
- **Reproducible legal documents.** DSGVO exports compute a deterministic
  SHA-256 over a canonical serialization, recorded in `dsgvo_requests` so an
  export can be reproduced and verified later. The Bestandserhebung is archived
  with the same kind of fingerprint so a reprint never silently diverges.
  Generated documents carry a reference number: random and opaque for most
  document types (so it leaks no order or count), and a sequential
  Rechnungsnummer for invoices as German law requires.
- **One ingest path, two front doors.** A 50 MB SQL upload and a live JSON push
  share the same mapper and write pipeline. Re-imports are idempotent: a unique
  index on Linear's GUID dedupes runs, contracts and mandates upsert by natural
  key, and historical Sollstellungen are folded by summing per Vertrag and Jahr
  so the existing constraint holds.
- **Configurable where clubs differ, fixed where the law does.** The
  Beitragsstaffel, fee-category age boundaries, the number of dunning stages and
  the Kündigungsfrist are per-tenant settings; the SEPA XML, the §14 UStG
  invoice numbering and the LSB age buckets are not. New clubs inherit sane
  German defaults, existing clubs keep their exact behaviour, because every such
  migration backfills current values rather than imposing new ones.
- **German-directory address autocomplete.** The online application resolves PLZ
  to Ort and completes street names from the official OpenPLZ directory, which
  covers small Orte and Gemeindeteile that OpenStreetMap misses, with Nominatim
  as a graceful fallback and aggressive Redis caching.
- **Defence in depth on auth.** Every protected oRPC procedure checks its role
  server-side through a hierarchical gate (`admin` enthält `vorstand` enthält
  `readonly`). Route guards are never trusted alone. A last-admin guard
  intercepts the better-auth admin endpoints so no operator can lock everyone
  out of the building from the inside. The MCP endpoint caps an API key at the
  lower of its granted role and the owner's current role.
- **Safe nightly snapshots.** Versioning runs in-process, skips unchanged rows
  and takes a Postgres advisory lock so multiple replicas never collide. It can
  be moved to an external scheduler with one env var.

## Feature sets in detail

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
  blocks per Bundesbank rules, with an honest Vorabankündigung.
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
- SEPA-Rückläufer erfassen. Pick a committed `fee_run_item`, attach an
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
- Legacy push compatibility. `POST /api/ingest/svums` accepts the same record
  shape so the mapper is shared between SQL upload and JSON push.
- Both paths write through the same ingest pipeline. Diffs land in the audit log
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

## Stack

TanStack Start (Vite), TanStack Router, TanStack Query, TanStack Form, oRPC v1,
better-auth, Drizzle ORM, Valibot, PostgreSQL, Redis, S3, Bun, Tailwind v4,
shadcn-style components, lucide-react, `@react-pdf/renderer`, Vitest, Biome.

## Architecture

One TanStack Start app does both SSR and client. Vite builds it into
`dist/server` and `dist/client`. In production `scripts/serve.ts` wraps the
built server handler on `Bun.serve`, serves static assets from `dist/client` and
`public` with a 1-day cache, runs a startup preflight, pins the process to UTC,
301-redirects legacy hosts to the canonical one, and adds security headers plus a
Content-Security-Policy to every HTML response. Railway terminates TLS in front
of it.

### Request lifecycle

1. A request hits the Bun server. Static files are served directly; everything
   else falls through to the SSR handler.
2. The request host resolves to a tenant, which carries that tenant's database,
   auth instance and encryption keyring for the rest of the request. An unknown
   host resolves to the operator console realm.
3. File-based routes in `src/routes` resolve. `__root.tsx` is the document
   shell, `app/route.tsx` is the authed app, `portal/route.tsx` is the member
   self-service shell, `console/route.tsx` is the operator console, `antrag/` is
   the public application, and `api/*.ts` are server routes.
4. Data and mutations go through oRPC, mounted at `/api/rpc/$`. The browser
   talks to it through an isomorphic `@orpc/tanstack-query` client so the same
   calls work during SSR and after hydration.
5. Every procedure runs through one middleware chain: `observability` (times the
   call, logs the outcome once with a request id) then a role gate. That gives
   four entrypoints in `src/server/orpc/base.ts`: `publicProc`, `authedProc`,
   `vorstandProc`, `adminProc`. Roles are hierarchical (`admin` enthält
   `vorstand` enthält `readonly`) and checked server-side on every call.
6. `createContext` builds the per-request context (Drizzle handle, better-auth
   session, headers, request id), ensures the bootstrap admin exists, and lazily
   starts the snapshot scheduler.

### Layers

- **Routes** (`src/routes`). Thin. They load data via oRPC and render
  components. The route tree (`routeTree.gen.ts`) is generated.
- **API** (`src/server/orpc`). `router.ts` composes one domain router per file
  in `procedures/` (members, families, contracts, fee-runs, payments, dunning,
  sepa, sepa-returns, invoices, applications, portal, dsgvo, data-quality,
  reports, verbandsmeldung, ehrungen, rundschreiben, tasks, timeline, snapshots,
  audit, import, settings, console, and more) into `appRouter`. Input and output
  are validated with Valibot. Errors are thrown as `ORPCError` with uppercase
  codes.
- **Domain logic** (`src/server/*`). The heavy lifting lives outside the
  procedures so it stays testable.
  - `importer/`. Linear `mysqldump` ingest. `sql-tokenizer.ts` splits the
    dump, `linear-mapper.ts` maps raw columns, `aggregate-mgsolln.ts` folds
    historical Sollstellungen, `ingest-pipeline.ts` is the shared write path.
  - `sepa/`. `build-fee-run.ts`, `select-mandate.ts`, `pain008.ts`, `iban.ts`,
    `direct-debit.ts`.
  - `address/`. `lookup.ts` (OpenPLZ directory, primary) over `nominatim.ts`
    (fallback) for PLZ and street autocomplete.
  - `domain/application/`. Age categories, fee resolution and the role-to-
    Beitragsart mapping for the public application.
  - `dunning/`, `dsgvo/` (`auskunft`, `erasure`, `policy`), `reports/`,
    `verbandsmeldung/` (Bestandserhebung), `snapshots/`, `audit/`, `mail/`.
  - `pdf/`. `@react-pdf/renderer` templates (Beitrittserklärung, Mahnung,
    Rechnung, Kulanz, Ehrenurkunde, Bestandserhebung, Serienbrief,
    Austrittsbestätigung, DSGVO-Auskunft) and a render wrapper.
- **Data** (`src/server/db`). Drizzle over Postgres (`postgres.js`). Tables in
  `schema/`, columns snake_case mirroring Linear, table objects camelCase.
  Secret columns use the `encryptedText` type, which transparently AES-256-GCM
  encrypts on write and decrypts on read.
- **Frontend libs** (`src/lib`). Theme, global shortcuts, saved table views,
  vCard, CSV export, formatting (timezone-pinned), and the release-notes source
  of truth. Components live in `src/components`, with shadcn-style primitives in
  `components/ui`.

### Secrets and crypto

A single `APP_SECRET` (32-byte hex) is the only secret you set. Everything else
is derived from it with HKDF-SHA256 in `src/server/env.ts`: the better-auth
signing key, the data-at-rest encryption key, and the legacy push HMAC key. Each
tenant derives its own keyring label, so one club's ciphertext is unreadable
with another's keys. The encryption keyring keeps rotated-out keys readable, so
an `APP_SECRET` rotation plus a re-encrypt pass never strands existing
ciphertext. Env is parsed and validated with Valibot at startup; a bad value
fails fast with a readable message.

### External services

- **Postgres.** System of record, accessed only from server code. A control
  database holds the tenant registry and operator accounts; each tenant has its
  own database.
- **Redis** (`ioredis`). Live member-search cache behind the command palette,
  tenant-scoped address and dashboard caches, import progress, MCP and form
  rate limiting, and nonce dedupe for legacy push replay protection.
- **S3.** Per-member file attachments, served through short-lived signed URLs.

### Scheduling

The nightly member snapshot runs in-process for every tenant. It initialises
lazily inside `createContext`, so `serve.ts` fires one self-request on boot to
make sure the timer is installed even on a fresh container with no traffic. A
Postgres advisory lock keeps multiple replicas from running it at once. Set
`SNAPSHOT_CRON_DISABLED=1` and drive it externally via the HMAC-protected
`POST /api/cron/snapshots` route instead.

### Server routes

- `/api/rpc/$`. oRPC handler (all app data and mutations).
- `/api/auth/$`. better-auth handler.
- `/api/mcp`. Remote MCP server for AI assistants.
- `/api/health`. Railway healthcheck.
- `/api/files/$id`. Signed attachment download.
- `/api/ingest/svums`. HMAC-signed legacy push.
- `/api/cron/snapshots`. External snapshot trigger.
- `/api/portal/zugang/$token`, `/api/portal/logout`. Magic-link portal session.

## Run locally

```bash
bun install
cp .env.example .env
openssl rand -hex 32   # paste into APP_SECRET
docker run -d --name pg -p 5432:5432 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=kontor2 postgres:16
docker run -d --name redis -p 6379:6379 redis:7
bun run db:generate
bun run db:migrate
bun run dev
```

Open <http://localhost:3000>.

The first user is created interactively at `/setup`, which is reachable
without auth only while the user table is empty.

## Tests

```bash
bun run test       # fast unit suite (Vitest)
bun run test:int   # integration suite against a throwaway Postgres + Redis
bun run verify     # typecheck + biome ci + unit tests + build
```

Unit coverage includes the SQL importer (incl. phase-2 mgsolln aggregation and a
real-dump smoke test against `reference/linear/datesicherung.sql`), ingest HMAC,
SEPA mandate selection, pain.008 output, IBAN normalisation, the OpenPLZ address
mappers, encryption keyring round-trip across `APP_SECRET` rotations, last-admin
guard request shape, DSGVO policy, Bestandserhebung age buckets, the fee-category
age boundaries, snapshot diff and restore, audit diffing, report calculations,
vCard output, BLZ lookup, the MCP tool registry and role caps, and the
release-notes invariants (newest-first, no duplicate versions, `CURRENT_VERSION`
in sync with `package.json`). The integration suite exercises the real SQL
clauses behind the data-quality checks, fee-run approval and the address
resolver against a live database.

## Deploy

Railway via the included `Dockerfile`. Multi-stage build with a dedicated
`prod-deps` stage so peer dependencies (`kysely`, `better-call`) resolve
correctly at runtime.

Required Railway services:
- Postgres. Reference `${{Postgres.DATABASE_URL}}` as `DATABASE_URL`.
- Redis. Reference `${{Redis.REDIS_URL}}` as `REDIS_URL`.
- Bucket (S3 Generic). Wire all `AWS_*` variables from `${{Bucket.*}}`.

Manually set:
- `APP_SECRET`. 32-byte hex. Every other secret (better-auth signing key,
  data-at-rest key, legacy push HMAC) is derived from this via HKDF-SHA256.
  See `bun scripts/print-derived-secrets.ts`.
- `APP_SECRET_PREV`. Optional. Previous APP_SECRET(s), comma-separated, kept in
  the keyring during a rotation so existing encrypted rows stay readable.
  Rotation: set this to the current secret, generate a new `APP_SECRET`, deploy,
  run Einstellungen, Verschlüsselung, Re-encrypt, then unset.
- `BETTER_AUTH_URL`. Public URL of the deployment.

`railway.toml` runs `bun run db:migrate:prod` before each deploy and points the
healthcheck at `/api/health`. Migrations are applied to every tenant database
with a runtime-only migrator. `drizzle-kit` stays a dev dependency and does not
ship in the runtime image.

The nightly snapshot scheduler runs in-process by default. To move it to an
external scheduler (Railway Cron, GitHub Actions and the like), set
`SNAPSHOT_CRON_DISABLED=1` and hit `POST /api/cron/snapshots` with the same HMAC
headers used for the legacy push.

## Environment

See [`.env.example`](.env.example).

## Legacy push contract

`POST /api/ingest/svums` with JSON body. Headers:

- `X-SVUMS-Timestamp: <unix-seconds>`
- `X-SVUMS-Signature: hex(HMAC_SHA256(svumsPushSecret, timestamp + "." + raw_body))`

Body keys: `batch`, `members`, `feeTypes`, `contracts`, `sepaMandates`. Each
member record uses the raw Linear column names so the same mapper handles both
SQL upload and JSON push.

Replay protection: signatures are nonce-deduplicated in Redis for 10 minutes.
Requests with a timestamp skew greater than the allowed window are rejected
before the body is parsed.

## License

Proprietary. Copyright (c) 2026 Paul Dresch. All rights reserved. See
[LICENSE](LICENSE). No use, copying, modification, or distribution is permitted
without the prior written permission of the owner.
