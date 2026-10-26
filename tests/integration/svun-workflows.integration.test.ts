import { call } from "@orpc/server";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Session } from "~/server/auth/auth";
import { db } from "~/server/db/client";
import { memberIsCurrent } from "~/server/db/member-filters";
import { users } from "~/server/db/schema/auth";
import {
  birthdayDeliveriesTable,
  birthdaySettingsTable,
} from "~/server/db/schema/birthday-reminders";
import { contractsTable } from "~/server/db/schema/contracts";
import { familienMitgliederTable, familienTable } from "~/server/db/schema/familien";
import { sollStellungenTable } from "~/server/db/schema/fee-runs";
import { feeTypesTable } from "~/server/db/schema/fee-types";
import { membersTable } from "~/server/db/schema/members";
import { relationshipsTable } from "~/server/db/schema/relationships";
import { applyFamilyInventory, familyInventory } from "~/server/domain/family-migration";
import { runBirthdayReminders } from "~/server/mail/birthday-reminders";
import type { AppContext } from "~/server/orpc/context";
import { appRouter } from "~/server/orpc/router";
import { buildFeeRunPreview } from "~/server/sepa/build-fee-run";
import { loadZahlerContext } from "~/server/sepa/zahler-context";

const send = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    ok: true,
    bodyText: "Geburtstage",
    bodyHtml: "<p>Geburtstage</p>",
    messageId: "test",
  }),
);
vi.mock("~/server/auth/send-invite", () => ({ sendBrandedMail: send }));
const marker = `SVUN-${Date.now()}`;
const ids: string[] = [];
let art = 0;
let adr = 0;
let contractId = "";
let memberId = "";
let contactId = "";
const actor = { id: marker, email: `${marker}@example.test` };
function context(role = "vorstand"): AppContext {
  return {
    db: db(),
    tenant: { key: marker, databaseUrl: "" },
    session: {
      session: { id: marker, userId: marker },
      user: { ...actor, role },
    } as unknown as Session,
    headers: new Headers(),
    requestId: marker,
  };
}
async function person(name: string, contact = false) {
  const [p] = await db()
    .insert(membersTable)
    .values({
      adrNr: ++adr,
      vorname: name,
      nachname: marker,
      memberNo: contact ? null : `${marker}-${name}`,
      kontaktNo: contact ? `K-${name}` : null,
      geburtsdatum: new Date("2000-10-28T00:00:00Z"),
    })
    .returning();
  ids.push(p!.id);
  return p!;
}
describe.skipIf(!process.env.DATABASE_URL?.includes("svuwv_test"))("SVUN workflows", () => {
  beforeAll(async () => {
    const [max] = await db()
      .select({ n: sql<number>`coalesce(max(adr_nr),0)::int` })
      .from(membersTable);
    adr = max!.n;
    const [maxArt] = await db()
      .select({ n: sql<number>`coalesce(max(art),0)::int` })
      .from(feeTypesTable);
    art = maxArt!.n + 1;
    await db()
      .insert(users)
      .values({ ...actor, name: "Workflow test", role: "admin" });
    await db()
      .insert(feeTypesTable)
      .values({ art, bezeichnung: marker, betrag1: "72", sollstellung: "jährlich" });
    const member = await person("Member");
    memberId = member.id;
    contactId = (await person("Contact", true)).id;
    const [c] = await db()
      .insert(contractsTable)
      .values({
        memberId,
        adrNr: member.adrNr,
        vertragNr: marker,
        art: art + 1,
        artName: "Alt",
        betrag: "54",
        isDirectDebit: false,
        vertragBegin: new Date("2026-01-01"),
      })
      .returning({ id: contractsTable.id });
    contractId = c!.id;
  });
  afterAll(async () => {
    const families = await db()
      .select({ id: familienMitgliederTable.familieId })
      .from(familienMitgliederTable)
      .where(inArray(familienMitgliederTable.memberId, ids));
    for (const f of families) await db().delete(familienTable).where(eq(familienTable.id, f.id));
    await db().delete(sollStellungenTable).where(inArray(sollStellungenTable.memberId, ids));
    await db().delete(membersTable).where(inArray(membersTable.id, ids));
    await db().delete(feeTypesTable).where(eq(feeTypesTable.art, art));
    await db()
      .delete(birthdayDeliveriesTable)
      .where(eq(birthdayDeliveriesTable.week, "2026-10-26"));
    await db().delete(birthdaySettingsTable).where(eq(birthdaySettingsTable.id, 1));
    await db().delete(users).where(eq(users.id, marker));
  });
  it("counts only current real members and defaults the list to them", async () => {
    const future = await person("ScheduledExit");
    await db()
      .update(membersTable)
      .set({ austritt: new Date(Date.now() + 90 * 86400_000) })
      .where(eq(membersTable.id, future.id));
    const stats = await call(appRouter.members.stats, undefined, { context: context() });
    const [expected] = await db()
      .select({ n: sql<number>`count(*)::int` })
      .from(membersTable)
      .where(memberIsCurrent());
    expect(stats.total).toBe(expected!.n);
    const list = await call(appRouter.members.list, { q: marker }, { context: context() });
    expect(list.rows.map((r) => (r as { id: string }).id)).toContain(memberId);
    expect(list.rows.map((r) => (r as { id: string }).id)).not.toContain(contactId);
    const dashboard = await call(appRouter.dashboard.stats, undefined, { context: context() });
    expect(dashboard.total).toBe(expected!.n);
    const [actualExits] = await db()
      .select({ n: sql<number>`count(*)::int` })
      .from(membersTable)
      .where(
        sql`member_no is not null and deleted_at is null and austritt >= date_trunc('month',current_date) and austritt <= now()`,
      );
    expect(dashboard.austritteThisMonth).toBe(actualExits!.n);
    const contacts = await call(
      appRouter.members.list,
      { q: marker, status: "kontakte" },
      { context: context() },
    );
    expect(contacts.rows.map((r) => (r as { id: string }).id)).toContain(contactId);
  });
  it("previews a switch without writes, selects the successor at its due date and keeps paid history", async () => {
    const input = { contractId, art, effectiveDate: "2027-07-01" };
    const plan = await call(appRouter.contractSwitch.preview, input, { context: context() });
    expect(plan.oldAmount).toBe("54.00000000");
    const next = await call(
      appRouter.contractSwitch.commit,
      { ...input, revision: plan.revision, confirm: true },
      { context: context() },
    );
    const before = await buildFeeRunPreview(db(), {
      billingYear: 2027,
      falligkeitsdatum: new Date("2027-06-01"),
      memberIds: [memberId],
    });
    expect(before.invoices).toHaveLength(1);
    expect(before.invoices[0]!.amount).toBe("54.00");
    const after = await buildFeeRunPreview(db(), {
      billingYear: 2027,
      falligkeitsdatum: new Date("2027-08-01"),
      memberIds: [memberId],
    });
    expect(after.invoices).toHaveLength(1);
    expect(after.invoices[0]!.contractId).toBe(next.id);
    await db().insert(sollStellungenTable).values({
      memberId,
      contractId,
      billingYear: 2027,
      falligkeitsdatum: "2027-06-01",
      amount: "54",
      paidAmount: "54",
      openAmount: "0",
      status: "paid",
    });
    const paid = await buildFeeRunPreview(db(), {
      billingYear: 2027,
      falligkeitsdatum: new Date("2027-08-01"),
      memberIds: [memberId],
    });
    expect(paid.invoices).toHaveLength(0);
    await expect(
      call(
        appRouter.contractSwitch.commit,
        { ...input, revision: plan.revision, confirm: true },
        { context: context() },
      ),
    ).rejects.toThrow();
  });
  it("converts only an unencumbered mistaken member, preserves the old reference and rejects readonly", async () => {
    const p = await person("Mistake");
    const plan = await call(
      appRouter.memberConversion.preview,
      { memberId: p.id },
      { context: context() },
    );
    expect(plan.blockers).toEqual([]);
    await expect(
      call(
        appRouter.memberConversion.preview,
        { memberId: p.id },
        { context: context("readonly") },
      ),
    ).rejects.toThrow();
    const result = await call(
      appRouter.memberConversion.commit,
      {
        memberId: p.id,
        expectedUpdatedAt: plan.updatedAt!,
        kontaktNo: plan.kontaktNo,
        reason: "Versehentlich als Mitglied angelegt",
        confirm: true,
      },
      { context: context() },
    );
    const lookup = await call(
      appRouter.members.get,
      { mitgliedsnummer: p.memberNo! },
      { context: context() },
    );
    expect(lookup.member.kontaktNo).toBe(result.kontaktNo);
    expect(lookup.member.memberNo).toBeNull();
    await expect(
      call(
        appRouter.contracts.create,
        { memberId: p.id, patch: { vertragNr: "invalid-contact-contract", art } },
        { context: context() },
      ),
    ).rejects.toThrow("Kontakte");
    const blocked = await call(
      appRouter.memberConversion.preview,
      { memberId },
      { context: context() },
    );
    expect(blocked.blockers.length).toBeGreaterThan(0);
    const former = await person("Former");
    await db()
      .update(membersTable)
      .set({ austritt: new Date("2020-01-01") })
      .where(eq(membersTable.id, former.id));
    expect(
      (
        await call(
          appRouter.memberConversion.preview,
          { memberId: former.id },
          { context: context() },
        )
      ).blockers.length,
    ).toBeGreaterThan(0);
  });
  it("migrates an unambiguous guardian family and retains historical relationships", async () => {
    const child = await person("Child");
    await db()
      .update(membersTable)
      .set({ geburtsdatum: new Date("2015-01-01") })
      .where(eq(membersTable.id, child.id));
    const guardian = await person("Guardian", true);
    const [link] = await db()
      .insert(relationshipsTable)
      .values({
        fromMemberId: child.id,
        toMemberId: guardian.id,
        fromAdrNr: child.adrNr,
        toAdrNr: guardian.adrNr,
        istVertreter: true,
      })
      .returning({ id: relationshipsTable.id });
    const plan = await familyInventory(db());
    const p = plan.proposals.find((p) => p.persons.some((m) => m.id === child.id));
    expect(p!.issues).toEqual([]);
    await db().transaction((tx) => applyFamilyInventory(tx, plan.hash, actor));
    const ctx = await loadZahlerContext(db(), [child.id]);
    expect(ctx.familieZahlerByMember.get(child.id)).toBe(guardian.id);
    expect(ctx.vertreterByMember.get(child.id)).toBe(guardian.id);
    const [retained] = await db()
      .select()
      .from(relationshipsTable)
      .where(eq(relationshipsTable.id, link!.id));
    expect(retained!.datBis).not.toBeNull();
  });
  it("deduplicates weekly recipients across repeated concurrent runs and excludes contacts", async () => {
    await db()
      .insert(birthdaySettingsTable)
      .values({
        id: 1,
        enabled: true,
        time: "08:00",
        userIds: [marker],
        emails: [actor.email, actor.email.toUpperCase()],
      })
      .onConflictDoUpdate({
        target: birthdaySettingsTable.id,
        set: {
          enabled: true,
          time: "08:00",
          userIds: [marker],
          emails: [actor.email, actor.email.toUpperCase()],
        },
      });
    send.mockClear();
    await Promise.all([
      runBirthdayReminders(db(), new Date("2026-10-26T08:00:00Z")),
      runBirthdayReminders(db(), new Date("2026-10-26T08:00:00Z")),
    ]);
    expect(send).toHaveBeenCalledTimes(1);
    const document = send.mock.calls[0]![1].document;
    expect(document.blocks[0].text).not.toContain(`Contact ${marker}`);
    expect(document.blocks[0].text).toContain(`Member ${marker}`);
  });
  it("leaves independent contracts billable and rejects a changed tariff after preview", async () => {
    const [owner] = await db().select().from(membersTable).where(eq(membersTable.id, memberId));
    await db()
      .insert(contractsTable)
      .values({
        memberId,
        adrNr: owner!.adrNr,
        vertragNr: `${marker}-independent`,
        art: art + 2,
        betrag: "12",
        isDirectDebit: false,
        vertragBegin: new Date("2026-01-01"),
      });
    const p = await buildFeeRunPreview(db(), {
      billingYear: 2027,
      falligkeitsdatum: new Date("2027-08-01"),
      memberIds: [memberId],
    });
    expect(p.invoices).toHaveLength(1);
    expect(p.invoices[0]!.amount).toBe("12.00");
    const candidate = await person("PriceRace");
    const [c] = await db()
      .insert(contractsTable)
      .values({
        memberId: candidate.id,
        adrNr: candidate.adrNr,
        vertragNr: marker,
        art: art + 2,
        betrag: "40",
        vertragBegin: new Date("2026-01-01"),
      })
      .returning({ id: contractsTable.id });
    const input = { contractId: c!.id, art, effectiveDate: "2027-01-01" };
    const preview = await call(appRouter.contractSwitch.preview, input, { context: context() });
    await db().update(feeTypesTable).set({ betrag1: "99" }).where(eq(feeTypesTable.art, art));
    await expect(
      call(
        appRouter.contractSwitch.commit,
        { ...input, revision: preview.revision, confirm: true },
        { context: context() },
      ),
    ).rejects.toThrow("Vorschau");
  });
  it("continues mailing other recipients after a transport failure", async () => {
    await db()
      .update(birthdaySettingsTable)
      .set({ userIds: [], emails: [actor.email, "second@example.test"] })
      .where(eq(birthdaySettingsTable.id, 1));
    send.mockClear();
    send.mockRejectedValueOnce(new Error("simulated transport failure"));
    await runBirthdayReminders(db(), new Date("2026-11-02T08:00:00Z"));
    expect(send).toHaveBeenCalledTimes(2);
    const deliveries = await db()
      .select()
      .from(birthdayDeliveriesTable)
      .where(eq(birthdayDeliveriesTable.week, "2026-11-02"));
    expect(deliveries.map((d) => d.status).sort()).toEqual(["failed", "sent"]);
    await db()
      .delete(birthdayDeliveriesTable)
      .where(eq(birthdayDeliveriesTable.week, "2026-11-02"));
  });
});
