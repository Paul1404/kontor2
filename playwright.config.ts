import { defineConfig, devices } from "@playwright/test";
import { E2E_BASE_URL, E2E_PORT } from "./tests/e2e/fixtures";

/**
 * Browser end-to-end tests. Run via `bun run test:e2e`, which brings up the
 * throwaway Postgres + Redis (docker-compose.test.yml), applies migrations, and
 * wires the test env before invoking Playwright (see scripts/test-db.ts). This
 * config then boots the app as a dev server on a dedicated port and drives it
 * in a real browser.
 *
 * Requires Docker (for the stack) and the Playwright browser binaries, which
 * are installed on demand by the `test:e2e` script.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  // Specs are `*.spec.ts`; Vitest only globs `*.test.ts`, so the two suites
  // never pick up each other's files.
  testMatch: /.*\.spec\.ts$/,
  // One shared database, one app instance: keep it serial and predictable.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "list" : [["list"], ["html", { open: "never" }]],
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: E2E_BASE_URL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `bunx vite dev --port ${E2E_PORT}`,
    url: E2E_BASE_URL,
    // Inherits DATABASE_URL / REDIS_URL / APP_SECRET etc. from the test env the
    // `test:e2e` script sets. We only pin the port and the auth base URL to it,
    // so better-auth trusts the same-origin sign-in request.
    env: {
      PORT: String(E2E_PORT),
      BETTER_AUTH_URL: E2E_BASE_URL,
    },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
