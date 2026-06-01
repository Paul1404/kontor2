# SVUWV

Vereinsverwaltung for SV 1945 Untereuerheim e.V. Replaces the legacy "Linear
Webverein" desktop software. Internal admin tool, German UI.

## What it does

### Members
- Lossless mirror of the Linear `adresse` schema. All 247 columns map onto
  the `members` table without truncation. Linear's `bit(1)` flags become
  proper booleans. The single-letter status codes (`A`, `P`, `N`) stay as
  text because that's what they actually are.
- IBANs are AES-256-GCM encrypted at rest with a keyring (`APP_SECRET` plus
  optional `APP_SECRET_PREV` for rotation). Clients only ever see the last
  four digits.
- Full CRUD with edit, create, soft-delete and undelete.
- Many-to-many Abteilungen with per-Abteilung Eintritts- and Austrittsdaten.
- Verknüpfungen (Familienbeziehungen) imported from Linear and editable in the
  UI.
- Kontakt entries (Zahlende ohne eigene Mitgliedschaft) imported from
  Linear are first-class. They open from the list and from Beziehungen,
  fall back to `AdrNr` when there is no Mitgliedsnummer, and get a "Kontakt"
  badge so they're not mistaken for members. Admin-only filter surfaces
  orphan Kontakte without any relationship as candidates for cleanup.
- Per-member file attachments via S3. Signed URLs, PDF/PNG/JPEG only, 10 MB
  cap.
- vCard 3.0 export per member. Works with iOS Contacts and macOS Contacts
  without complaints.
- Clickable phone, email and address fields. `tel:`, `mailto:`, maps link.
- DSGVO panel on the member detail page links straight to Auskunft, Löschung
  and Einwilligungs-Log for that person.

### Beitragsläufe
- Wizard that selects active mandates for a billing year, picks the right
  Beitragsart for each member, and assembles a draft Beitragslauf.
- Generates valid pain.008.001.02 XML. FRST and RCUR transactions live in
  separate `<PmtInf>` blocks per Bundesbank rules.
- Stornieren is supported. A finalised run flips its mandates from FRST to
  RCUR for the next cycle.
- Per-Beitragsart amounts and Sollstellung view on member detail.

### Forderungen, Mahnwesen, SEPA-Rückläufer
- Forderungen-Dashboard. Open Sollstellungen grouped per member, filterable
  by Mahnstufe, batch "mark as paid" for cash and Überweisung payments.
- SEPA-Rückläufer erfassen. Pick a committed `fee_run_item`, attach an
  R-Transaction reason code (AC04, AM04, MS03, ...) and optional
  Rücklastschriftgebühr. Reopens the matching Sollstellung as `returned`.
- Mahnläufe in three escalation levels (Erinnerung, 1. Mahnung, 2. Mahnung).
  Wizard picks eligible members, computes Mahngebühren per Stufe (configurable
  under Vereinsdaten), renders one PDF per member and bumps `mahnstufe` on
  the touched Sollstellungen.
- Mahnsperre auf Mitgliedsebene wird respektiert. Stornieren eines Mahnlaufs
  rollt die Mahnstufe zurück.

### Mitgliederportal (Self-Service)
- Magic-link Login per Mitglied. Admin issues a single-use token from the
  member detail page; the link is mailed via the existing SMTP config and
  spawns a 30-day cookie session on first use.
- Members see their Stammdaten (read-only) and can propose changes to
  Anrede, Name, Anschrift, Telefon, E-Mail.
- Changes land as `portal_change_requests` (status pending). Vorstand
  reviews them under "Portal-Anfragen" and either applies the whole set,
  picks individual fields, or rejects with notes. Applied changes write
  through to `members` with a full audit entry.

### DSGVO
- Auskunft nach Art. 15. Per-member dossier as JSON and PDF with masked
  IBANs and 24-hour-signed S3 download links for every attachment.
  Deterministic SHA-256 over the canonical serialization, recorded in
  `dsgvo_requests` so an export can be reproduced and verified later.
- Löschung nach Art. 17 with an explicit pseudonymisation policy per
  column. Financial and SEPA-mandate fields are preserved per §147 AO
  (10 Jahre) and SEPA Rulebook (14 Monate). Two-step: a preview shows the
  before/after diff plus the earliest legal erasure date. Execution
  requires Admin role, plus an explicit override and a written reason when
  the retention window has not expired.
