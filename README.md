# SVUWV

Self-hosted Vereinsverwaltung for SV 1945 Untereuerheim e.V. It replaces
Linear's commercial "Online Vereinsverwaltung" -- a per-seat cloud subscription
advertised at 292,80 € a year -- with a single web app the club runs and owns
outright. The entire Linear database was migrated losslessly, not re-keyed by
hand.

One app runs the whole back office: members, contributions, SEPA direct debit,
dunning, a member self-service portal, DSGVO tooling, reports and an audit
trail. Internal admin tool, German UI, React 19 on Bun.

## Why this exists

The club used Linear's hosted Vereinsverwaltung. The data sat in a vendor cloud,
every extra Vorstand seat cost money, and the underlying schema was the kind you
can admire in the hidden `/app/museum` route (247 columns for one address, a
credit-card number in cleartext, the same consent field spelled two different
ways). So the whole thing was rebuilt as software the club controls:

- **Own your data.** It lives in your own Postgres, encrypted at rest (IBANs and
  SMTP passwords are AES-256-GCM), not on someone else's "deutsches
  Rechenzentrum".
- **No per-seat pricing.** Unlimited accounts, three roles, invite-only signup.
- **One container, one secret.** Deploys to Railway (or any Docker host) from a
  single `APP_SECRET`; every other key is derived from it.
- **Migrated once, completely.** Members, contracts, SEPA mandates and the
  historical Sollstellungen and Lastschrift runs all came across, so there is
  nothing to keep the old subscription alive for.

## At a glance

Eight feature sets, one app:

- **Member management** -- a lossless mirror of the legacy database with full
  CRUD, attachments, relationships and vCard export.
- **Beitragsläufe** -- SEPA direct-debit billing that emits real
  pain.008.001.02 XML.
- **Forderungen & Mahnwesen** -- open-item tracking, SEPA return handling and a
  three-stage dunning workflow with PDF letters.
- **Mitgliederportal** -- magic-link self-service with a Vorstand review queue
  for member-proposed changes.
- **DSGVO** -- Art. 15 Auskunft, Art. 17 Löschung with legal retention policy,
  and an append-only consent log, all reproducible and audited.
- **Berichte** -- birthday, honours, statistics, finance and the DOSB-style
  Bestandserhebung, every one of them CSV- and print-ready.
- **Import & ingest** -- one pipeline for both a 50 MB Linear `mysqldump` and a
  live HMAC-signed JSON push.
- **Snapshots & audit** -- nightly versioning with field-level restore and a
  searchable record of every change.

## Technical feats

The parts that took real engineering, not just CRUD:

- **Lossless legacy mirror.** All 247 columns of Linear's `adresse` table map
  onto `members` without truncation. `bit(1)` flags become real booleans,
  single-letter status codes stay text because that is what they are, and
  historical tables (`mgsolln`, `mgartdat`, `lastprot`, `sportarten`, ...) are
  carried over rather than thrown away.
- **One secret, derived keyring.** You set a single `APP_SECRET` (32-byte hex).
  Everything else -- the better-auth signing key, the data-at-rest encryption
  key, the SVUMS push HMAC -- is derived from it with HKDF-SHA256. IBANs and
  SMTP passwords are AES-256-GCM encrypted at rest through a transparent
  `encryptedText` Drizzle column type. A keyring keeps rotated-out keys
  readable, so an `APP_SECRET` rotation plus a re-encrypt pass never strands
  existing ciphertext.
- **Standards-correct SEPA.** The pain.008.001.02 writer splits FRST and RCUR
  into separate `<PmtInf>` blocks per Bundesbank rules, finalising a run flips
  its mandates FRST to RCUR for the next cycle, and money is summed in integer
  cents end to end to avoid float drift.
- **Reproducible legal documents.** DSGVO exports compute a deterministic
  SHA-256 over a canonical serialization, recorded in `dsgvo_requests` so an
  export can be reproduced and verified later. The Bestandserhebung is archived
  with the same kind of fingerprint so a reprint never silently diverges.
  Generated letters (Mahnung, Austrittsbestätigung, Kulanz) follow the DIN 5008
  business-letter standard and carry sequential document numbers.
