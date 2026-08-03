import { E2E_ADMIN, expect, login, test } from "./fixtures";

// Signed-out flows: each test starts with a fresh context (no session), so we
// use the plain `page` fixture and drive the form directly.

test.describe("login", () => {
  test("shows field validation after leaving required inputs empty", async ({ page }) => {
    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    await page.locator("#email").focus();
    await page.locator("#password").focus();
    await page.locator("#email").focus();

    await expect(page.getByText("Bitte geben Sie Ihre E-Mail-Adresse ein.")).toBeVisible();
    await expect(page.getByText("Bitte geben Sie Ihr Passwort ein.")).toBeVisible();
  });

  test("rejects wrong credentials and stays on /login", async ({ page }) => {
    await page.goto("/login");
    await page.fill("#email", E2E_ADMIN.email);
    await page.fill("#password", "definitely-not-the-password");
    await page.getByRole("button", { name: "Anmelden" }).click();

    await expect(page.getByText(/fehlgeschlagen|ungültig|invalid/i)).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("signs in with valid credentials and reaches the app", async ({ page }) => {
    await login(page);
    await expect(page).toHaveURL(/\/app/);
    await expect(page.getByRole("button", { name: "Abmelden" })).toBeVisible();
  });
});
