# Repository guidance

`AGENTS.md` is the canonical instruction file for Kontor2. Claude Code loads it
through `CLAUDE.md`. These repository-specific rules supplement the agent's
general working guidance. Read them before changing code.

## What this is

Vereinsverwaltung for SV Untereuerheim. It mirrors a legacy "Linear Webverein"
database (the `adresse` table has 200+ columns) and adds member management,
SEPA direct debit (pain.008), a dunning workflow (Mahnwesen), a member portal
with magic-link login, DSGVO tooling, reports, and snapshots.

Stack in one line: TanStack Start (Vite) + React 19, oRPC procedures, Drizzle
on Postgres, better-auth, Tailwind v4 + shadcn-style components, Bun. Deployed
on Railway via Dockerfile.

## Layout you actually need

- `src/routes/` -- file-based routes. `app/` is the authed app, `routeTree.gen.ts`
  is generated (never edit; run `bun run routes:regen`).
- `src/server/orpc/procedures/` -- all API logic, one file per domain. Auth is
  enforced per-procedure with `authedProc` / `vorstandProc` / `adminProc`, not
  by route guards.
- `src/server/db/schema/` -- Drizzle tables. Columns are snake_case mirroring
  Linear; exported table objects are camelCase. Secrets (IBANs, SMTP password)
  use the `encryptedText` type (`src/server/db/types.ts`) which encrypts on
  write and decrypts on read transparently, so a selected row already holds
  plaintext.
- `src/server/pdf/` -- `@react-pdf/renderer` documents (Mahnung, DSGVO-Auskunft,
  Bestandserhebung) and the `renderer.ts` wrapper.
- `src/components/forms/` -- the big member editing surface.
- `src/server/importer/` vs `src/server/archive/` -- two separate paths for the
  same Linear `.sql` dump. The importer normalises a few known tables into the
  live domain schema. The archive (`sql-analyzer.ts` + `ingest-archive.ts`,
  procedures in `procedures/archive.ts`, tables `linear_archive_*`) ingests the
  WHOLE dump generically and versioned, isolated from live data, for search and
  reverse-engineering. Both reuse the tokenizer's `parseValues`. Archive analysis
  is also exposed as `archive_*` MCP tools; archive upload is admin-only.

## Domain notes that save time

- The standalone svums app is retired. Membership entry is native only:
  `/antrag` (public), `/app/antraege` (review), approval onboards the member.
  The `svums_push` values in the `audit_source` and `import_source` enums are
  kept for historical rows; nothing writes them and no code should read them
  as an active path.
- A "member" row can be a real member (`mitglnr` set) or a legacy payer/contact
  with only an `adrNr`. Code paths fall back from `mitglnr` to `adrNr`.
- Money is summed in integer cents (`sumDecimal`) to avoid float drift. Keep it
  that way.
- Soft-delete is two flags: legacy `geloscht` and the app's `deletedAt`. Both
  must be excluded from dunning, reports, and Bestandserhebung.
- Dunning escalates per Sollstellung via `mahnstufe` (0 = not yet dunned). A run
  at level N targets postings currently at N-1. `mahnSperre` blocks a member.
- Austritt has two entry points, both writing the same cascade through
  `executeAustritt` (`src/server/domain/austritt.ts`): `cancellations.record`
  is the evidence-backed Kündigung (scan of the Austrittserklärung, receipt row
  in `member_cancellations`), `members.austritt` is the quick administrative
  entry (death, backdated correction). Never duplicate the cascade; extend the
  shared function.
- The Austrittstermin is derived, not typed: `computeCancellationDate`
  (`src/server/lib/cancellation-frist.ts`) counts the Kündigungsfrist from the
  day the written notice arrived, then rounds forward to the configured period
  end. Counting from "today" would silently push a letter recorded late into
  the next period. A deviating date is allowed but needs a reason and is
  recorded as `overridden`.
- The cancellation rule is tenant configuration, never hardcoded. SV
  Untereuerheim, § 3 Abs. 2: Kündigungsfrist aktiv, 42 Tage, Zulässiger
  Austrittstermin "Nur zum Jahresende". `tenantPolicy.cancellationDateMode`
  applies on its own; the legacy `kuendigungZumMonatsende` boolean only while
  `kuendigungsfristAktiv` is on, matching how the settings form nests it.
- Workflow evidence uploads (`attachment_kind` other than `general`) are
  validated against their magic bytes, referenced by an append-only receipt
  row, undeletable as a normal attachment and hidden from readonly users. Add
  a new kind to `EVIDENCE_ATTACHMENT_KINDS` and the rest follows.
- The public Beitritts-Antrag (`src/routes/antrag/index.tsx`) must not shift
  while typing. Build its inputs with `Field` from
  `src/components/antrag/field.tsx` (reserved helper line, validity shown as a
  green or red border via `data-field-state`, never an icon next to the label)
  and wrap anything that appears mid-form in `Reveal` (animated height; pass
  the negative gap margin as `collapsedClassName` inside `gap` containers).
  Street suggestions are a real combobox (`address-fields.tsx`) whose pure
  keyboard and highlight helpers live in `src/lib/antrag-combobox.ts`.
- Direct-debit detection: a blank `lastschrift` counts as direct debit (that is
  how Linear stored it); only `aufRechnung = 'J'` is a true invoice payer.