- **One ingest path, two front doors.** A 50 MB SQL upload and a live JSON push
  share the same mapper and write pipeline. Re-imports are idempotent: a unique
  index on Linear's GUID dedupes runs, and historical Sollstellungen are folded
  by summing per Vertrag and Jahr so the existing constraint holds.
- **Defence in depth on auth.** Every protected oRPC procedure checks its role
  server-side through a hierarchical gate (`admin` ⊃ `vorstand` ⊃ `readonly`);
  route guards are never trusted alone. A last-admin guard intercepts the
  better-auth admin endpoints so no operator can lock everyone out of the
  building from the inside.
- **Safe nightly snapshots.** Versioning runs in-process, skips unchanged rows
  and takes a Postgres advisory lock so multiple replicas never collide. It can
  be moved to an external scheduler with one env var.

## Feature sets in detail

### Members

- Lossless mirror of the Linear `adresse` schema (247 columns), IBANs
  AES-256-GCM encrypted at rest, clients only ever see the last four digits.
- Full CRUD with edit, create, soft-delete and undelete.
- Many-to-many Abteilungen with per-Abteilung Eintritts- and Austrittsdaten.
- Verknüpfungen (Familienbeziehungen) imported from Linear and editable.
- Kontakt entries (Zahlende ohne eigene Mitgliedschaft) are first-class. They
  fall back to `AdrNr` when there is no Mitgliedsnummer and get a "Kontakt"
  badge. An admin-only filter surfaces orphan Kontakte for cleanup.
- Per-member file attachments via S3. Signed URLs, PDF/PNG/JPEG only, 10 MB cap.
- vCard 3.0 export per member. Works with iOS and macOS Contacts.
- Clickable phone, email and address (`tel:`, `mailto:`, maps link).
- DSGVO panel on the member detail page links straight to Auskunft, Löschung
  and Einwilligungs-Log for that person.

### Beitragsläufe

- Wizard that selects active mandates for a billing year, picks the right
  Beitragsart per member and assembles a draft run.
- Generates valid pain.008.001.02 XML, FRST and RCUR in separate `<PmtInf>`
  blocks per Bundesbank rules.
- Stornieren is supported. A finalised run flips its mandates from FRST to RCUR
  for the next cycle.
- Per-Beitragsart amounts and Sollstellung view on member detail. Proration and
  Kündigungsfrist are configurable.

### Forderungen, Mahnwesen, SEPA-Rückläufer

- Forderungen-Dashboard. Open Sollstellungen grouped per member, filterable by
  Mahnstufe, batch "mark as paid" for cash and Überweisung.
- SEPA-Rückläufer erfassen. Pick a committed `fee_run_item`, attach an
  R-Transaction reason code (AC04, AM04, MS03, ...) and optional
  Rücklastschriftgebühr. Reopens the matching Sollstellung as `returned`.
- Mahnläufe in three escalation levels (Erinnerung, 1. Mahnung, 2. Mahnung).
  Configurable Mahngebühren per Stufe, one PDF per member, `mahnstufe` bumped on
  the touched Sollstellungen. Minors are addressed to their legal
  representative; the run warns when none is on file. Mahnungen can also be sent
  by email with a preview.
- Mahnsperre auf Mitgliedsebene wird respektiert. Stornieren eines Mahnlaufs
  rollt die Mahnstufe zurück.
- Kulanz-Brief. A payment reminder that also offers a goodwill Sonderkündigung:
  pay, or return the attached signed Kündigungsbestätigung and the open claim is
  waived.

### Mitgliederportal (Self-Service)

- Magic-link login per member. Admin issues a single-use token from the member
  detail page; the link is mailed via the existing SMTP config and spawns a
  30-day cookie session on first use.
- Members see their Stammdaten read-only and can propose changes to Anrede,
  Name, Anschrift, Telefon, E-Mail.
- Changes land as `portal_change_requests` (pending). Vorstand reviews them
  under "Portal-Anfragen" and applies the whole set, picks individual fields, or
  rejects with notes. Applied changes write through to `members` with an audit
  entry.

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

### Reports (Berichte)

