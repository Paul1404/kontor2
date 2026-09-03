import { call } from "@orpc/server";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { TenantPolicy } from "~/lib/tenant-settings";
import type { Session } from "~/server/auth/auth";
import { db } from "~/server/db/client";
import { abteilungenTable, memberAbteilungenTable } from "~/server/db/schema/abteilungen";
import { attachmentsTable, pendingUploadsTable } from "~/server/db/schema/attachments";
import { auditLogTable } from "~/server/db/schema/audit";
import { users } from "~/server/db/schema/auth";
import { memberCancellationsTable } from "~/server/db/schema/member-cancellations";
import { membersTable } from "~/server/db/schema/members";
import { organizationSettingsTable } from "~/server/db/schema/organization-settings";
import { sepaMandatesTable } from "~/server/db/schema/sepa";
import { memberSnapshotsTable } from "~/server/db/schema/snapshots";
import type { AppContext } from "~/server/orpc/context";
import { appRouter } from "~/server/orpc/router";

const EVIDENCE = Buffer.from("%PDF-1.7 Austrittserklaerung");

vi.mock("~/server/s3/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("~/server/s3/client")>();
  const body = Buffer.from("%PDF-1.7 Austrittserklaerung");
  return {
    ...original,
    getObject: vi.fn(async () => body),
    headObject: vi.fn(async () => ({
      contentLength: body.byteLength,
      contentType: "application/pdf",
    })),
  };
});

const onTestDb = process.env.DATABASE_URL?.includes("svuwv_test") ?? false;
const MARKER = `Kuendigung-${Date.now()}`;
const ACTOR_ID = `${MARKER}-actor`;

/** § 3 Abs. 2 der Satzung: Jahresende, 6 Wochen Frist. */
const SATZUNG: TenantPolicy = {
  legacyImportSources: [],
  legacyArchiveEnabled: false,
  cancellationDateMode: "year_end",
  cancellationStatuteReference: "§ 3 Abs. 2",
  outstandingClaimsStatuteReference: "§ 3 Abs. 5",
  privacyStatuteReference: null,
  familyPartnerRequired: false,
  familyChildMaxAge: 18,
  departmentPerPersonRequired: false,
  dunningTexts: { level1: null, level2: null, level3: null },
};

let memberId = "";
let abteilungId = "";
let mandateId = "";

function context(): AppContext {
  const session = {
    session: { id: "test", userId: ACTOR_ID },
    user: { id: ACTOR_ID, email: "kuendigung@test.local", role: "vorstand" },
  } as unknown as Session;
  return {
    db: db(),
    session,
    headers: new Headers(),
    tenant: { key: "svu", databaseUrl: "" },
    requestId: "cancellation-test",
  };
}

async function issueTicket(): Promise<string> {
  const [ticket] = await db()
    .insert(pendingUploadsTable)
    .values({
      memberId,
      kind: "cancellation_notice",
      filename: "austrittserklaerung.pdf",
      mimeType: "application/pdf",
      sizeBytes: EVIDENCE.byteLength,
      s3Key: `test/${MARKER}-${crypto.randomUUID()}.pdf`,
      requestedBy: ACTOR_ID,
      expiresAt: new Date(Date.now() + 60_000),
    })
    .returning();
  return ticket!.id;
}

