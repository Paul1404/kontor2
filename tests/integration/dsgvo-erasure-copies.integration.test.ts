import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "~/server/db/client";
import { emailLogTable } from "~/server/db/schema/email-log";
import { membersTable } from "~/server/db/schema/members";
import {
  membershipApplicationFilesTable,
  membershipApplicationsTable,
} from "~/server/db/schema/membership-applications";
import { portalChangeRequestsTable } from "~/server/db/schema/portal";
import { rundschreibenRecipientsTable, rundschreibenTable } from "~/server/db/schema/rundschreiben";
import { executeErasure } from "~/server/dsgvo/erasure";

vi.mock("~/server/s3/client", () => ({ deleteObject: vi.fn(async () => undefined) }));

const onTestDb = process.env.DATABASE_URL?.includes("svuwv_test") ?? false;
const MARKER = `ErasureCopies-${Date.now()}`;

describe.skipIf(!onTestDb)("DSGVO erasure removes derived PII copies (integration)", () => {
  let memberId = "";
  let applicationId = "";
  let rundschreibenId = "";

  beforeAll(async () => {
    const [maxRow] = await db()
      .select({ max: sql<number>`coalesce(max(${membersTable.adrNr}), 0)::int` })
      .from(membersTable);
    const [member] = await db()
      .insert(membersTable)
      .values({
        adrNr: (maxRow?.max ?? 0) + 1,
        memberNo: `${MARKER}-M`,
        vorname: "Erika",
        nachname: MARKER,
        email: `${MARKER}@example.test`,
      })
      .returning({ id: membersTable.id });
    memberId = member!.id;

    const [application] = await db()
      .insert(membershipApplicationsTable)
      .values({
        antragsnummer: `${MARKER}-ANT`,
        antragstyp: "einzel",
        status: "genehmigt",
        mitgliedschaftTyp: "erwachsener",
        vorname: "Erika",
        nachname: MARKER,
        geburtsdatum: new Date("1990-01-01"),
        email: `${MARKER}@example.test`,
        memberId,
        mitgliedsnummer: `${MARKER}-M`,
      })
      .returning({ id: membershipApplicationsTable.id });
    applicationId = application!.id;
    await db()
      .insert(membershipApplicationFilesTable)
      .values({
        applicationId,
        kind: "signed_scan",
        s3Key: `test/${MARKER}.pdf`,
        filename: `${MARKER}.pdf`,
      });
    await db()
      .insert(emailLogTable)
      .values({
        kind: "antrag_confirmation",
        status: "failed",
        recipient: `${MARKER}@example.test`,
        subject: `Antrag ${MARKER}`,
        bodyText: `Hallo ${MARKER}`,
        bodyHtml: `<p>Hallo ${MARKER}</p>`,
        attachmentNames: [`${MARKER}.pdf`],
        detail: "private provider error",
        entityType: "membership_application",
        entityId: applicationId,
      });

    await db()
      .insert(portalChangeRequestsTable)
      .values({
        memberId,
        submittedIp: "192.0.2.1",
        payload: { email: { before: "old@example.test", after: "new@example.test" } },
        reviewerNotes: "enthält Namen",
      });

    const [mail] = await db()
      .insert(rundschreibenTable)
      .values({ subject: MARKER, body: "Test" })
      .returning({ id: rundschreibenTable.id });
    rundschreibenId = mail!.id;
    await db()
      .insert(rundschreibenRecipientsTable)
      .values({
        rundschreibenId,
        memberId,
        email: `${MARKER}@example.test`,
        name: `Erika ${MARKER}`,
        status: "failed",
        error: "private delivery detail",
      });
  });

  afterAll(async () => {
    if (applicationId)
      await db().delete(emailLogTable).where(eq(emailLogTable.entityId, applicationId));
    if (rundschreibenId)
      await db().delete(rundschreibenTable).where(eq(rundschreibenTable.id, rundschreibenId));
    if (applicationId)
      await db()
        .delete(membershipApplicationsTable)
        .where(eq(membershipApplicationsTable.id, applicationId));
    if (memberId) await db().delete(membersTable).where(eq(membersTable.id, memberId));
  });

  it("deletes application documents and scrubs portal and circular-mail copies", async () => {
    await executeErasure(db(), memberId, {
      forceOverride: true,
      overrideReason: "integration test",
    });

    const [applications, files, [portal], [recipient], [emailLog]] = await Promise.all([
      db()
        .select({ id: membershipApplicationsTable.id })
        .from(membershipApplicationsTable)
        .where(eq(membershipApplicationsTable.id, applicationId)),
      db()
        .select({ id: membershipApplicationFilesTable.id })
        .from(membershipApplicationFilesTable)
        .where(eq(membershipApplicationFilesTable.applicationId, applicationId)),
      db()
        .select({
          payload: portalChangeRequestsTable.payload,
          submittedIp: portalChangeRequestsTable.submittedIp,
          reviewerNotes: portalChangeRequestsTable.reviewerNotes,
        })
        .from(portalChangeRequestsTable)
        .where(eq(portalChangeRequestsTable.memberId, memberId)),
      db()
        .select({
          email: rundschreibenRecipientsTable.email,
          name: rundschreibenRecipientsTable.name,
          error: rundschreibenRecipientsTable.error,
        })
        .from(rundschreibenRecipientsTable)
        .where(eq(rundschreibenRecipientsTable.memberId, memberId)),
      db()
        .select({
          recipient: emailLogTable.recipient,
          subject: emailLogTable.subject,
          bodyText: emailLogTable.bodyText,
          bodyHtml: emailLogTable.bodyHtml,
          attachmentNames: emailLogTable.attachmentNames,
          detail: emailLogTable.detail,
        })
        .from(emailLogTable)
        .where(eq(emailLogTable.entityId, applicationId)),
    ]);
    expect(applications).toHaveLength(0);
    expect(files).toHaveLength(0);
    expect(portal).toMatchObject({ payload: {}, submittedIp: null, reviewerNotes: null });
    expect(recipient).toMatchObject({
      email: `erased+${memberId}@invalid.local`,
      name: null,
      error: null,
    });
    expect(emailLog).toEqual({
      recipient: null,
      subject: null,
      bodyText: null,
      bodyHtml: null,
      attachmentNames: null,
      detail: null,
    });
  });
});
