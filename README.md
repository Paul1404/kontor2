# SVUWV

Vereinsverwaltung for SV 1945 Untereuerheim e.V. Replaces the legacy "Linear
Webverein" desktop software. Internal admin tool, German UI.

## What it does

### Members
- Lossless mirror of the Linear `adresse` schema. All 247 columns map onto
  the `members` table without truncation. Linear's `bit(1)` flags become
  proper booleans. The single-letter status codes (`A`, `P`, `N`) stay as
  text because that's what they actually are.
- IBANs are AES-256-GCM encrypted at rest. Clients only ever see the last
  four digits.
- Full CRUD with edit, create, soft-delete and undelete.
- Many-to-many Abteilungen with per-Abteilung Eintritts- and Austrittsdaten.
- Verknüpfungen (Familienbeziehungen) imported from Linear and editable in the
  UI.
- Per-member file attachments via S3. Signed URLs, PDF/PNG/JPEG only, 10 MB
  cap.
- vCard 3.0 export per member. Works with iOS Contacts and macOS Contacts
  without complaints.
- Clickable phone, email and address fields. `tel:`, `mailto:`, maps link.

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

### Reports (Berichte)
- Geburtstagsliste with month and runden Geburtstag filters.
- Ehrungen (10/25/40/50/60/70 Jahre Mitgliedschaft) with year selector.
- Abteilungs-Statistik. Mitglieder je Abteilung, Altersverteilung, Geschlecht.
- Finanzbericht. Sollstellungen aggregated by Beitragsart.
- Every report exports to CSV and has a print-friendly view.

### Import and ingest
- Linear Webverein `mysqldump` upload. Up to 50 MB. Parses the dump in
  process, splits multi-row inserts, decodes MySQL escapes.
- SVUMS push compatibility. `POST /api/ingest/svums` accepts the same record
  shape (`AdrNr`, `MITGLNR`, `Anrede`, etc.) so the mapper is shared between
  SQL upload and JSON push.
- Both paths write through the same ingest pipeline. Diffs land in the audit
  log and trigger a pre-import snapshot.

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
- Three roles: Admin, Vorstand, Readonly. Every protected oRPC procedure
  checks role server-side. Route guards alone are not trusted.
- First-run bootstrap admin from `SVUWV_BOOTSTRAP_ADMIN_EMAIL` and
  `SVUWV_BOOTSTRAP_ADMIN_PASSWORD` when the user table is empty.
- SMTP settings configurable from the admin UI. SNI hostname is sent and
  there's a toggle to skip cert verification for in-house MTAs with self-signed
  certs.

### Admin
- CRUD for Abteilungen, Beitragsarten, Benutzer, SMTP, Vereinsdaten.
- Snapshot run history with bytes, member counts and trigger reason.

### Dashboard
- Mitgliederzahl, Neue und Austritte im Monat, Mitglieder je Abteilung.

### UI niceties
- Command palette (`⌘K` or `Ctrl K`). Searches members live with a Redis-backed
  cache.
- Keyboard shortcuts. `?` opens the cheatsheet. `g d`, `g m`, `g a`, `g b`,
  `g s` for navigation. `n` for new member, `e` to edit.
- Sortable member list with column state synced into the URL. Pasting a link
  reproduces the exact view.
- Light and dark theme.
- SV Untereuerheim crest as favicon. Full icon set (SVG, ICO, PNG variants,
  apple-touch, web manifest).

## Stack

TanStack Start (Vite), TanStack Router, TanStack Query, TanStack Form,
oRPC v1, better-auth, Drizzle ORM, Valibot, PostgreSQL, Redis, S3, Bun,
Tailwind v4, shadcn-style components, lucide-react, Vitest, Biome.

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

Covers the SQL importer, ingest HMAC, SEPA mandate selection, pain.008
output, IBAN normalisation, snapshot diff and restore, audit diffing,
report calculations, vCard output and BLZ lookup.

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
  Rotating it re-keys everything, including the SVUMS push secret, so the
  SVUMS side has to be updated too. See `bun scripts/print-derived-secrets.ts`.
- `BETTER_AUTH_URL`. Public URL of the deployment.
- `SVUWV_BOOTSTRAP_ADMIN_EMAIL`, `SVUWV_BOOTSTRAP_ADMIN_PASSWORD`. Optional,
  only used on the very first boot.

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
