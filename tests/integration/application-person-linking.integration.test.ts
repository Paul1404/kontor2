import { randomUUID } from "node:crypto";
import { call } from "@orpc/server";
import { and, eq, inArray, isNull, like, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Session } from "~/server/auth/auth";
import { db } from "~/server/db/client";
import { users } from "~/server/db/schema/auth";
import { contractsTable } from "~/server/db/schema/contracts";
import { familienMitgliederTable, familienTable } from "~/server/db/schema/familien";
import { membersTable } from "~/server/db/schema/members";
import {
  membershipApplicationFilesTable,
  membershipApplicationsTable,
} from "~/server/db/schema/membership-applications";
import { relationshipsTable } from "~/server/db/schema/relationships";
import { sepaMandatesTable } from "~/server/db/schema/sepa";
import type { AppContext } from "~/server/orpc/context";
import { appRouter } from "~/server/orpc/router";

// Only external file storage is mocked. Approval, audit, snapshots, contracts,
// mandates and all person/family relationships use the disposable real database.
vi.mock("~/server/s3/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/server/s3/client")>()),
  getObject: vi.fn(async () => Buffer.from("test document")),
  putObject: vi.fn(async () => undefined),
}));

const onTestDb = process.env.DATABASE_URL?.includes("svuwv_test") ?? false;
const marker = `PersonLink-${Date.now()}`;
const actorId = `${marker}-actor`;
const applications: string[] = [];
const families: string[] = [];
const iban = "DE89370400440532013000";
let counter = 0;
const context = () =>
  ({
    db: db(),
    headers: new Headers(),
    tenant: { key: "svu", databaseUrl: "" },
    session: {
      session: { id: "test", userId: actorId },
      user: { id: actorId, email: "person-link@test.local", role: "vorstand" },
    } as unknown as Session,
    requestId: "person-link-test",
  }) as AppContext;

async function member(vorname: string, suffix: string, kontakt = false) {
  const [max] = await db()
    .select({ n: sql<number>`coalesce(max(${membersTable.adrNr}), 0)::int` })
    .from(membersTable);
  const [row] = await db()
    .insert(membersTable)
    .values({
      adrNr: (max?.n ?? 0) + 1,
      vorname,
      nachname: `${marker}-${suffix}`,
      plz: "97508",
      geburtsdatum: new Date("1990-04-12"),
      status: "aktiv",
      strasse: "Bestehende Straße",
      memberNo: kontakt ? null : `M-${randomUUID()}`,
      kontaktNo: kontakt ? `K-${randomUUID()}` : null,
    })
    .returning();
  return row!;
}
async function application(suffix: string, kind: "familie" | "kind" = "familie") {
  const [app] = await db()
    .insert(membershipApplicationsTable)
    .values({
      antragsnummer: `${marker}-${++counter}`,
      source: "online",
      status: "dokument_hochgeladen",
      antragstyp: kind,
      mitgliedschaftTyp: kind,
      vorname: kind === "kind" ? "Klara" : "Paula",
      nachname: `${marker}-${suffix}`,
      geburtsdatum: new Date("1990-04-12"),
      plz: "97508",
      strasse: "Neue Straße",
      hausnummer: "7",
      ort: "Untereuerheim",
      ...(kind === "familie"
        ? {
            partnerVorname: "Peter",
            partnerNachname: `${marker}-${suffix}`,
            partnerGeburtsdatum: new Date("1990-04-12"),
            kinder: [
              {
                vorname: "Klara",
                nachname: `${marker}-${suffix}`,
                geburtsdatum: "2018-05-06",
                abteilungen: [],
              },
            ],
          }
        : {
            erziehungsberechtigterVorname: "Paula",
            erziehungsberechtigterNachname: `${marker}-${suffix}`,
          }),
      iban,
      ibanLast4: "3000",
      consentAt: new Date(),
      mandatsreferenz: `${marker}-mandate-${counter}`,
    })
    .returning();
  applications.push(app!.id);
  await db()
    .insert(membershipApplicationFilesTable)
    .values({
      applicationId: app!.id,
      kind: "signed_scan",
      s3Key: `test/${app!.id}.pdf`,
      filename: "signed.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1,
    });
  return app!;
}
async function approve(id: string, personLinks: { personKey: string; memberId: string }[]) {
  return call(appRouter.applications.approve, { id, personLinks }, { context: context() });
}
async function family(payerId: string, partnerId?: string) {
  const [row] = await db()
    .insert(familienTable)
    .values({ name: marker, zahlerMemberId: payerId })
    .returning();
  families.push(row!.id);
  await db()
    .insert(familienMitgliederTable)
    .values([
      { familieId: row!.id, memberId: payerId, rolle: "zahler" as const },
      ...(partnerId
        ? [{ familieId: row!.id, memberId: partnerId, rolle: "partner" as const }]
        : []),
    ]);
  return row!;
}