- Member notifications have two equal channels, not a channel and a fallback:
  `canReachByEmail` decides, and `notify-by-post.ts` renders the same
  `MailBlock[]` into a DIN 5008 letter (`templates/mitteilung.tsx`). Both land
  in `email_log`, distinguished by `channel`; a letter is `printed`, never
  `sent`, because posting it stays a human act. A workflow with its own letter
  (the Austrittsbestätigung) keeps it and records that letter as its postal
  channel instead of generating a second one.
- Manual letters (`letters.create`, `BriefDialog`) accept per-letter sender,
  function, contact, return-address, date and signature-space overrides through
  `manualLetterOptionsSchema`. These never update organization settings.
  `notifyByPost` preserves the resolved details in the postal history. A null
  closing suppresses the entire signature block, including personal details.
- `email_log.status = sent` only means the MTA accepted the message. A bounce
  arrives asynchronously in the configured mailbox; `emailLog.scanBounces` reads
  those DSNs (RFC 3464, parsed in `src/server/mail/dsn.ts`), flips the row to
  `bounced` and, for a permanent 5.x.x failure, stamps
  `members.emailUndeliverableAt` and raises a Wiedervorlage. Matching prefers
  the stored `messageId`; the recipient plus time window is a bounded fallback.
  A changed address clears the flag.

## Commands

- `bun run verify` -- typecheck + biome ci + tests + build. Run before pushing.
- `bun run test` runs Vitest. Unit tests live in `tests/` (mirroring `src/`);
  the config only globs `tests/**`, so a test placed next to its source under
  `src/` will NOT run in CI. Put unit tests in `tests/`.
- `bun run test:int` -- integration tests against a real Postgres + Redis.
  Needs Docker: brings up `docker-compose.test.yml` (tmpfs, ports 5433/6380),
  applies migrations, runs `tests/integration/**` with the test env wired in
  (`scripts/test-db.ts`). `test:db:up` / `test:db:down` manage the stack by
  hand. Integration tests are excluded from the fast suite and self-skip unless
  `DATABASE_URL` points at `svuwv_test`; CI runs them as a separate job with
  service containers.
- `bun run test:browser` runs isolated shared-UI regressions in Chromium without
  a database or app server. Install the browser with `bunx playwright install chromium`.
  Modal focus setup belongs in `useModalFocus`; inline callbacks and loading
  updates must not restart initial focus or restore focus while the dialog is open.
- `bun run typecheck`, `bun run check` (biome autofix).
- `bun run db:generate` -- generate a migration from schema changes. Commit the
  SQL file; never hand-edit generated migrations. `db:migrate` applies them.
- `bun run routes:regen` -- regenerate the route tree after adding routes.

## Version release protocol (do not skip)

This app ships its own in-app changelog. The single source of truth is
`src/lib/release-notes.ts`; the sidebar chip, the login/setup footer, and the
"Versionshinweise" dialog all read from it, and `CURRENT_VERSION` is derived
from `RELEASES[0].version`.

If your change is observable by a user, in the SAME PR you must:

1. Add an entry to the TOP of `RELEASES` (newest first), or add a `change` to
   the current top entry if it is still unreleased. Write `description` in
   German UI tone: short, direct, no marketing words, no em-dashes or en-dashes.
2. Bump the version with semver: `patch` for fixes, `minor` for non-breaking
   features, `major` for anything needing operator action (env, migration,
   re-import).
3. Keep `package.json` `version` equal to `RELEASES[0].version`. They must match.

Pure internal refactors may fold into a `patch` entry with category `internal`,
but the version should still move so the change stays traceable. Do not let a
feature PR merge without a release entry. That is the mistake that left the
changelog stuck at 0.4.0 while many features shipped.

## House style reminders (from the global file, worth repeating)

- No em-dashes or en-dashes anywhere in UI copy. Use a period or two sentences.
- Empty/unknown values in display contexts render as the `EMPTY_VALUE` glyph
  (`—`) from `~/lib/format` (the one deliberate dash exception). Never use
  `k.A.`, `-`, `?`, `n/a`, or a blank string for a rendered missing value. Use
  `orEmpty()` for plain strings. Form input defaults (`?? ""`) are fine; this
  rule is about rendered output.
- Use the typographic ellipsis `…`, not three dots `...`, in UI copy.
- Icons via `lucide-react`, never emojis.
- Icon-only buttons need an `aria-label` (a `title` tooltip is not an
  accessible name).
- German UI copy: short, direct, human. No "leverage", "seamless", "robust".
- Mail copy has two audiences and must address the right one. Member-facing
  mail (Bankbestätigung, Portal, Antrag, Mahnung, Rundschreiben) is the club
  writing to a person: never call the admin system "Ihre Vereinsverwaltung"
  there, and name the topic in the `subline` ("Bankverbindung", "Offene
  Beiträge"). Verwaltungs-facing mail (Benutzer-Einladung, Passwort-Reset,
  Test-Mail) may talk about the Vereinsverwaltung, because the recipient works
  in it. A notice the club sends to itself passes `closing: null` so it does
  not sign off to itself.
- Errors from procedures use `ORPCError` with uppercase codes, never plain
  `Error`.

## Maintaining this file

Update this file when verified repository behavior changes. Keep it concise and
move detailed explanations to `docs/`. Keep `CLAUDE.md` as the compatibility
import unless Claude-specific guidance is genuinely required.
