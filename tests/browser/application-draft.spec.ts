import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

let directory: string;
let bundle: string;
test.beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), "kontor-draft-"));
  execFileSync("bun", [
    "build",
    "tests/browser/application-draft.fixture.tsx",
    "--target=browser",
    "--external=~/lib/orpc",
    "--outdir",
    directory,
  ]);
  bundle = readFileSync(join(directory, "application-draft.fixture.js"), "utf8");
});
test.afterAll(() => rmSync(directory, { recursive: true, force: true }));

test("bank details stay in memory and legacy bank drafts are removed", async ({ page }) => {
  await page.route("http://application.test/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill(
      path === "/fixture.js"
        ? { contentType: "text/javascript", body: bundle }
        : path === "/rpc.js"
          ? {
              contentType: "text/javascript",
              body: "export const orpc = { applications: { lookupIban: async () => ({ valid: true, bic: null, name: null }) } };",
            }
          : {
              contentType: "text/html",
              body: '<meta charset="utf-8"><script type="importmap">{"imports":{"~/lib/orpc":"/rpc.js"}}</script><div id="root"></div><script type="module" src="/fixture.js"></script>',
            },
    );
  });
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("test-initialized")) {
      sessionStorage.setItem("test-initialized", "1");
      sessionStorage.setItem(
        "kontor2-antrag-draft-v1",
        JSON.stringify({ iban: "legacy-bank-data" }),
      );
      sessionStorage.setItem(
        "kontor2-antrag-draft-v2",
        JSON.stringify({ step: 2, vorname: "Erika", nachname: "Test" }),
      );
    }
  });
  await page.goto("http://application.test/");
  await expect(page.getByRole("heading", { name: /SEPA/ }).first()).toBeVisible();
  const inputs = page.locator("input");
  // Only the SEPA step is mounted. Enter synthetic account data without submitting.
  await inputs.first().fill("Synthetic Account Holder");
  await page.getByPlaceholder(/DE/).fill("DE89370400440532013000");
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem("kontor2-antrag-draft-v2")))
    .not.toBeNull();
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem("kontor2-antrag-draft-v1")))
    .toBeNull();
  await expect
    .poll(async () => {
      const raw = await page.evaluate(() => sessionStorage.getItem("kontor2-antrag-draft-v2"));
      return raw ? JSON.parse(raw).step : null;
    })
    .toBe(1);
  const saved = await page.evaluate(() => sessionStorage.getItem("kontor2-antrag-draft-v2"));
  expect(saved).not.toContain("Synthetic Account Holder");
  expect(saved).not.toContain("DE89370400440532013000");
  for (const key of ["kontoinhaber", "iban", "bic", "kreditinstitut", "signature"]) {
    expect(JSON.parse(saved ?? "{}")).not.toHaveProperty(key);
  }
  await page.reload();
  await expect(inputs.first()).toHaveValue("Erika Test");
  await expect(page.getByPlaceholder(/DE/)).toHaveValue("");
});