describe.skipIf(!onTestDb)("application links each person (integration)", () => {
  beforeAll(async () => {
    await db().insert(users).values({
      id: actorId,
      name: "Person linking",
      email: "person-link@test.local",
      emailVerified: true,
      role: "vorstand",
    });
  });
  afterAll(async () => {
    const rows = await db()
      .select({ id: membersTable.id })
      .from(membersTable)
      .where(like(membersTable.nachname, `${marker}%`));
    const ids = rows.map((row) => row.id);
    if (applications.length)
      await db()
        .delete(membershipApplicationsTable)
        .where(inArray(membershipApplicationsTable.id, applications));
    const related = ids.length
      ? await db()
          .select({ id: familienTable.id })
          .from(familienTable)
          .where(inArray(familienTable.zahlerMemberId, ids))
      : [];
    const familyIds = [...new Set([...families, ...related.map((row) => row.id)])];
    if (familyIds.length)
      await db().delete(familienTable).where(inArray(familienTable.id, familyIds));
    if (ids.length) await db().delete(membersTable).where(inArray(membersTable.id, ids));
    await db().delete(users).where(eq(users.id, actorId));
  });

  it("discovers payer, partner and children independently, links all without duplicates", async () => {
    const payer = await member("Paula", "all");
    const partner = await member("Peter", "all");
    const child = await member("Klara", "all");
    await db()
      .update(membersTable)
      .set({ geburtsdatum: new Date("2018-05-06") })
      .where(eq(membersTable.id, child.id));
    const app = await application("all");
    const groups = await call(
      appRouter.applications.duplicateCandidates,
      { applicationId: app.id },
      { context: context() },
    );
    expect(groups.people.map((p) => p.key)).toEqual(["primary", "partner", "child:0"]);
    for (const [key, id] of [
      ["primary", payer.id],
      ["partner", partner.id],
      ["child:0", child.id],
    ]) {
      expect(groups.people.find((p) => p.key === key)?.candidates.some((c) => c.id === id)).toBe(
        true,
      );
    }
    await approve(app.id, [
      { personKey: "primary", memberId: payer.id },
      { personKey: "partner", memberId: partner.id },
      { personKey: "child:0", memberId: child.id },
    ]);
    const rows = await db()
      .select()
      .from(membersTable)
      .where(eq(membersTable.nachname, app.nachname));
    expect(rows).toHaveLength(3);
    expect(rows.find((row) => row.id === payer.id)).toMatchObject({
      strasse: "Bestehende Straße",
      hausnummer: "7",
      iban1Last4: "3000",
    });
    expect(rows.find((row) => row.id === partner.id)?.iban1).toBeNull();
    expect(rows.find((row) => row.id === child.id)?.iban1).toBeNull();
    const mandates = await db()
      .select()
      .from(sepaMandatesTable)
      .where(
        inArray(
          sepaMandatesTable.memberId,
          rows.map((row) => row.id),
        ),
      );
    expect(mandates.map((row) => row.memberId)).toEqual([payer.id]);
    const [approved] = await db()
      .select()
      .from(membershipApplicationsTable)
      .where(eq(membershipApplicationsTable.id, app.id));
    expect(approved?.mitgliedsnummer).toBe(
      [payer.memberNo, partner.memberNo, child.memberNo].join(", "),
    );
  });

  it("links a partner even when the applicant and child are new", async () => {
    const partner = await member("Peter", "mixed");
    const app = await application("mixed");
    await approve(app.id, [{ personKey: "partner", memberId: partner.id }]);
    const rows = await db()
      .select()
      .from(membersTable)
      .where(eq(membersTable.nachname, app.nachname));
    expect(rows).toHaveLength(3);
    expect(rows.filter((row) => row.vorname === "Peter").map((row) => row.id)).toEqual([
      partner.id,
    ]);
  });

  it("reuses an existing family, mandate and contract and only adds missing children", async () => {
    const payer = await member("Paula", "reuse");
    const partner = await member("Peter", "reuse");
    const existingFamily = await family(payer.id, partner.id);
    const app = await application("reuse");
    await db()
      .insert(sepaMandatesTable)
      .values({ memberId: payer.id, adrNr: payer.adrNr, mandatsNr: "existing" });
    await db().insert(contractsTable).values({
      memberId: payer.id,
      adrNr: payer.adrNr,
      vertragNr: "1",
      art: 999,
      vertragBegin: new Date(),
      betrag: "96",
    });
    await approve(app.id, [
      { personKey: "primary", memberId: payer.id },
      { personKey: "partner", memberId: partner.id },
    ]);
    expect(
      await db().select().from(familienTable).where(eq(familienTable.zahlerMemberId, payer.id)),
    ).toHaveLength(1);
    expect(
      await db()
        .select()
        .from(familienMitgliederTable)
        .where(eq(familienMitgliederTable.familieId, existingFamily.id)),
    ).toHaveLength(3);
    expect(
      await db().select().from(sepaMandatesTable).where(eq(sepaMandatesTable.memberId, payer.id)),
    ).toHaveLength(1);
    expect(
      await db().select().from(contractsTable).where(eq(contractsTable.memberId, payer.id)),
    ).toHaveLength(1);
  });

  it("links an existing contact payer and child and reuses the representative relation", async () => {
    const payer = await member("Paula", "guardian", true);
    const child = await member("Klara", "guardian");
    await db().insert(relationshipsTable).values({
      fromMemberId: child.id,
      toMemberId: payer.id,
      fromAdrNr: child.adrNr,
      toAdrNr: payer.adrNr,
      istVertreter: true,
    });
    const app = await application("guardian", "kind");
    const groups = await call(
      appRouter.applications.duplicateCandidates,
      { applicationId: app.id },
      { context: context() },
    );
    expect(
      groups.people.find((p) => p.key === "guardian")?.candidates.some((c) => c.id === payer.id),
    ).toBe(true);
    await approve(app.id, [
      { personKey: "primary", memberId: child.id },
      { personKey: "guardian", memberId: payer.id },
    ]);
    expect(
      await db().select().from(membersTable).where(eq(membersTable.nachname, app.nachname)),
    ).toHaveLength(2);
    const [updatedPayer] = await db()
      .select()
      .from(membersTable)
      .where(eq(membersTable.id, payer.id));
    expect(updatedPayer).toMatchObject({
      kontaktNo: payer.kontaktNo,
      memberNo: null,
      iban1Last4: "3000",
    });
    const [updatedChild] = await db()
      .select()
      .from(membersTable)
      .where(eq(membersTable.id, child.id));
    expect(updatedChild?.iban1).toBeNull();
    expect(
      await db()
        .select()
        .from(relationshipsTable)
        .where(eq(relationshipsTable.fromMemberId, child.id)),
    ).toHaveLength(1);
    expect(
      await db().select().from(sepaMandatesTable).where(eq(sepaMandatesTable.memberId, payer.id)),
    ).toHaveLength(1);
  });

  it("promotes an existing partner contact without creating a second person", async () => {
    const partner = await member("Peter", "contact", true);
    const app = await application("contact");
    await approve(app.id, [{ personKey: "partner", memberId: partner.id }]);
    const [updated] = await db().select().from(membersTable).where(eq(membersTable.id, partner.id));
    expect(updated?.memberNo).toMatch(/^M-/);
    expect(updated?.kontaktNo).toBeNull();
    expect(
      await db().select().from(membersTable).where(eq(membersTable.nachname, app.nachname)),
    ).toHaveLength(3);
  });

  it("rolls back rather than silently using a different existing payer bank account", async () => {
    const payer = await member("Paula", "bank-conflict");
    await db()
      .update(membersTable)
      .set({ iban1: "DE12500105170648489890", iban1Last4: "9890" })
      .where(eq(membersTable.id, payer.id));
    const app = await application("bank-conflict");
    await expect(approve(app.id, [{ personKey: "primary", memberId: payer.id }])).rejects.toThrow(
      "Bankverbindung",
    );
    expect(
      await db().select().from(membersTable).where(eq(membersTable.nachname, app.nachname)),
    ).toHaveLength(1);
  });

  it("rejects assigning one member twice, nonexistent person keys and deleted records", async () => {
    const payer = await member("Paula", "invalid");
    const app = await application("invalid");
    await expect(
      approve(app.id, [
        { personKey: "primary", memberId: payer.id },
        { personKey: "partner", memberId: payer.id },
      ]),
    ).rejects.toThrow("nur einmal");
    await expect(approve(app.id, [{ personKey: "child:99", memberId: payer.id }])).rejects.toThrow(
      "nur einmal",
    );
    await db()
      .update(membersTable)
      .set({ deletedAt: new Date() })
      .where(eq(membersTable.id, payer.id));
    await expect(approve(app.id, [{ personKey: "partner", memberId: payer.id }])).rejects.toThrow(
      "nicht gefunden",
    );
    expect(
      await db().select().from(membersTable).where(eq(membersTable.nachname, app.nachname)),
    ).toHaveLength(1);
    const [unchanged] = await db()
      .select()
      .from(membershipApplicationsTable)
      .where(eq(membershipApplicationsTable.id, app.id));
    expect(unchanged?.status).toBe("dokument_hochgeladen");
  });

  it("rolls back approval when existing people belong to different families", async () => {
    const payer = await member("Paula", "conflict");
    const partner = await member("Peter", "conflict");
    const other = await member("Other", "conflict-other");
    await family(payer.id);
    await family(other.id, partner.id);
    const app = await application("conflict");
    await expect(
      approve(app.id, [
        { personKey: "primary", memberId: payer.id },
        { personKey: "partner", memberId: partner.id },
      ]),
    ).rejects.toThrow("unterschiedlichen Familien");
    expect(
      await db().select().from(membersTable).where(eq(membersTable.nachname, app.nachname)),
    ).toHaveLength(2);
    expect(
      await db().select().from(sepaMandatesTable).where(eq(sepaMandatesTable.memberId, payer.id)),
    ).toHaveLength(0);
    expect(
      await db()
        .select()
        .from(familienMitgliederTable)
        .where(
          and(
            eq(familienMitgliederTable.memberId, partner.id),
            isNull(familienMitgliederTable.bis),
          ),
        ),
    ).toHaveLength(1);
  });
});
