import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

let directory: string;
let bundle: string;
test.beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), "kontor-person-links-"));
  execFileSync("bun", [
    "build",
    "tests/browser/application-person-links.fixture.tsx",
    "--target=browser",
    "--outdir",
    directory,
  ]);
  bundle = readFileSync(join(directory, "application-person-links.fixture.js"), "utf8");
});
test.afterAll(() => {
  if (directory) rmSync(directory, { recursive: true });
});
test.beforeEach(async ({ page }) => {
  await page.route("http://person-links.test/**", (route) =>
    route.fulfill(
      route.request().url().endsWith("fixture.js")
        ? { contentType: "text/javascript", body: bundle }
        : {
            contentType: "text/html",
            body: '<meta charset="utf-8"><div id="root"></div><script src="/fixture.js"></script>',
          },
    ),
  );
  await page.goto("http://person-links.test/");
});
test("independent payer/partner linking, clearing, and new children", async ({ page }) => {
  await page
    .getByRole("button", {
      name: "Verknüpfen: Antragsteller und Zahler, Paula Test, Paula Test",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Verknüpfen: Partner, Peter Test, Peter Test", exact: true })
    .click();
  await expect(page.locator("output")).toHaveText('{"primary":"payer","partner":"partner"}');
  await expect(
    page.getByRole("button", {
      name: "Verknüpfen: Antragsteller und Zahler, Paula Test, Peter Test",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(page.getByText("Neu anlegen. Keine möglichen Dubletten gefunden.")).toBeVisible();
  await page
    .getByRole("button", {
      name: "Verknüpfung lösen: Partner, Peter Test, Peter Test",
      exact: true,
    })
    .click();
  await expect(page.locator("output")).toHaveText('{"primary":"payer"}');
  await expect(
    page.getByRole("button", {
      name: "Verknüpfen: Antragsteller und Zahler, Paula Test, Peter Test",
      exact: true,
    }),
  ).toBeEnabled();
});
test("approval in progress freezes linking choices", async ({ page }) => {
  await page.getByRole("button", { name: "Genehmigung läuft" }).click();
  await expect(
    page.getByRole("button", { name: "Verknüpfen: Partner, Peter Test, Peter Test", exact: true }),
  ).toBeDisabled();
  await expect(page.locator("output")).toHaveText("{}");
});