- Geburtstagsliste with month and runden-Geburtstag filters.
- Ehrungen (10/25/40/50/60/70 Jahre) with year selector.
- Abteilungs-Statistik. Mitglieder je Abteilung, Altersverteilung, Geschlecht.
- Finanzbericht. Sollstellungen aggregated by Beitragsart.
- Bestandserhebung zum Stichtag. Pro Abteilung × Geschlecht × LSB-Altersgruppe.
  Mehrfachmitgliedschaften zählen mehrfach wie vom DOSB vorgegeben. CSV-Export
  plus Unterschriften-PDF. Each run is archived with a SHA-256 fingerprint so
  reprints do not diverge.
- Every report exports to CSV and has a print-friendly view.

### Import and ingest

- Linear Webverein `mysqldump` upload up to 50 MB. Parsed in process, multi-row
  inserts split, MySQL escapes decoded, written in batches with live progress.
- SVUMS push compatibility. `POST /api/ingest/svums` accepts the same record
  shape so the mapper is shared between SQL upload and JSON push.
- Both paths write through the same ingest pipeline. Diffs land in the audit log
  and trigger a pre-import snapshot.
- Historical tables are carried over, not discarded:
  - `mgsolln` becomes Sollstellungen (`source='linear_import'`), aggregated by
    summing `Betrag/Bezahlt/Offen` per Vertrag + Jahr. Linear's GUID is kept on
    `linear_guid` and used to join `lastprots.SollGUID`.
  - `mgartdat` populates `fee_type_price_history` so reports resolve the
    effective Beitragsart-Preis per Monat.
  - `sportarten` and `fachverbaende` load into `linear_sport_types` and
    `linear_federations` for Abteilungs-Picklists.
  - `lastprot` / `lastproth` become `legacy_sepa_runs` with the raw pain.008 XML
    preserved verbatim; `lastprots` / `lastprotsh` map to `legacy_sepa_run_items`.
  - Re-imports are idempotent via the `fee_runs_linear_guid_uk` unique index.
  - Linear's `pass` table (desktop UI prefs) is intentionally not imported.
    better-auth owns user accounts.

### Snapshots and audit

- Automatic nightly snapshot of every member at 02:30 local time. Skips
  unchanged rows. Manual button plus a pre-import snapshot before any upload.
- Granular restore. Pick a member, pick a snapshot, see the field-level diff,
  restore the whole row or individual fields. A Postgres advisory lock keeps
  replicas from colliding.
- Audit log. Every change records actor, source (UI, import, SVUMS, system),
  before/after JSON and a human-readable summary. Full-text search over actor,
  member number, summary and field name; filter by source, date and member.

### Auth and access

- better-auth with `tanstackStartCookies`. Email + password.
- Invite-only signup with single-use tokens. A partially-failed acceptance can
  be retried instead of permanently blocking the address.
- Three roles: Admin, Vorstand, Readonly. Every protected oRPC procedure checks
  role server-side.
- First-run bootstrap admin from env, or an interactive `/setup` form when the
  user table is empty and no env is set.
- Last-admin guard. The better-auth admin endpoints (`set-user-banned`,
  `remove-user`, `set-role`) are intercepted before they can leave the instance
  with zero active admins.
- SMTP configurable from the admin UI, with SNI hostname, a self-signed-cert
  toggle and a "Test mail" button that validates a config before it is saved.

### Admin

- CRUD for Abteilungen, Beitragsarten, Benutzer, SMTP, Vereinsdaten.
- Snapshot run history with bytes, member counts and trigger reason.
- Verschlüsselung. Inspect the active keyring and run "Daten neu verschlüsseln"
  after an `APP_SECRET` rotation. v1 ciphertexts stay readable via per-key
  fallback.
- Danger zone (admin-only). Live-count cards with type-to-confirm dialogs:
  delete orphan Kontakte, purge old soft-deleted members, trim the audit log,
  and a double-confirm "wipe everything" that keeps users, Abteilungen,
  Beitragsarten and settings. Every execution writes a `danger_zone` audit row
  first.

### UI niceties

- Command palette (`⌘K` / `Ctrl K`) with a Redis-backed live member search.
- Keyboard shortcuts. `?` opens the cheatsheet; `g d/m/a/b/s` navigate, `n` new
  member, `e` edit.
- Sortable member list with column state synced into the URL.
- Mobile drawer navigation with body-scroll lock, safe-area insets and no iOS
  zoom on input focus.
