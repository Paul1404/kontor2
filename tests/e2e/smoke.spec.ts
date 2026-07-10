import { expect, test } from "./fixtures";

// `appPage` logs in through the form and hands back a page already on /app, so
// these start inside the authenticated shell and then navigate by clicking
// (client-side), the way a user does.

test.describe("app shell", () => {
  test("shows the nav and sign-out control when signed in", async ({ appPage }) => {
    await expect(appPage).toHaveURL(/\/app/);
    await expect(appPage.getByRole("link", { name: "Mitglieder" })).toBeVisible();
    await expect(appPage.getByRole("button", { name: "Abmelden" })).toBeVisible();
  });

  test("navigates to the Mitglieder list via the sidebar", async ({ appPage }) => {
    await appPage.getByRole("link", { name: "Mitglieder" }).click();
    await expect(appPage).toHaveURL(/\/app\/mitglieder/);
  });

  test("signs out back to the login page", async ({ appPage }) => {
    await appPage.getByRole("button", { name: "Abmelden" }).click();
    await expect(appPage).toHaveURL(/\/login/);
  });
});

test.describe("auth gate", () => {
  // A signed-out visitor must never render the app; the gate bounces to /login.
  test("redirects unauthenticated visitors from /app to /login", async ({ page }) => {
    await page.goto("/app");
    await expect(page).toHaveURL(/\/login/);
  });
});