- Einwilligungs-Log. Append-only history per consent type
  (Datenverarbeitung, Foto/Name, Newsletter, Vereinszeitung) with free-text
  evidence. The latest row per type is the current state.
- Anfragen-Ticketing. Auskunfts- und Löschanfragen werden zentral
  verwaltet; die 30-Tage-Frist nach Art. 12 (3) DSGVO wird automatisch
  berechnet.

### Reports (Berichte)
- Geburtstagsliste with month and runden Geburtstag filters.
- Ehrungen (10/25/40/50/60/70 Jahre Mitgliedschaft) with year selector.
- Abteilungs-Statistik. Mitglieder je Abteilung, Altersverteilung, Geschlecht.
- Finanzbericht. Sollstellungen aggregated by Beitragsart.
- Bestandserhebung zum Stichtag. Pro Abteilung × Geschlecht × LSB-Altersgruppe
  (0-6, 7-14, 15-18, 19-26, 27-40, 41-60, 61+, unbekannt). Mehrfach-
  mitgliedschaften zählen mehrfach wie vom DOSB vorgegeben. CSV-Export plus
  Unterschriften-PDF für den Vorstand. Jede erzeugte Erhebung wird mit
  SHA-256-Fingerprint archiviert, damit Nachdrucke nicht abweichen.
- Every report exports to CSV and has a print-friendly view.

### Import and ingest
- Linear Webverein `mysqldump` upload. Up to 50 MB. Parses the dump in
  process, splits multi-row inserts, decodes MySQL escapes.
- SVUMS push compatibility. `POST /api/ingest/svums` accepts the same record
  shape (`AdrNr`, `MITGLNR`, `Anrede`, etc.) so the mapper is shared between
  SQL upload and JSON push.
- Both paths write through the same ingest pipeline. Diffs land in the audit
  log and trigger a pre-import snapshot.
- Historische Tabellen werden mitgenommen, nicht weggeworfen:
  - `mgsolln` becomes Sollstellungen with `source='linear_import'`. The
    `(AdrNr, Jahr, VertragNr, Art, Zeitraum)` PK is aggregated by summing
    `Betrag/Bezahlt/Offen` per Vertrag + Jahr so the existing unique
    constraint holds. Linear's first-row GUID is preserved on
    `linear_guid` and used as the join key against `lastprots.SollGUID`.
  - `mgartdat` populates a `fee_type_price_history` lookup so reports can
    resolve the effective Beitragsart-Preis per Monat.
  - `sportarten` and `fachverbaende` are loaded into `linear_sport_types`
    and `linear_federations` lookups for later Abteilungs-Picklists.
  - `lastprot` / `lastproth` become `legacy_sepa_runs` with the raw
    pain.008 XML preserved verbatim; `archived=true` distinguishes the
    purged journal. `lastprots` / `lastprotsh` map to
    `legacy_sepa_run_items` and link runs to historical Sollstellungen
    via GUID.
  - Re-imports are idempotent: the `fee_runs_linear_guid_uk` unique
    index dedupes on Linear's GUID.
  - Linear's `pass` table (BENUTZER/PASSWORT/UI-prefs of the desktop
    app) is intentionally not imported. better-auth owns user accounts.

### Snapshots
- Automatic nightly snapshot of every member at 02:30 local time. Skips
  unchanged rows.
- Manual snapshot button from the admin page.
- Pre-import snapshot before any SQL upload or SVUMS push lands.
- Granular restore. Pick a member, pick a snapshot, see the field-level diff,
  restore the whole row or individual fields.
- Postgres advisory lock keeps multiple replicas from running the snapshot
  at the same time.

### Audit log
- Every member change is recorded with actor, source (UI, import, SVUMS,
  system), before/after JSON and a human-readable summary.
- Full-text search over actor, member number, summary and field name.
- Filter by source, date range, member.
- Adjustable page size.

### Auth and access
- better-auth with `tanstackStartCookies`. Email + password.
- Invite-only signup. Admin sends an invite link with a single-use token.
  A partially-failed acceptance can be retried instead of permanently
  blocking the address.