- Route-level error boundaries with retry, a NotFoundPanel for unknown routes,
  and skeleton placeholders while loading.
- Subtle, `prefers-reduced-motion`-aware motion. Destructive actions use a
  type-to-confirm dialog.
- Version chip in the sidebar and on login/setup. One click opens a "Was ist
  neu" dialog from the curated release log, with an unread dot per new version.
- Light and dark theme. Full favicon set built from the SV Untereuerheim crest.

## Stack

TanStack Start (Vite), TanStack Router, TanStack Query, TanStack Form, oRPC v1,
better-auth, Drizzle ORM, Valibot, PostgreSQL, Redis, S3, Bun, Tailwind v4,
shadcn-style components, lucide-react, Vitest, Biome.

## Architecture

One TanStack Start app does both SSR and client. Vite builds it into
`dist/server` and `dist/client`. In production `scripts/serve.ts` wraps the
built server handler on `Bun.serve`, serves static assets from `dist/client` and
`public` with a 1-day cache, runs a startup preflight, and adds security headers
plus a Content-Security-Policy to every HTML response. Railway terminates TLS in
front of it.

### Request lifecycle

1. A request hits the Bun server. Static files are served directly; everything
   else falls through to the SSR handler.
2. File-based routes in `src/routes` resolve. `__root.tsx` is the document
   shell, `app/route.tsx` is the authed app, `portal/route.tsx` is the member
   self-service shell, and `api/*.ts` are server routes.
3. Data and mutations go through oRPC, mounted at `/api/rpc/$`. The browser
   talks to it through an isomorphic `@orpc/tanstack-query` client so the same
   calls work during SSR and after hydration.
4. Every procedure runs through one middleware chain: `observability` (times the
   call, logs the outcome once with a request id) then a role gate. That gives
   four entrypoints in `src/server/orpc/base.ts`: `publicProc`, `authedProc`,
   `vorstandProc`, `adminProc`. Roles are hierarchical (`admin` ⊃ `vorstand` ⊃
   `readonly`) and checked server-side on every call.
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
    historical Sollstellungen, `ingest-pipeline.ts` is the shared write path.
  - `sepa/` -- `build-fee-run.ts`, `select-mandate.ts`, `pain008.ts`, `iban.ts`,
    `direct-debit.ts`.
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
timer is installed even on a fresh container with no traffic. A Postgres advisory
lock keeps multiple replicas from running it at once. Set
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

Covers the SQL importer (incl. phase-2 mgsolln aggregation and a real-dump smoke
test against `reference/linear/datesicherung.sql`), ingest HMAC, SEPA mandate
selection, pain.008 output, IBAN normalisation, encryption keyring round-trip
across `APP_SECRET` rotations, last-admin guard request shape, DSGVO policy,
Bestandserhebung age buckets, snapshot diff and restore, audit diffing, report
calculations, vCard output, BLZ lookup, and the release-notes invariants
(newest-first, no duplicate versions, `CURRENT_VERSION` in sync with
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
- `APP_SECRET_PREV`. Optional. Previous APP_SECRET(s), comma-separated, kept in
  the keyring during a rotation so existing encrypted rows stay readable.
  Rotation: set this to the current secret, generate a new `APP_SECRET`, deploy,
  run Einstellungen > Verschlüsselung > Re-encrypt, then unset.
- `BETTER_AUTH_URL`. Public URL of the deployment.
- `SVUWV_BOOTSTRAP_ADMIN_EMAIL`, `SVUWV_BOOTSTRAP_ADMIN_PASSWORD`. Optional, only
  used on the very first boot. If unset, the first request is redirected to
  `/setup` where a first admin can be created interactively.

`railway.toml` runs `bun run db:migrate:prod` before each deploy and points the
healthcheck at `/api/health`. Migrations are applied with a runtime-only
migrator. `drizzle-kit` stays a dev dependency and does not ship in the runtime
image.

The nightly snapshot scheduler runs in-process by default. To move it to an
external scheduler (Railway Cron, GitHub Actions, etc.), set
`SNAPSHOT_CRON_DISABLED=1` and hit `POST /api/cron/snapshots` with the same HMAC
headers used for SVUMS push.

## Environment

See [`.env.example`](.env.example).

## SVUMS push contract

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
