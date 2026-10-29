import { eq } from "drizzle-orm";
import { db } from "../../src/server/db/client";
import { organizationSettingsTable } from "../../src/server/db/schema/organization-settings";
import { expect, test } from "./fixtures";

let previous: typeof organizationSettingsTable.$inferSelect | undefined;
test.beforeAll(async () => {
  [previous] = await db().select().from(organizationSettingsTable).limit(1);
  await db()
    .insert(organizationSettingsTable)
    .values({
      id: 1,
      vereinsname: "Beitragsdemo",
      glaeubigerId: "TEST",
      vereinsIban: "DE89370400440532013000",
      vereinsIbanLast4: "3000",
      vereinsBic: "COBADEFFXXX",
      beitragsstaffel: {
        familie: "96",
        kind: "24",
        kindElternMitglied: "12",
        jugendlich: "36",
        jugendlichElternMitglied: "24",
        jungerErwachsener: "42",
        erwachsener: "54",
      },
    })
    .onConflictDoNothing();
});
test.afterAll(async () => {
  if (previous)
    await db()
      .update(organizationSettingsTable)
      .set(previous)
      .where(eq(organizationSettingsTable.id, 1));
  else await db().delete(organizationSettingsTable).where(eq(organizationSettingsTable.id, 1));
});
test("planned fees can be configured and reviewed on desktop and mobile", async ({
  appPage: page,
}) => {
  await page.getByText("Verwaltung", { exact: true }).click();
  await page.getByRole("link", { name: "Vereinsdaten", exact: true }).click();
  await page.getByRole("button", { name: "Beitragswechsel planen" }).click();
  await page.getByLabel("Gültig ab", { exact: true }).fill("2027-01-01");
  await page.getByLabel("Erwachsene (Jahresbeitrag in €)", { exact: true }).fill("60.00");
  await page.getByLabel("Junge Erwachsene unter", { exact: true }).fill("27");
  await page.getByRole("button", { name: "Beitragswechsel speichern" }).click();
  await expect(page.getByText("Beitragswechsel gespeichert.", { exact: true })).toBeVisible();
  const [saved] = await db().select().from(organizationSettingsTable).limit(1);
  expect(saved!.applicationFeeSchedule?.effectiveFrom).toBe("2027-01-01");
  expect(saved!.applicationFeeSchedule?.staffel.erwachsener).toBe("60.00");
  expect(saved!.applicationFeeSchedule?.altersgrenzen.jungerErwachsenerMax).toBe(27);
  await page.screenshot({ path: "/tmp/kontor-schedule-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel("Gültig ab", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "/tmp/kontor-schedule-mobile.png", fullPage: true });
});
