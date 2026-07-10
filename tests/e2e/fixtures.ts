import { test as base, expect, type Page } from "@playwright/test";

/**
 * Shared constants, the `appPage` login fixture, and page helpers for the
 * browser end-to-end suite.
 *
 * The app under test boots against the throwaway integration stack (see
 * `scripts/test-db.ts`), served by Playwright's `webServer` on a dedicated port
 * so it never collides with a local `bun run dev` on 3000. On `localhost` the
 * tenant resolves to the primary Verein and `/setup` is reachable, which is how
 * `global-setup.ts` seeds the first admin before any test runs.
 *
 * Auth note: we log in through the real form and then move around by clicking,
 * rather than restoring a `storageState` cookie and hard-loading `/app`. Under
 * the dev server a full-page load of a protected route runs `beforeLoad` on the
 * server, and that SSR path does not forward the session cookie to the loopback
 * `auth.me` call (it relies on the request-context plumbing of the built
 * server), so it always bounces to `/login`. Client-side navigation after a
 * form login uses the browser cookie jar and works, which is also how a real
 * user reaches the app.
 */

export { expect };

/** Dedicated e2e port (not 3000, so a running dev server is left alone). */
export const E2E_PORT = 3100;
export const E2E_BASE_URL = `http://localhost:${E2E_PORT}`;

/** The admin seeded once by global setup. Password is >= 12 chars to satisfy
 * better-auth's `minPasswordLength`. These are throwaway test credentials. */
export const E2E_ADMIN = {
  name: "E2E Admin",
  email: "e2e-admin@example.test",
  password: "e2e-admin-password",
} as const;

/** Open the members list from anywhere in the authed app via the sidebar
 * (client-side navigation, which carries the session under the dev server). */
export async function gotoMembersList(page: Page): Promise<void> {
  await page.getByRole("link", { name: "Mitglieder" }).click();
  // The list route appends default search params, so wait on a stable element
  // (the search box) rather than an exact URL match.
  await page.getByPlaceholder("Name, Mitgliedsnummer, E-Mail, Ort").waitFor();
}

/**
 * Create a member through the "Neues Mitglied" wizard and land on its detail
 * page. Only Vorname + Nachname are required; step 1 advances with "Weiter" and
 * step 2 (Vereinsdaten) needs nothing, so we create straight away.
 */
export async function createMember(
  page: Page,
  member: { vorname: string; nachname: string },
): Promise<void> {
  await gotoMembersList(page);
  await page.getByRole("link", { name: "Neues Mitglied" }).click();
  await page.getByLabel("Vorname", { exact: true }).fill(member.vorname);
  await page.locator("#mf-nachname").fill(member.nachname);
  await page.getByRole("button", { name: "Weiter" }).click();
  await page.getByRole("button", { name: "Mitglied anlegen" }).click();
  // Lands on the new member's detail page (a member-number segment, not /neu).
  await page.waitForURL(/\/app\/mitglieder\/(?!neu$)[^/]+$/);
}

/** Fill the login form and wait until the app shell is reached. Assumes the
 * admin already exists (seeded by global setup). The post-login navigation is
 * client-side, so the session cookie carries and the shell renders. */
export async function login(page: Page): Promise<void> {
  await page.goto("/login");
  // Wait for the client to hydrate before interacting: on the first hit the dev
  // server compiles on demand, and a click that lands before React wires the
  // form's onSubmit is silently lost. The setupStatus query only fires after
  // hydration, so networkidle is a reliable "interactive" signal here.
  await page.waitForLoadState("networkidle");
  await page.fill("#email", E2E_ADMIN.email);
  await page.fill("#password", E2E_ADMIN.password);
  await page.getByRole("button", { name: "Anmelden" }).click();
  await page.waitForURL("**/app");
}

/**
 * Bring the Verein to a logged-in state from whatever state the database is in.
 * On a fresh database `/setup` shows the first-admin form (users table empty);
 * once seeded it reports "already initialized" and we fall back to the login
 * form. Either way the page ends up on `/app`. Used by global setup to make
 * sure the admin exists before the suite runs.
 */
export async function ensureAdmin(page: Page): Promise<void> {
  await page.goto("/setup");
  // Let the setupStatus query settle so the form (or the "already done" panel)
  // is rendered before we probe for it.
  await page.waitForLoadState("networkidle");

  const needsSetup = (await page.locator("#name").count()) > 0;
  if (needsSetup) {
    await page.fill("#name", E2E_ADMIN.name);
    await page.fill("#email", E2E_ADMIN.email);
    await page.fill("#password", E2E_ADMIN.password);
    await page.fill("#password-confirm", E2E_ADMIN.password);
    await page.getByRole("button", { name: "Admin-Konto anlegen" }).click();
    await page.waitForURL("**/app");
    return;
  }

  await login(page);
}

/**
 * Test fixtures. Use `page` for signed-out flows (the login specs). Use
 * `appPage` for anything that needs to start inside the authenticated app: it
 * logs in through the form and hands back a page already on `/app`.
 */
export const test = base.extend<{ appPage: Page }>({
  appPage: async ({ page }, use) => {
    await login(page);
    await use(page);
  },
});
