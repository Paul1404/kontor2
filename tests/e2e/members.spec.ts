import { createMember, expect, gotoMembersList, test } from "./fixtures";

// `appPage` is signed in and on /app. We reach every screen by clicking
// (client-side navigation), never by hard-loading a protected URL, because the
// dev server's SSR path does not carry the session on a full load.

test.describe("members", () => {
  test("sorts and selects rows through the members table", async ({ appPage }) => {
    await createMember(appPage, { vorname: "Tanja", nachname: "Tabellentest" });
    await gotoMembersList(appPage);
    await appPage.getByRole("button", { name: /Gesamt/ }).click();

    const nameHeader = appPage.getByRole("button", { name: "Name" });
    await nameHeader.click();
    await expect(appPage).toHaveURL(/sortBy=nachname/);
    await expect(appPage).toHaveURL(/sortDir=desc/);

    const firstRowCheckbox = appPage.locator("tbody input[type=checkbox]").first();
    await firstRowCheckbox.check();
    await expect(firstRowCheckbox).toBeChecked();
    await expect(appPage.getByText("1 ausgewählt", { exact: true })).toBeVisible();
  });

  test("adds a new member through the wizard", async ({ appPage }) => {
    await createMember(appPage, { vorname: "Max", nachname: "Neumitglied" });

    // Landed on the new member's detail page with the confirmation toast, the
    // name in the header, and a status badge (Passiv: no active Abteilung yet).
    // The badge is a regression check: it used to be hidden for in-app members.
    await expect(appPage.getByText("Mitglied angelegt.")).toBeVisible();
    await expect(appPage.getByRole("heading", { level: 1 })).toContainText("Max Neumitglied");
    await expect(appPage.getByText("Passiv", { exact: true })).toBeVisible();
  });

  test("cancels a member (Austritt)", async ({ appPage }) => {
    // A member created in-app carries only an app-owned member number. The
    // Austritt action must still be offered for it (regression: it used to be
    // gated on the legacy Mitgliedsnummer, so in-app members could never leave).
    await createMember(appPage, { vorname: "Erika", nachname: "Austrittstest" });

    await appPage.getByRole("button", { name: "Austritt", exact: true }).click();

    // Confirm dialog: the Austrittsdatum defaults to today, so just confirm.
    const dialog = appPage.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Mitglied austreten lassen" })).toBeVisible();
    await dialog.getByRole("button", { name: "Austritt eintragen" }).click();

    // Success: the toast fires and the action flips to "Austritt rückgängig"
    // once the member reloads as cancelled (a durable post-condition).
    await expect(appPage.getByText("Austritt eingetragen")).toBeVisible();
    await expect(appPage.getByRole("button", { name: "Austritt rückgängig" })).toBeVisible();
  });
});
