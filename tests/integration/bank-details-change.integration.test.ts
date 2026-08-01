import { call } from "@orpc/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Session } from "~/server/auth/auth";
import { db } from "~/server/db/client";
import { attachmentsTable, pendingUploadsTable } from "~/server/db/schema/attachments";
import { auditLogTable } from "~/server/db/schema/audit";
import { users } from "~/server/db/schema/auth";
import { memberBankDetailChangesTable } from "~/server/db/schema/bank-detail-changes";
import { membersTable } from "~/server/db/schema/members";
import { memberSnapshotsTable } from "~/server/db/schema/snapshots";
import type { AppContext } from "~/server/orpc/context";
import { appRouter } from "~/server/orpc/router";

vi.mock("~/server/s3/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("~/server/s3/client")>();
  const body = Buffer.from("%PDF-1.7 bank change request");
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
const MARKER = `BankChange-${Date.now()}`;
const ACTOR_ID = `${MARKER}-actor`;
let memberId = "";
let uploadId = "";

function context(): AppContext {
  const session = {
    session: { id: "test", userId: ACTOR_ID },
    user: { id: ACTOR_ID, email: "bank-change@test.local", role: "vorstand" },
  } as unknown as Session;
  return {
    db: db(),
    session,
    headers: new Headers(),
    tenant: { key: "svu", databaseUrl: "" },
    requestId: "bank-change-test",
  };
}

describe.skipIf(!onTestDb)("bank details change (integration)", () => {
  beforeAll(async () => {
    await db().insert(users).values({
      id: ACTOR_ID,
      name: "Bank Change Integration",
      email: "bank-change@test.local",
      emailVerified: true,
      role: "vorstand",
    });
    const [member] = await db()
      .insert(membersTable)
      .values({
        adrNr: 8_800_000 + Math.floor(Math.random() * 100_000),
        memberNo: `M-${Date.now()}`,
        vorname: "Berta",
        nachname: MARKER,
        email: "berta@example.test",
        iban1: "DE89370400440532013000",
        iban1Last4: "3000",
      })
      .returning();
    memberId = member!.id;
    const body = Buffer.from("%PDF-1.7 bank change request");
    const [ticket] = await db()
      .insert(pendingUploadsTable)
      .values({
        memberId,
        kind: "bank_details_change",
        filename: "aenderung.pdf",
        mimeType: "application/pdf",
        sizeBytes: body.byteLength,
        s3Key: `test/${MARKER}.pdf`,
        requestedBy: ACTOR_ID,
        expiresAt: new Date(Date.now() + 60_000),
      })
      .returning();
    uploadId = ticket!.id;
  });

  afterAll(async () => {
    if (memberId) {
      await db()
        .delete(memberBankDetailChangesTable)
        .where(eq(memberBankDetailChangesTable.memberId, memberId));
      await db().delete(attachmentsTable).where(eq(attachmentsTable.memberId, memberId));
      await db().delete(memberSnapshotsTable).where(eq(memberSnapshotsTable.memberId, memberId));
      await db().delete(membersTable).where(eq(membersTable.id, memberId));
    }
    await db().delete(users).where(eq(users.id, ACTOR_ID));
  });

  it("atomically stores evidence, masked audit data, receipt, and snapshot", async () => {
    const [before] = await db().select().from(membersTable).where(eq(membersTable.id, memberId));
    const preview = await call(
      appRouter.bankDetails.confirmationPreview,
      {
        memberId,
        newIbanLast4: "9890",
        debitAction: "suspend",
      },
      { context: context() },
    );
    expect(preview.to).toBe("berta@example.test");
    expect(preview.body).toContain("•••• 9890");
    expect(preview.body).toContain("Der SEPA-Einzug ist vorerst ausgesetzt.");

    const result = await call(
      appRouter.bankDetails.applyChange,
      {
        memberId,
        uploadId,
        iban: "DE12500105170648489890",
        bic: "INGDDEFFXXX",
        accountHolder: "Berta Beispiel",
        requestedAt: "2026-08-01",
        note: "Per E-Mail bestätigt",
        debitAction: "suspend",
        evidenceConfirmed: true,
        sendConfirmationEmail: false,
        expectedUpdatedAt: before!.updatedAt.toISOString(),
      },
      { context: context() },
    );
    expect(result.confirmation.status).toBe("not_requested");

    const [member] = await db().select().from(membersTable).where(eq(membersTable.id, memberId));
    expect(member?.iban1).toBe("DE12500105170648489890");
    expect(member?.iban1Last4).toBe("9890");
    expect(member?.directDebitBlocked).toBe(true);

    const [receipt] = await db()
      .select()
      .from(memberBankDetailChangesTable)
      .where(eq(memberBankDetailChangesTable.memberId, memberId));
    expect(receipt?.previousIbanLast4).toBe("3000");
    expect(receipt?.newIbanLast4).toBe("9890");

    const [audit] = await db()
      .select()
      .from(auditLogTable)
      .where(eq(auditLogTable.id, receipt!.auditId!));
    const serializedAudit = JSON.stringify(audit?.changes);
    expect(serializedAudit).not.toContain("DE12500105170648489890");
    expect(serializedAudit).not.toContain("DE89370400440532013000");
    expect(audit?.changes.iban1).toEqual({ before: "3000", after: "9890" });

    const snapshots = await db()
      .select()
      .from(memberSnapshotsTable)
      .where(eq(memberSnapshotsTable.memberId, memberId));
    expect(snapshots.length).toBe(1);
    expect(
      await db().select().from(pendingUploadsTable).where(eq(pendingUploadsTable.id, uploadId)),
    ).toHaveLength(0);
  });

  it("issues a same-origin upload URL instead of a bucket URL", async () => {
    const ticket = await call(
      appRouter.attachments.requestUploadUrl,
      {
        memberId,
        filename: "aenderung.pdf",
        mimeType: "application/pdf",
        sizeBytes: 25,
        kind: "bank_details_change",
      },
      { context: context() },
    );

    expect(ticket.url).toBe(`/api/attachments-upload/${ticket.uploadId}`);
    expect(ticket.url).not.toMatch(/^https?:\/\//);
  });
});