- Three roles: Admin, Vorstand, Readonly. Every protected oRPC procedure
  checks role server-side. Route guards alone are not trusted.
- First-run bootstrap admin from `SVUWV_BOOTSTRAP_ADMIN_EMAIL` and
  `SVUWV_BOOTSTRAP_ADMIN_PASSWORD` when the user table is empty. If those
  env vars are not set, the very first request is redirected to `/setup`
  for an interactive first-admin form.
- Last-admin guard. The better-auth admin endpoints
  (`set-user-banned`, `remove-user`, `set-role`) are intercepted before
  they can leave the instance with zero active admins. No operator can
  lock the building from the inside.
- SMTP settings configurable from the admin UI. SNI hostname is sent and
  there's a toggle to skip cert verification for in-house MTAs with self-signed
  certs. The "Test mail" button accepts the inline form values, so a new
  config can be validated before it's saved.

### Admin
- CRUD for Abteilungen, Beitragsarten, Benutzer, SMTP, Vereinsdaten.
- Snapshot run history with bytes, member counts and trigger reason.
- Verschlüsselung. Inspect the active keyring (current key + fallbacks)
  and run "Daten neu verschlüsseln" after an `APP_SECRET` rotation. v1
  ciphertexts stay readable via per-key fallback; failures are logged
  instead of silently dropped.
- Danger zone (`/app/admin/erweitert`, admin-only). Four cards with live
  counts and type-to-confirm dialogs: delete orphan Kontakte, purge
  soft-deleted members older than N days, trim the audit log older than
  N days, and a double-confirm "wipe everything" that resets
  members/contracts/sepa/snapshots/audit but keeps users, Abteilungen,
  Beitragsarten and settings. Every execution writes a `danger_zone`
  audit row before it runs.

### Dashboard
- Mitgliederzahl, Neue und Austritte im Monat, Mitglieder je Abteilung.

### UI niceties
- Command palette (`⌘K` or `Ctrl K`). Searches members live with a Redis-backed
  cache.
- Keyboard shortcuts. `?` opens the cheatsheet. `g d`, `g m`, `g a`, `g b`,
  `g s` for navigation. `n` for new member, `e` to edit.
- Sortable member list with column state synced into the URL. Pasting a link
  reproduces the exact view.
- Mobile drawer navigation. Hamburger button, slide-in sidebar, backdrop
  click and Escape close it. Body scroll is locked while open. iOS Safari
  won't zoom on input focus (16px minimum below `sm`), grids that were
  fixed two-column collapse to one, and `safe-area-inset-bottom` is
  honoured on the bottom edge.
- Route-level error boundaries. The shell stays visible on child-route
  errors and shows an `ErrorPanel` with retry plus collapsible technical
  details. Unknown routes get a `NotFoundPanel` with a back link instead
  of a bare 404. Skeleton placeholders replace "Wird geladen…" on the
  dashboard, list, detail, edit and audit views.
- Subtle motion on dialogs and toasts (fade + zoom, slide-in). Respects
  `prefers-reduced-motion`. The confirm dialog autofocuses the confirm
  button so Enter submits. Destructive actions use a
  type-to-confirm dialog where the user has to type a fixed German phrase
  (the wipe action requires two).
- Einklappbare "So funktioniert es"-Erklärungen auf komplexen Admin-Seiten
  (Portal-Anfragen, Benutzer, Mahnstufen, Mahnläufe, Beitragsläufe,
  Beitragsarten, Ehrungen, Finanzbericht, Linear-Import). Standardmäßig
  zugeklappt, damit sie erfahrene Nutzer nicht stören.
- Version chip in the sidebar footer and on the login / setup pages. One
  click opens a "Was ist neu"-Dialog with the curated release log grouped
  by Neu / Behoben / Verbessert / Breaking / Intern. An unread dot lights
  up whenever the bundled `CURRENT_VERSION` differs from the one the
  browser previously acknowledged.
- Light and dark theme.
- SV Untereuerheim crest as favicon. Full icon set (SVG, ICO, PNG variants,
  apple-touch, web manifest).

## Stack

