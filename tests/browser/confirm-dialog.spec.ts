import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

let directory: string;
let bundle: string;
test.beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), "kontor-dialog-"));
  execFileSync("bun", [
    "build",
    "tests/browser/confirm-dialog.fixture.tsx",
    "--target=browser",
    "--outdir",
    directory,
  ]);
  bundle = readFileSync(join(directory, "confirm-dialog.fixture.js"), "utf8");
});
test.afterAll(() => {
  if (directory) rmSync(directory, { recursive: true });
});
test.beforeEach(async ({ page }) => {
  await page.route("http://dialog.test/**", (route) =>
    route.fulfill(
      route.request().url().endsWith("fixture.js")
        ? { contentType: "text/javascript", body: bundle }
        : {
            contentType: "text/html",
            body: '<meta charset="utf-8"><div id="root"></div><script src="/fixture.js"></script>',
          },
    ),
  );
  await page.goto("http://dialog.test/");
  await page.getByRole("button", { name: "Brief schreiben" }).click();
  await expect(page.getByRole("button", { name: "Abbrechen" })).toBeFocused();
});

test("typing, spaces and Enter preserve field focus and the open draft", async ({ page }) => {
  const name = page.getByLabel("Absender");
  await name.click();
  await name.pressSequentially("Paul Dresch", { delay: 30 });
  await expect(name).toHaveValue("Paul Dresch");
  await expect(name).toBeFocused();
  await name.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  const body = page.getByLabel("Brieftext");
  await body.click();
  await body.pressSequentially("Guten Tag", { delay: 30 });
  await body.press("Enter");
  await body.pressSequentially("vielen Dank", { delay: 30 });
  await expect(body).toHaveValue("Guten Tag\nvielen Dank");
  await expect(body).toBeFocused();
  await body.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("output")).toHaveText("Paul Dresch");
  await expect(page.getByRole("button", { name: "Brief schreiben" })).toBeFocused();
});

test("loading changes do not reset focus and Escape uses the latest state", async ({ page }) => {
  const name = page.getByLabel("Absender");
  await name.click();
  // Simulate an asynchronous parent update without moving browser focus.
  await page
    .getByRole("button", { name: "Ladestatus wechseln" })
    .evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.getByRole("button", { name: "Abbrechen" })).toBeDisabled();
  await expect(name).toBeFocused();
  await name.press("Escape");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page
    .getByRole("button", { name: "Ladestatus wechseln" })
    .evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.getByRole("button", { name: "Abbrechen" })).toBeEnabled();
  await expect(name).toBeFocused();
  await page.getByRole("button", { name: "Bestätigen", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Schließen", exact: true })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("button", { name: "Bestätigen", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
