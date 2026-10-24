import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const code = readFileSync("public/analytics-consent.js", "utf8");
for (const mode of [
  "initial",
  "reject",
  "allow-withdraw",
  "dnt",
  "gpc",
  "query",
  "wrong-host",
  "storage-unavailable",
]) {
  test(`optional application analytics: ${mode}`, async ({ page }) => {
    const calls: string[] = [];
    if (mode === "dnt")
      await page.addInitScript(() =>
        Object.defineProperty(navigator, "doNotTrack", { value: "1" }),
      );
    if (mode === "gpc")
      await page.addInitScript(() =>
        Object.defineProperty(navigator, "globalPrivacyControl", { value: true }),
      );
    if (mode === "storage-unavailable")
      await page.addInitScript(() => {
        Storage.prototype.getItem = () => {
          throw Error("blocked");
        };
        Storage.prototype.setItem = () => {
          throw Error("blocked");
        };
      });
    await page.route("**/*", async (route) => {
      const url = route.request().url();
      if (url.endsWith("/consent.js"))
        return route.fulfill({ contentType: "application/javascript", body: code });
      if (url.startsWith("https://umami.pdcd.net/")) {
        calls.push(url);
        return route.fulfill({ contentType: "application/javascript", body: "" });
      }
      return route.fulfill({
        contentType: "text/html",
        body: '<html lang="de"><body><main class="rr-block"><input value="Synthetic test data"></main><script defer src="/consent.js" data-website-id="35888d1d-623f-40d4-86b2-d4fd181074f3" data-hosts="svu.kontor2.com" data-only-path="/antrag"></script></body></html>',
      });
    });
    await page.goto(
      `https://${mode === "wrong-host" ? "other-club.test" : "svu.kontor2.com"}/antrag${mode === "query" ? "?token=synthetic" : ""}`,
    );
    await page.waitForLoadState("networkidle");
    expect(calls).toHaveLength(0);
    if (["query", "wrong-host"].includes(mode)) {
      await expect(page.locator("#site-analytics-consent")).toHaveCount(0);
      return;
    }
    if (mode === "reject")
      await page.getByRole("button", { name: "Ablehnen", exact: true }).click();
    if (["allow-withdraw", "storage-unavailable", "dnt", "gpc"].includes(mode)) {
      await page
        .getByRole("button", { name: "Analyse und Aufzeichnung erlauben", exact: true })
        .click();
      if (["dnt", "gpc"].includes(mode)) expect(calls).toHaveLength(0);
      else await expect.poll(() => calls.length).toBe(2);
    }
    if (mode === "allow-withdraw") {
      await page.getByRole("button", { name: "Analyse-Einstellungen", exact: true }).click();
      await page.getByRole("button", { name: "Ablehnen", exact: true }).click();
      await page.waitForLoadState("networkidle");
      expect(calls).toHaveLength(2);
    }
  });
}
