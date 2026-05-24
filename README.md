# SVUWV — SV Untereuerheim Webverein

Vereinsverwaltung für SV 1945 Untereuerheim e.V. Replacement for the legacy
"Linear Webverein" desktop software. Internal admin tool, German UI.

## What it does

- Member management (lossless mirror of the Linear Webverein `adresse` schema).
- Many-to-many Abteilungen with per-Abteilung Eintritts/Austrittsdaten.
- Linear Webverein SQL dump import (mysqldump format, up to 50 MB).
- SVUMS push compatibility (HMAC-signed JSON ingestion).
- Beitragsarten, Verträge, SEPA-Mandate (read-only this session).
- Per-Member file attachments via S3 (signed URLs, PDF/PNG/JPEG, max 10 MB).
- Audit log for every member change (UI, import, SVUMS push).
- Role-based access: Admin / Vorstand / Readonly. Invite-only signup.
- Dashboard with Mitgliederzahl, Neue/Austritte im Monat, Mitglieder je Abteilung.

## Stack

TanStack Start, oRPC, better-auth, Drizzle ORM, PostgreSQL, Redis, S3, Bun,
Tailwind v4 + shadcn-style components, lucide-react, Vitest, Biome.

## Run locally

```bash
bun install
cp .env.example .env   # fill in real values, generate secrets with openssl rand -hex 32
docker run -d --name pg -p 5432:5432 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=svuwv postgres:16
docker run -d --name redis -p 6379:6379 redis:7
bun run db:generate
bun run db:migrate
bun run dev
```

Then open <http://localhost:3000>.

First-run admin is bootstrapped from `SVUWV_BOOTSTRAP_ADMIN_EMAIL` and
`SVUWV_BOOTSTRAP_ADMIN_PASSWORD` if no users exist yet.

## Deploy

Railway via the included `Dockerfile`. Required Railway services:

- **Postgres** — `${{Postgres.DATABASE_URL}}` referenced as `DATABASE_URL`.
- **Redis** — `${{Redis.REDIS_URL}}` referenced as `REDIS_URL`.
- **Bucket (S3 Generic)** — wire all `AWS_*` variables from `${{Bucket.*}}`.

Manually set:

- `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`
- `DATA_ENCRYPTION_KEY` (32-byte hex; encrypts IBAN and SMTP password at rest)
- `SVUMS_PUSH_SECRET` (32-byte hex; shared with SVUMS for HMAC push)

`railway.toml` runs `bun run db:migrate:prod` before each deploy and hits
`/api/health` for healthchecks.

## Environment

See [`.env.example`](.env.example) for the full key list.

## SVUMS push contract

`POST /api/ingest/svums` with JSON body. Headers:

- `X-SVUMS-Timestamp: <unix-seconds>`
- `X-SVUMS-Signature: hex(HMAC_SHA256(SVUMS_PUSH_SECRET, timestamp + "." + raw_body))`

Body keys: `batch`, `members`, `feeTypes`, `contracts`, `sepaMandates`. Each
member record uses the raw Linear column names (`AdrNr`, `MITGLNR`, `Anrede`,
…) so the same mapper handles both SQL upload and JSON push.

Replay protection: signatures are nonce-deduplicated in Redis for 10 minutes.

## Linear schema coverage

Every column of the Linear `adresse` table (247 columns) is mapped lossless
into `members`. Linear `bit(1)` flags become `boolean`; all `char(1)` columns
stay as text because their values are single-letter codes (`'A'`/`'P'`/`'N'`)
rather than strict booleans. IBAN columns are AES-256-GCM encrypted at rest;
only a `last4` mirror is returned to clients.

## License

MIT.