describe.skipIf(!onTestDb)("cancellation record (integration)", () => {
  beforeAll(async () => {
    await db()
      .insert(users)
      .values({
        id: ACTOR_ID,
        name: "Kuendigung Integration",
        email: "kuendigung@test.local",
        emailVerified: true,
        role: "vorstand",
      })
      .onConflictDoNothing();
    await db()
      .insert(organizationSettingsTable)
      .values({
        id: 1,
        vereinsname: "Testverein",
        glaeubigerId: "DE98ZZZ09999999999",
        vereinsIban: "DE89370400440532013000",
        vereinsIbanLast4: "3000",
        vereinsBic: "COBADEFFXXX",
      })
      .onConflictDoNothing();
    // The rule under test has to be the one actually configured.
    await db()
      .update(organizationSettingsTable)
      .set({
        kuendigungsfristAktiv: true,
        kuendigungsfristTage: 42,
        kuendigungZumMonatsende: false,
        tenantPolicy: SATZUNG,
      })
      .where(eq(organizationSettingsTable.id, 1));

    const [maxRow] = await db()
      .select({ max: sql<number>`coalesce(max(${membersTable.adrNr}), 0)::int` })
      .from(membersTable);
    const adrNr = (maxRow?.max ?? 0) + 1;
    const [member] = await db()
      .insert(membersTable)
      .values({
        adrNr,
        memberNo: `M-${Date.now()}`,
        vorname: "Konrad",
        nachname: MARKER,
        eintritt: new Date(Date.UTC(2019, 0, 1)),
      })
      .returning();
    memberId = member!.id;

    const [abteilung] = await db()
      .insert(abteilungenTable)
      .values({ name: `${MARKER}-Abteilung`, slug: MARKER.toLowerCase() })
      .returning();
    abteilungId = abteilung!.id;
    await db().insert(memberAbteilungenTable).values({
      memberId,
      abteilungId,
      eintrittsdatum: "2019-01-01",
    });

    const [mandate] = await db()
      .insert(sepaMandatesTable)
      .values({ memberId, adrNr, mandatsNr: `${MARKER}-MND` })
      .returning();
    mandateId = mandate!.id;
  });

  afterAll(async () => {
    if (memberId) {
      await db()
        .delete(memberCancellationsTable)
        .where(eq(memberCancellationsTable.memberId, memberId));
      await db().delete(pendingUploadsTable).where(eq(pendingUploadsTable.memberId, memberId));
      await db().delete(attachmentsTable).where(eq(attachmentsTable.memberId, memberId));
      await db().delete(memberSnapshotsTable).where(eq(memberSnapshotsTable.memberId, memberId));
      await db().delete(sepaMandatesTable).where(eq(sepaMandatesTable.memberId, memberId));
      await db()
        .delete(memberAbteilungenTable)
        .where(eq(memberAbteilungenTable.memberId, memberId));
      await db().delete(membersTable).where(eq(membersTable.id, memberId));
    }
    if (abteilungId) {
      await db().delete(abteilungenTable).where(eq(abteilungenTable.id, abteilungId));
    }
    await db().delete(users).where(eq(users.id, ACTOR_ID));
  });

  it("derives the Austrittstermin from the day the notice arrived", async () => {
    const inTime = await call(
      appRouter.cancellations.previewDate,
      { noticeReceivedOn: "2026-11-19" },
      { context: context() },
    );
    expect(inTime.effectiveDate).toBe("2026-12-31");
    expect(inTime.missedPeriodEnd).toBeNull();
    expect(inTime.statuteReference).toBe("§ 3 Abs. 2");

    const tooLate = await call(
      appRouter.cancellations.previewDate,
      { noticeReceivedOn: "2026-11-20" },
      { context: context() },
    );
    expect(tooLate.effectiveDate).toBe("2027-12-31");
    expect(tooLate.missedPeriodEnd).toBe("2026-12-31");
  });

  it("stores evidence, cascades the Austritt and writes a receipt", async () => {
    const uploadId = await issueTicket();
    const [before] = await db().select().from(membersTable).where(eq(membersTable.id, memberId));

    const result = await call(
      appRouter.cancellations.record,
      {
        memberId,
        uploadId,
        // Well inside the six-week window for the 2026 year end.
        noticeReceivedOn: "2026-06-01",
        revokeSepa: true,
        note: "Per Post eingegangen",
        evidenceConfirmed: true,
        expectedUpdatedAt: before!.updatedAt.toISOString(),
      },
      { context: context() },
    );
    expect(result.effectiveDate).toBe("2026-12-31");
    expect(result.abteilungen).toBe(1);
    expect(result.sepaMandate).toBe(1);

    const [member] = await db().select().from(membersTable).where(eq(membersTable.id, memberId));
    expect(member?.austritt?.toISOString().slice(0, 10)).toBe("2026-12-31");

    const [membership] = await db()
      .select()
      .from(memberAbteilungenTable)
      .where(eq(memberAbteilungenTable.memberId, memberId));
    expect(membership?.austrittsdatum).toBe("2026-12-31");

    const [mandate] = await db()
      .select()
      .from(sepaMandatesTable)
      .where(eq(sepaMandatesTable.id, mandateId));
    expect(mandate?.widerrufenAm?.toISOString().slice(0, 10)).toBe("2026-12-31");

    const [receipt] = await db()
      .select()
      .from(memberCancellationsTable)
      .where(eq(memberCancellationsTable.memberId, memberId));
    expect(receipt?.noticeReceivedOn).toBe("2026-06-01");
    expect(receipt?.effectiveDate).toBe("2026-12-31");
    expect(receipt?.computedEffectiveDate).toBe("2026-12-31");
    expect(receipt?.overridden).toBe(false);
    expect(receipt?.dateMode).toBe("year_end");
    expect(receipt?.noticeDays).toBe(42);
    expect(receipt?.statuteReference).toBe("§ 3 Abs. 2");
    expect(receipt?.revokedAt).toBeNull();

    // The evidence became a real attachment and the ticket was consumed.
    const [attachment] = await db()
      .select()
      .from(attachmentsTable)
      .where(eq(attachmentsTable.id, receipt!.evidenceAttachmentId));
    expect(attachment?.kind).toBe("cancellation_notice");
    expect(
      await db().select().from(pendingUploadsTable).where(eq(pendingUploadsTable.id, uploadId)),
    ).toHaveLength(0);

    const [audit] = await db()
      .select()
      .from(auditLogTable)
      .where(eq(auditLogTable.id, receipt!.auditId!));
    expect(audit?.changes.kuendigungEingang).toEqual({ before: null, after: "2026-06-01" });

    // Reaktivierung reverses the cascade and marks the receipt as withdrawn.
    await call(appRouter.members.reactivate, { memberId }, { context: context() });
    const [afterReactivate] = await db()
      .select()
      .from(memberCancellationsTable)
      .where(eq(memberCancellationsTable.id, receipt!.id));
    expect(afterReactivate?.revokedAt).not.toBeNull();
  });

  it("rejects a deviating Austrittstermin without a reason", async () => {
    const uploadId = await issueTicket();
    const [current] = await db().select().from(membersTable).where(eq(membersTable.id, memberId));

    await expect(
      call(
        appRouter.cancellations.record,
        {
          memberId,
          uploadId,
          noticeReceivedOn: "2026-06-01",
          overrideEffectiveDate: "2026-06-30",
          overrideReason: null,
          revokeSepa: false,
          evidenceConfirmed: true,
          expectedUpdatedAt: current!.updatedAt.toISOString(),
        },
        { context: context() },
      ),
    ).rejects.toThrow(/Begründung/);
  });

  it("records a justified deviation instead of silently applying it", async () => {
    const uploadId = await issueTicket();
    const [current] = await db().select().from(membersTable).where(eq(membersTable.id, memberId));

    const result = await call(
      appRouter.cancellations.record,
      {
        memberId,
        uploadId,
        noticeReceivedOn: "2026-06-01",
        overrideEffectiveDate: "2026-06-30",
        overrideReason: "Aufhebungsvereinbarung vom 01.06.2026",
        revokeSepa: false,
        evidenceConfirmed: true,
        expectedUpdatedAt: current!.updatedAt.toISOString(),
      },
      { context: context() },
    );
    expect(result.effectiveDate).toBe("2026-06-30");
    expect(result.computedEffectiveDate).toBe("2026-12-31");

    const rows = await call(
      appRouter.cancellations.recordedForMember,
      { memberId },
      { context: context() },
    );
    const latest = rows[0];
    expect(latest?.overridden).toBe(true);
    expect(latest?.effectiveDate).toBe("2026-06-30");
    expect(latest?.computedEffectiveDate).toBe("2026-12-31");
    expect(latest?.overrideReason).toBe("Aufhebungsvereinbarung vom 01.06.2026");
  });
});