TanStack Start (Vite), TanStack Router, TanStack Query, TanStack Form,
oRPC v1, better-auth, Drizzle ORM, Valibot, PostgreSQL, Redis, S3, Bun,
Tailwind v4, shadcn-style components, lucide-react, Vitest, Biome.

## Architecture

One TanStack Start app does both SSR and client. Vite builds it into
`dist/server` and `dist/client`. In production `scripts/serve.ts` wraps the
built server handler on `Bun.serve`, serves static assets from `dist/client`
and `public` with a 1-day cache, runs a startup preflight, and adds security
headers plus a Content-Security-Policy to every HTML response. Railway
terminates TLS in front of it.

### Request lifecycle

1. A request hits the Bun server. Static files are served directly; everything
   else falls through to the SSR handler.
2. File-based routes in `src/routes` resolve. `__root.tsx` is the document
   shell, `app/route.tsx` is the authed app, `portal/route.tsx` is the member
   self-service shell, and `api/*.ts` are server routes.
3. Data and mutations go through oRPC, mounted at `/api/rpc/$`. The browser
   talks to it through an isomorphic `@orpc/tanstack-query` client so the same
   calls work during SSR and after hydration.
4. Every procedure runs through one middleware chain: `observability` (times
   the call, logs the outcome once with a request id) then a role gate. That
   gives four entrypoints in `src/server/orpc/base.ts`: `publicProc`,
   `authedProc`, `vorstandProc`, `adminProc`. Roles are hierarchical
   (`admin` ⊃ `vorstand` ⊃ `readonly`) and checked server-side on every call,
   never by route guards alone.
5. `createContext` builds the per-request context (Drizzle handle, better-auth
   session, headers, request id), ensures the bootstrap admin exists, and lazily
   starts the snapshot scheduler.

### Layers

- **Routes** (`src/routes`) -- thin. They load data via oRPC and render
  components. The route tree (`routeTree.gen.ts`) is generated.
- **API** (`src/server/orpc`) -- `router.ts` composes one domain router per file
  in `procedures/` into `appRouter`. Input and output are validated with
  Valibot. Errors are thrown as `ORPCError` with uppercase codes.
- **Domain logic** (`src/server/*`) -- the heavy lifting lives outside the
  procedures so it stays testable:
  - `importer/` -- Linear `mysqldump` ingest. `sql-tokenizer.ts` splits the
    dump, `linear-mapper.ts` maps raw columns, `aggregate-mgsolln.ts` folds
    historical Sollstellungen, `ingest-pipeline.ts` is the shared write path
    for both SQL upload and SVUMS push.
  - `sepa/` -- `build-fee-run.ts`, `select-mandate.ts`, `pain008.ts` (the
    pain.008.001.02 writer), `iban.ts`, `direct-debit.ts`.
  - `dunning/`, `dsgvo/` (`auskunft`, `erasure`, `policy`), `reports/`,
    `verbandsmeldung/` (Bestandserhebung), `snapshots/`, `audit/`.
  - `pdf/` -- `@react-pdf/renderer` templates and a render wrapper.
- **Data** (`src/server/db`) -- Drizzle over Postgres (`postgres.js`). Tables in
  `schema/`, columns snake_case mirroring Linear, table objects camelCase.
  Secret columns use the `encryptedText` type, which transparently AES-256-GCM
  encrypts on write and decrypts on read.
- **Frontend libs** (`src/lib`) -- theme, global shortcuts, saved table views,
  vCard, CSV export, formatting, and the release-notes source of truth.
  Components live in `src/components`, with shadcn-style primitives in
  `components/ui`.

### Secrets and crypto

A single `APP_SECRET` (32-byte hex) is the only secret you set. Everything else
is derived from it with HKDF-SHA256 in `src/server/env.ts`: the better-auth
signing key, the data-at-rest encryption key, and the SVUMS push HMAC key. The
encryption keyring keeps rotated-out keys readable, so an `APP_SECRET` rotation
plus a re-encrypt pass never strands existing ciphertext. Env is parsed and
validated with Valibot at startup; a bad value fails fast with a readable
message.

### External services

- **Postgres** -- system of record, accessed only from server code.
- **Redis** (`ioredis`) -- live member-search cache behind the command palette
  and nonce dedupe for SVUMS push replay protection.
