import { ORPCError } from "@orpc/server";
import { and, desc, eq, inArray, ne, or, sql } from "drizzle-orm";
import { appendAudit, type Changes } from "~/server/audit/log";
import type { DBOrTx } from "~/server/db/client";
import { attachmentsTable } from "~/server/db/schema/attachments";
import { auditLogTable } from "~/server/db/schema/audit";
import { memberBankDetailChangesTable } from "~/server/db/schema/bank-detail-changes";
import { contractsTable } from "~/server/db/schema/contracts";
import { dsgvoConsentLogTable, dsgvoRequestsTable } from "~/server/db/schema/dsgvo";
import { dunningItemsTable } from "~/server/db/schema/dunning";
import { emailLogTable } from "~/server/db/schema/email-log";
import { feeRunItemsTable, sollStellungenTable } from "~/server/db/schema/fee-runs";
import { memberSourceRecordsTable } from "~/server/db/schema/member-source-records";
import { membersTable } from "~/server/db/schema/members";
import {
  membershipApplicationFilesTable,
  membershipApplicationsTable,
} from "~/server/db/schema/membership-applications";
import { portalChangeRequestsTable } from "~/server/db/schema/portal";
import { relationshipsTable } from "~/server/db/schema/relationships";
import { rundschreibenRecipientsTable } from "~/server/db/schema/rundschreiben";
import { sepaMandatesTable } from "~/server/db/schema/sepa";
import { memberSnapshotsTable } from "~/server/db/schema/snapshots";
import { buildScrubRules, earliestErasureDate } from "~/server/dsgvo/policy";
import { logger } from "~/server/lib/logger";
import { deleteObject } from "~/server/s3/client";

export type ErasureDiffEntry = {
  column: string;
  before: string | null;
  after: string | null;
};

export type ErasureRetention = {
  lastFinancialEventAt: string | null;
  earliestErasureDate: string;
  retentionExpired: boolean;
};

export type ErasurePreview = {
  memberId: string;
  diff: ErasureDiffEntry[];
  retention: ErasureRetention;
};

