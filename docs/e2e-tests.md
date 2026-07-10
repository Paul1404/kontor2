# Browser end-to-end tests (Playwright)

Real-browser smoke tests for the most basic flows: signing in, the app's auth
gate, and navigating the shell. They complement the unit suite (`tests/`) and
the DB integration suite (`tests/integration/`), which never open a browser.

## Run them

```bash
bun run test:e2e        # headless
bun run test:e2e:ui     # Playwright UI mode (watch/inspect)
```

Requires **Docker** (same as `bun run test:int`). The script:

1. installs the Chromium binary if missing,
2. brings up the throwaway Postgres + Redis (`docker-compose.test.yml`, tmpfs)
   and applies migrations, via `scripts/test-db.ts`,
3. runs Playwright, which boots the app as a dev server on port **3100** (not
   3000, so a running `bun run dev` is left alone) and drives it.

## How it fits together

- `playwright.config.ts` owns the `webServer` (boots `vite dev` on 3100).
- `tests/e2e/global-setup.ts` runs once: it opens `/setup` on the fresh test
  database to create the first admin (the `/setup` route is only reachable while
  the users table is empty). Specs create whatever member data they need through
  the UI, so nothing else is seeded.
- `tests/e2e/fixtures.ts` holds the shared constants (port, base URL, throwaway
  admin), the `login` / `gotoMembersList` / `createMember` helpers, and the
  `appPage` fixture.
- Specs are `*.spec.ts`. Vitest only globs `*.test.ts`, so the two runners never
  pick up each other's files.

On `localhost` the tenant resolves to the primary Verein and rate limiting is
off (it is production-only), so the sign-in form works without any seeding
beyond the first admin.

## Auth: log in through the form, then click

Tests reach the app by signing in through the real login form and then
navigating with link clicks, not by restoring a cookie and hard-loading `/app`.
Under the **dev server** a full-page load of a protected route runs `beforeLoad`
on the server, and that SSR path does not forward the session cookie to the
loopback `auth.me` call (it depends on the built server's request-context
plumbing), so it always bounces to `/login`. Client-side navigation after a form
login uses the browser cookie jar and works, which is also how a real user gets
in. If these tests are ever pointed at the built server (`build` + `start`),
`storageState` and direct `goto('/app')` become viable.

## Add a test

Put a `*.spec.ts` file in `tests/e2e/` and import `test` / `expect` from
`./fixtures`. Use the `appPage` fixture for anything inside the authenticated
app (it logs in and hands back a page already on `/app`); use the plain `page`
fixture for signed-out flows:

```ts
import { expect, test } from "./fixtures";

test("does a thing in the app", async ({ appPage }) => {
  await appPage.getByRole("link", { name: "Mitglieder" }).click();
  await expect(appPage).toHaveURL(/\/app\/mitglieder/);
});
```

## Not wired into CI yet

This is a local harness for now. A CI job would add service containers,
`playwright install --with-deps chromium`, and run `bun run test:e2e`.
