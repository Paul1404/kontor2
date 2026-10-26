import { createMember, expect, gotoMembersList, test } from "./fixtures";

test("member defaults, contact correction and shared navigation work on desktop and mobile", async ({
  appPage: page,
}) => {
  await gotoMembersList(page);
  await expect(
    page.locator("select").filter({ has: page.locator('option[value="aktuell"]') }),
  ).toHaveValue("aktuell");
  await createMember(page, { vorname: "Demo", nachname: `Kontaktkorrektur${Date.now()}` });
  await page.getByRole("button", { name: "In Kontakt umwandeln", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/Neue Kontaktnummer: K-/)).toBeVisible();
  await dialog.getByLabel("Grund der Korrektur").fill("Demo: versehentlich als Mitglied angelegt");
  await dialog.getByRole("button", { name: "In Kontakt umwandeln", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/mitglieder\/K-/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Befehlspalette öffnen", exact: true }).click();
  await expect(page.getByText("Datenqualität", { exact: true }).last()).toBeVisible();
  await page.keyboard.press("Escape");
  await page.locator("summary").filter({ hasText: "Verwaltung" }).click();
  await page.getByRole("link", { name: "Vereinsdaten", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Geburtstagserinnerung", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Test an mich senden" })).toBeVisible();
  await page.screenshot({ path: "/tmp/kontor-svun-settings-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Test an mich senden" })).toBeVisible();
  const widths = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client);
  await page.screenshot({ path: "/tmp/kontor-svun-settings-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "Menü öffnen", exact: true }).click();
  await expect(page.getByRole("link", { name: "Familien", exact: true })).toBeVisible();
  await page.screenshot({ path: "/tmp/kontor-svun-navigation-mobile.png" });
  await page
    .getByRole("dialog", { name: "Hauptmenü" })
    .getByRole("button", { name: "Menü schließen", exact: true })
    .click();
});