function valueToString(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

async function lastFinancialEventAt(db: DBOrTx, memberId: string): Promise<Date | null> {
  const [feeRow] = await db
    .select({ ts: sql<Date | null>`max(${sollStellungenTable.createdAt})` })
    .from(sollStellungenTable)
    .where(eq(sollStellungenTable.memberId, memberId));
  const [itemRow] = await db
    .select({ ts: sql<Date | null>`max(${feeRunItemsTable.createdAt})` })
    .from(feeRunItemsTable)
    .where(eq(feeRunItemsTable.memberId, memberId));
  const [sepaRow] = await db
    .select({ ts: sql<Date | null>`max(${sepaMandatesTable.letzteVerwendung})` })
    .from(sepaMandatesTable)
    .where(eq(sepaMandatesTable.memberId, memberId));
  const candidates = [feeRow?.ts ?? null, itemRow?.ts ?? null, sepaRow?.ts ?? null].filter(
    (v): v is Date => v != null,
  );
  if (candidates.length === 0) return null;
  return candidates.reduce((a, b) => (a > b ? a : b));
}

export async function previewErasure(db: DBOrTx, memberId: string): Promise<ErasurePreview> {
  const [member] = await db
    .select()
    .from(membersTable)
    .where(eq(membersTable.id, memberId))
    .limit(1);
  if (!member) throw new ORPCError("NOT_FOUND", { message: "Mitglied nicht gefunden." });

  const rules = buildScrubRules(memberId);
  const diff: ErasureDiffEntry[] = [];
  for (const [col, rule] of Object.entries(rules)) {
    const before = (member as unknown as Record<string, unknown>)[col];
    const beforeStr = valueToString(before);
    const after = rule.kind === "null" ? null : rule.value;
    if (beforeStr === after) continue;
    diff.push({ column: col, before: beforeStr, after });
  }

  const last = await lastFinancialEventAt(db, memberId);
  const earliest = earliestErasureDate({
    austritt: member.austritt as Date | null,
    verstorbenAm: member.verstorbenAm as Date | null,
    lastFinancialEventAt: last,
  });

  return {
    memberId,
    diff,
    retention: {
      lastFinancialEventAt: last?.toISOString() ?? null,
      earliestErasureDate: earliest.toISOString(),
      retentionExpired: earliest.getTime() <= Date.now(),
    },
  };
}

export type ExecuteErasureOpts = {
  forceOverride?: boolean;
  overrideReason?: string;
  requestId?: string | null;
  actorId?: string | null;
  actorEmail?: string | null;
};

export type ErasureResult = {
  memberId: string;
  appliedDiff: ErasureDiffEntry[];
  auditId: string | null;
  overridden: boolean;
};

export async function executeErasure(
  db: DBOrTx,
  memberId: string,
  opts: ExecuteErasureOpts = {},
): Promise<ErasureResult> {
  const preview = await previewErasure(db, memberId);
  if (!preview.retention.retentionExpired && !opts.forceOverride) {
    throw new ORPCError("PRECONDITION_FAILED", {
      message: `Aufbewahrungsfrist nicht abgelaufen (frühestens ${preview.retention.earliestErasureDate}). Override erforderlich.`,
    });
  }
  if (!preview.retention.retentionExpired && opts.forceOverride && !opts.overrideReason?.trim()) {
    throw new ORPCError("PRECONDITION_FAILED", { message: "Override-Begründung erforderlich." });
  }

  const rules = buildScrubRules(memberId);
  const updates: Record<string, unknown> = {};
  for (const [col, rule] of Object.entries(rules)) {
    updates[col] = rule.kind === "null" ? null : rule.value;
  }
  updates.updatedAt = new Date();

  // Everything below is one transaction: a mid-flight failure must not leave a
  // half-erased member (e.g. the members row pseudonymized but the plaintext
  // `member_source_records.raw` still present). S3 object deletes are collected
  // here and run only after the transaction commits, so storage is never
  // cleared for an erasure that then rolled back.
  const s3KeysToDelete: string[] = [];
  let auditId: string | null = null;

  await db.transaction(async (tx) => {
    const [sourceMember] = await tx
      .select({
        memberNo: membersTable.memberNo,
        kontaktNo: membersTable.kontaktNo,
        mitgliedsnummer: membersTable.mitgliedsnummer,
      })
      .from(membersTable)
      .where(eq(membersTable.id, memberId))
      .limit(1);
    const sourceRef =
      sourceMember?.memberNo ?? sourceMember?.kontaktNo ?? sourceMember?.mitgliedsnummer ?? null;
    await tx.update(membersTable).set(updates).where(eq(membersTable.id, memberId));

    // Pseudonymizing the members row is not enough: the same personal data is
    // copied into several derived stores. Clear every copy so none survives.

    // 1. Verbatim Linear provenance -- `raw` holds the original dump row in
    //    plaintext (names, address, possibly IBAN).
    const deletedSource = await tx
      .delete(memberSourceRecordsTable)
      .where(eq(memberSourceRecordsTable.memberId, memberId))
      .returning({ id: memberSourceRecordsTable.id });

    // 2. Member snapshots store a full JSONB copy of the row at every change.
    const deletedSnapshots = await tx
      .delete(memberSnapshotsTable)
      .where(eq(memberSnapshotsTable.memberId, memberId))
      .returning({ id: memberSnapshotsTable.id });

    // 3. Dunning items (Mahnungen) are accounting documents and must be kept per
    //    §147 AO (10 Jahre). Do NOT delete them; keep the financial skeleton
    //    (docRef, amounts, sollIds, dates) and null only the embedded PII: the
    //    rendered Mahnung PDF (name/address), its filename and the recipient.
    const scrubbedDunning = await tx
      .update(dunningItemsTable)
      .set({ pdfBase64: null, pdfFilename: null, sentTo: null })
      .where(eq(dunningItemsTable.memberId, memberId))
      .returning({ id: dunningItemsTable.id });

    // 4. Relationship rows carry name/contact/notes in plaintext (the Linear
    //    `verkn` payload). Scrub both directions: rows where this member is the
    //    linked party (`toMemberId`) AND the member's own outgoing rows
    //    (`fromMemberId`), which describe a third party tied to the erased
    //    member. The rows stay so the other side keeps its structural link.
    const scrubbedRels = await tx
      .update(relationshipsTable)
      .set({
        name: null,
        nachname: null,
        anrede: null,
        telefon: null,
        email: null,
        fax: null,
        vEmail: null,
        funktion: null,
        notiz: null,
        matchcode: null,
      })
      .where(
        or(
          eq(relationshipsTable.toMemberId, memberId),
          eq(relationshipsTable.fromMemberId, memberId),
        ),
      )
      .returning({ id: relationshipsTable.id });

    // 4b. Contracts hold the alternative account holder's name, account, bank
    //     and full postal address (the `*Kih` / `*V` columns) plus free-text
    //     purposes that can contain names. Null them so an Art. 17 erasure
    //     leaves no bank/third-party PII behind; the row stays for history.
    const scrubbedContracts = await tx
      .update(contractsTable)
      .set({
        ktoInhV: null,
        kontoV: null,
        blzV: null,
        bankV: null,
        abwKontoInh: null,
        strasseKih: null,
        plzKih: null,
        ortKih: null,
        emailKih: null,
        verwZw1: null,
        verwZw2: null,
        verwZw3: null,
        verwZw4: null,
      })
      .where(eq(contractsTable.memberId, memberId))
      .returning({ id: contractsTable.id });

    // 4c. Attachments are member-uploaded documents (ID scans, signed forms)
    //     that the Auskunft hands back as full files. Delete the rows now and
    //     queue the S3 objects for deletion after the transaction commits. The
    //     member row is only scrubbed, not deleted, so the FK cascade would
    //     never fire on its own.
    const memberAttachments = await tx
      .select({ id: attachmentsTable.id, s3Key: attachmentsTable.s3Key })
      .from(attachmentsTable)
      .where(eq(attachmentsTable.memberId, memberId));
    for (const a of memberAttachments) s3KeysToDelete.push(a.s3Key);
    // Bank-change receipts intentionally protect their evidence during normal
    // operation. Once the DSGVO retention gate above permits erasure, remove
    // those linking rows first so the evidence FK no longer blocks deletion.
    await tx
      .delete(memberBankDetailChangesTable)
      .where(eq(memberBankDetailChangesTable.memberId, memberId));
    const deletedAttachments =
      memberAttachments.length > 0
        ? await tx
            .delete(attachmentsTable)
            .where(eq(attachmentsTable.memberId, memberId))
            .returning({ id: attachmentsTable.id })
        : [];

    // 4d. Consent log: keep the structural record (type, granted, when) for
    //     accountability, but null the free-text `evidence`, which can name the
    //     member or describe a signed form.
    const scrubbedConsent = await tx
      .update(dsgvoConsentLogTable)
      .set({ evidence: null })
      .where(eq(dsgvoConsentLogTable.memberId, memberId))
      .returning({ id: dsgvoConsentLogTable.id });

    // 4e. Once the common retention gate above permits erasure, an approved
    // membership application is no longer a second permanent member record.
    // Delete its database row (tokens/files cascade) and queue every stored PDF,
    // scan and signature for post-commit S3 deletion. A forced legal override is
    // deliberately handled identically and remains visible in the erasure audit.
    // Older family approvals only linked the primary member in `member_id`, but
    // stored all created M-/K-references comma-separated in `mitgliedsnummer`.
    // Include an exact token match so erasing a partner, child or guardian also
    // removes the source application. New data should keep this stable reference
    // until a normalized application-member link table replaces the legacy field.
    const applicationMatch = or(
      eq(membershipApplicationsTable.memberId, memberId),
      sourceRef
        ? sql`${sourceRef} = any(string_to_array(replace(${membershipApplicationsTable.mitgliedsnummer}, ' ', ''), ','))`
        : undefined,
    );
    const applicationFiles = await tx
      .select({
        id: membershipApplicationFilesTable.id,
        s3Key: membershipApplicationFilesTable.s3Key,
      })
      .from(membershipApplicationFilesTable)
      .innerJoin(
        membershipApplicationsTable,
        eq(membershipApplicationsTable.id, membershipApplicationFilesTable.applicationId),
      )
      .where(applicationMatch);
    for (const file of applicationFiles) s3KeysToDelete.push(file.s3Key);
    const deletedApplications = await tx
      .delete(membershipApplicationsTable)
      .where(applicationMatch)
      .returning({ id: membershipApplicationsTable.id });

    // 4f. Portal review payloads duplicate the member's before/after values and
    // source IP. Keep workflow timestamps/status for accountability, but remove
    // the identifying payload once the member itself is erased.
    const scrubbedPortalRequests = await tx
      .update(portalChangeRequestsTable)
      .set({ payload: {}, submittedIp: null, reviewerNotes: null })
      .where(eq(portalChangeRequestsTable.memberId, memberId))
      .returning({ id: portalChangeRequestsTable.id });

    // 4g. Circular-mail delivery history needs aggregate delivery counts, not a
    // permanent address book. Preserve the row and outcome while replacing the
    // required email field and clearing free-text recipient/error data.
    const scrubbedCircularRecipients = await tx
      .update(rundschreibenRecipientsTable)
      .set({
        email: `erased+${memberId}@invalid.local`,
        name: null,
        error: null,
      })
      .where(eq(rundschreibenRecipientsTable.memberId, memberId))
      .returning({ id: rundschreibenRecipientsTable.id });

    // 4h. The central mail log intentionally outlives the workflow rows it
    // references, so cascades cannot remove copied recipient addresses. Keep
    // delivery status/timestamps for operational accountability while clearing
    // recipient, subject and provider error text for every member-linked entity.
    const mailTargets = [
      { entityType: "member", ids: [memberId] },
      { entityType: "membership_application", ids: deletedApplications.map((row) => row.id) },
      { entityType: "portal_change_request", ids: scrubbedPortalRequests.map((row) => row.id) },
      { entityType: "dunning_item", ids: scrubbedDunning.map((row) => row.id) },
    ];
    let scrubbedEmailLogs = 0;
    for (const target of mailTargets) {
      if (target.ids.length === 0) continue;
      const rows = await tx
        .update(emailLogTable)
        .set({ recipient: null, subject: null, detail: null })
        .where(
          and(
            eq(emailLogTable.entityType, target.entityType),
            inArray(emailLogTable.entityId, target.ids),
          ),
        )
        .returning({ id: emailLogTable.id });
      scrubbedEmailLogs += rows.length;
    }

    // The erasure audit entry records WHAT was cleared, never the cleared values
    // -- the before-values are exactly the PII we are removing.
    const changes: Changes = {
      __scrubbedColumns: { before: null, after: preview.diff.map((d) => d.column).join(", ") },
    };
    if (deletedSource.length > 0)
      changes.__sourceRecords = { before: `${deletedSource.length}`, after: null };
    if (deletedSnapshots.length > 0)
      changes.__snapshots = { before: `${deletedSnapshots.length}`, after: null };
    if (scrubbedDunning.length > 0)
      changes.__dunningItems = { before: `${scrubbedDunning.length} scrubbed`, after: null };
    if (scrubbedRels.length > 0)
      changes.__relationships = { before: `${scrubbedRels.length}`, after: null };
    if (scrubbedContracts.length > 0)
      changes.__contracts = { before: `${scrubbedContracts.length}`, after: null };
    if (deletedAttachments.length > 0)
      changes.__attachments = { before: `${deletedAttachments.length}`, after: null };
    if (scrubbedConsent.length > 0)
      changes.__consentEvidence = { before: `${scrubbedConsent.length} scrubbed`, after: null };
    if (deletedApplications.length > 0)
      changes.__applications = { before: `${deletedApplications.length}`, after: null };
    if (scrubbedPortalRequests.length > 0)
      changes.__portalRequests = {
        before: `${scrubbedPortalRequests.length} scrubbed`,
        after: null,
      };
    if (scrubbedCircularRecipients.length > 0)
      changes.__circularRecipients = {
        before: `${scrubbedCircularRecipients.length} scrubbed`,
        after: null,
      };
    if (scrubbedEmailLogs > 0)
      changes.__emailLogs = { before: `${scrubbedEmailLogs} scrubbed`, after: null };
    if (opts.forceOverride && opts.overrideReason) {
      changes.__override = { before: null, after: opts.overrideReason };
    }

    auditId = await appendAudit(tx, {
      entityType: "member",
      entityId: memberId,
      action: "dsgvo_erasure",
      source: "dsgvo",
      actorId: opts.actorId ?? null,
      actorEmail: opts.actorEmail ?? null,
      changes,
      requestId: opts.requestId ?? null,
    });

    // 5. Redact the personal values still sitting in this member's earlier audit
    //    entries (before/after of past edits). Keep the rows and the erasure
    //    event for accountability; drop only the values.
    await tx
      .update(auditLogTable)
      .set({ changes: {} })
      .where(
        and(
          eq(auditLogTable.entityType, "member"),
          eq(auditLogTable.entityId, memberId),
          auditId ? ne(auditLogTable.id, auditId) : undefined,
        ),
      );

    if (opts.requestId) {
      await tx
        .update(dsgvoRequestsTable)
        .set({
          status: "completed",
          completedAt: new Date(),
          completedBy: opts.actorId ?? null,
        })
        .where(eq(dsgvoRequestsTable.id, opts.requestId));
    }
  });

  // Storage cleanup runs only after the DB state is durable. Best-effort: a
  // missing object must never resurrect the erased member's data.
  for (const s3Key of s3KeysToDelete) {
    try {
      await deleteObject(s3Key);
    } catch (err) {
      logger.warn("dsgvo erasure: attachment S3 delete failed", {
        err: err instanceof Error ? err.message : String(err),
        s3Key,
        memberId,
      });
    }
  }

  return {
    memberId,
    appliedDiff: preview.diff,
    auditId,
    overridden: !!opts.forceOverride && !preview.retention.retentionExpired,
  };
}

/**
 * Quick lookup of the most recent erasure audit entry for a member (for UI:
 * "Anonymisiert am 12.05.2026 durch admin@verein.de").
 */
export async function lastErasureAudit(db: DBOrTx, memberId: string) {
  const rows = await db
    .select()
    .from(auditLogTable)
    .where(eq(auditLogTable.entityId, memberId))
    .orderBy(desc(auditLogTable.createdAt))
    .limit(50);
  return rows.find((r) => r.action === "dsgvo_erasure") ?? null;
}