- **S3** -- per-member file attachments, served through short-lived signed URLs.

### Scheduling

The nightly member snapshot runs in-process. It initialises lazily inside
`createContext`, so `serve.ts` fires one self-request on boot to make sure the
timer is installed even on a fresh container with no traffic. A Postgres
advisory lock keeps multiple replicas from running it at once. Set
`SNAPSHOT_CRON_DISABLED=1` and drive it externally via the HMAC-protected
`POST /api/cron/snapshots` route instead.

### Server routes

- `/api/rpc/$` -- oRPC handler (all app data and mutations).
- `/api/auth/$` -- better-auth handler.
- `/api/health` -- Railway healthcheck.
- `/api/files/$id` -- signed attachment download.
- `/api/ingest/svums` -- HMAC-signed SVUMS push.
- `/api/cron/snapshots` -- external snapshot trigger.
- `/api/portal/zugang/$token`, `/api/portal/logout` -- magic-link portal session.

## Run locally

```bash
bun install
cp .env.example .env
openssl rand -hex 32   # paste into APP_SECRET
docker run -d --name pg -p 5432:5432 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=svuwv postgres:16
docker run -d --name redis -p 6379:6379 redis:7
bun run db:generate
bun run db:migrate
bun run dev
```

Open <http://localhost:3000>.

The first user is created from `SVUWV_BOOTSTRAP_ADMIN_EMAIL` and
`SVUWV_BOOTSTRAP_ADMIN_PASSWORD` if the user table is empty.

## Tests

```bash
bun test
```

Covers the SQL importer (incl. phase-2 mgsolln aggregation and a
real-dump smoke test against `reference/linear/datesicherung.sql`),
ingest HMAC, SEPA mandate selection, pain.008 output, IBAN normalisation,
encryption keyring round-trip across `APP_SECRET` rotations, last-admin
guard request shape, DSGVO policy, Bestandserhebung age buckets,
snapshot diff and restore, audit diffing, report calculations, vCard
output, BLZ lookup, and the release-notes invariants (newest-first, no
duplicate versions, `CURRENT_VERSION` stays in sync with
`package.json`).

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
  data-at-rest key, SVUMS push HMAC) is derived from this via HKDF-SHA256.
  See `bun scripts/print-derived-secrets.ts`.
- `APP_SECRET_PREV`. Optional. Previous APP_SECRET(s), comma-separated, kept
  in the keyring during a rotation so existing encrypted rows stay readable.
  Rotation: set this to the current secret, generate a new `APP_SECRET`,
  deploy, run Einstellungen > Verschlüsselung > Re-encrypt, then unset.
- `BETTER_AUTH_URL`. Public URL of the deployment.
- `SVUWV_BOOTSTRAP_ADMIN_EMAIL`, `SVUWV_BOOTSTRAP_ADMIN_PASSWORD`. Optional,
  only used on the very first boot. If unset, the first request to the app
  is redirected to `/setup` where a first admin can be created interactively.

`railway.toml` runs `bun run db:migrate:prod` before each deploy and points
the healthcheck at `/api/health`. Migrations are applied with a runtime-only
migrator. `drizzle-kit` stays a dev dependency and does not ship in the
runtime image.

The nightly snapshot scheduler runs in-process by default. To move it to an
external scheduler (Railway Cron, GitHub Actions, etc.), set
`SNAPSHOT_CRON_DISABLED=1` and hit `POST /api/cron/snapshots` with the same
HMAC headers used for SVUMS push.

## Environment

See [`.env.example`](.env.example).

## SVUMS push contract

`POST /api/ingest/svums` with JSON body. Headers:

- `X-SVUMS-Timestamp: <unix-seconds>`
- `X-SVUMS-Signature: hex(HMAC_SHA256(svumsPushSecret, timestamp + "." + raw_body))`

Body keys: `batch`, `members`, `feeTypes`, `contracts`, `sepaMandates`.
Each member record uses the raw Linear column names so the same mapper
handles both SQL upload and JSON push.

Replay protection: signatures are nonce-deduplicated in Redis for 10
minutes. Requests with a timestamp skew greater than the allowed window are
rejected before the body is parsed.

## License

MIT.
