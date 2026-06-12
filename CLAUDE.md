# CLAUDE.md (repo)

Orientation for working in this repo. The full stack and style guide lives in
the user-level `CLAUDE.md`; this file is the Kontor2-specific layer plus the few
things that are easy to miss. Read it before you start.

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

## Domain notes that save time

- A "member" row can be a real member (`mitglnr` set) or a legacy payer/contact
  with only an `adrNr`. Code paths fall back from `mitglnr` to `adrNr`.
- Money is summed in integer cents (`sumDecimal`) to avoid float drift. Keep it
  that way.
- Soft-delete is two flags: legacy `geloscht` and the app's `deletedAt`. Both
  must be excluded from dunning, reports, and Bestandserhebung.
- Dunning escalates per Sollstellung via `mahnstufe` (0 = not yet dunned). A run
  at level N targets postings currently at N-1. `mahnSperre` blocks a member.
- Direct-debit detection: a blank `lastschrift` counts as direct debit (that is
  how Linear stored it); only `aufRechnung = 'J'` is a true invoice payer.

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
- Errors from procedures use `ORPCError` with uppercase codes, never plain
  `Error`.
