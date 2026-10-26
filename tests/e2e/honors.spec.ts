import { readFile } from "node:fs/promises";
import { inArray, sql } from "drizzle-orm";
import { db } from "../../src/server/db/client";
import { membersTable } from "../../src/server/db/schema/members";
import { expect, test } from "./fixtures";

const ids: string[] = [];
const marker = `Ehrungsdemo${Date.now()}`;
test.beforeAll(async () => {
  const [max] = await db()
    .select({ adr: sql<number>`coalesce(max(adr_nr),0)::int` })
    .from(membersTable);
  let adr = max!.adr;
  for (const years of [30, 35, 65]) {
    const [member] = await db()
      .insert(membersTable)
      .values({
        adrNr: ++adr,
        memberNo: `${marker}-${years}`,
        vorname: `Demo${years}`,
        nachname: marker,
        eintritt: new Date(`${new Date().getUTCFullYear() - years}-05-01T00:00:00Z`),
      })
      .returning({ id: membersTable.id });
    ids.push(member!.id);
  }
});
test.afterAll(async () => {
  if (ids.length) await db().delete(membersTable).where(inArray(membersTable.id, ids));
});
test("new anniversaries are selected, filterable and exported on desktop and mobile", async ({
  appPage: page,
}) => {
  await page.getByRole("link", { name: "Berichte", exact: true }).click();
  await page.getByRole("link", { name: /^Ehrungen/ }).click();
  for (const year of [25, 30, 35, 45, 55, 65, 150])
    await expect(page.getByRole("button", { name: `${year} Jahre`, exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  await expect(page.getByRole("cell", { name: `${marker}, Demo65`, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "65 Jahre", exact: true }).click();
  await expect(page.getByRole("cell", { name: `${marker}, Demo65`, exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "65 Jahre", exact: true }).click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Als CSV exportieren" }).click();
  const download = await downloading;
  const contents = await readFile((await download.path())!, "utf8");
  for (const year of [30, 35, 65]) expect(contents).toContain(`Demo${year}`);
  await page.screenshot({ path: "/tmp/kontor-honors-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "65 Jahre", exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "/tmp/kontor-honors-mobile.png", fullPage: true });
  for (const button of await page.getByRole("button", { name: /^\d+ Jahre$/ }).all())
    await button.click();
  await expect(page.getByText("Keine Ehrungen im gewählten Jahr.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Als CSV exportieren" })).toBeDisabled();
});
