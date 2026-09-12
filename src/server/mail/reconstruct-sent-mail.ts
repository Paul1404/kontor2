import { and, between, desc, eq } from "drizzle-orm";
import type { DB } from "~/server/db/client";
import { memberBankDetailChangesTable } from "~/server/db/schema/bank-detail-changes";
import { memberSnapshotsTable } from "~/server/db/schema/snapshots";
import { loadMailOrganization } from "~/server/mail/branding";
import { paragraphsFromText, renderMail } from "~/server/mail/layout";
import {
  buildBankDetailsConfirmation,
  loadBankDetailsConfirmationOrganization,
} from "~/server/mail/send-bank-details-confirmation";

const MAX_CHANGE_DISTANCE_MS = 15 * 60 * 1000;

type HistoricalMail = {
  kind: string;
  entityType: string | null;
  entityId: string | null;
  recipient: string;
  subject: string;
  sentAt: Date;
  bodyText?: string | null;
  attachmentNames?: string[] | null;
};

export type ReconstructedMessageSnapshot = {
  bodyText: string;
  bodyHtml: string;
  attachmentNames: string[];
};

function snapshotMemberName(member: Record<string, unknown>): string {
  const value = (key: string) => (typeof member[key] === "string" ? member[key].trim() : "");
  return (
    [value("vorname"), value("nachname")].filter(Boolean).join(" ") ||
    value("kurzname") ||
    value("firma1") ||
    "Mitglied"
  );
}

/**
 * Rebuilds only messages whose historical inputs are preserved independently.
 * The result is deliberately labelled as reconstructed by the caller because
 * current organization branding is used and no original RFC822 message exists.
 */
export async function reconstructSentMessage(
  db: DB,
  expected: HistoricalMail,
): Promise<ReconstructedMessageSnapshot | null> {
  const legacyApplicationMail = {
    antrag_confirmation: { subline: "Aufnahmeantrag", closing: undefined },
    antrag_club_notification: { subline: "Interne Benachrichtigung", closing: null },
    antrag_approval: { subline: "Mitgliedschaft", closing: undefined },
  }[expected.kind];
  if (legacyApplicationMail && expected.bodyText) {
    const organization = await loadMailOrganization(db);
    const rendered = renderMail({
      organization,
      preheader: expected.subject,
      subline: legacyApplicationMail.subline,
      closing: legacyApplicationMail.closing,
      blocks: paragraphsFromText(expected.bodyText),
    });
    return {
      bodyText: rendered.text,
      bodyHtml: rendered.html,
      attachmentNames: expected.attachmentNames ?? [],
    };
  }

  if (
    expected.kind !== "bank_details_confirmation" ||
    expected.entityType !== "member" ||
    !expected.entityId
  ) {
    return null;
  }

  const from = new Date(expected.sentAt.getTime() - MAX_CHANGE_DISTANCE_MS);
  const to = new Date(expected.sentAt.getTime() + MAX_CHANGE_DISTANCE_MS);
  const candidates = await db
    .select({
      appliedAt: memberBankDetailChangesTable.appliedAt,
      newIbanLast4: memberBankDetailChangesTable.newIbanLast4,
      debitSuspended: memberBankDetailChangesTable.debitSuspended,
      member: memberSnapshotsTable.member,
    })
    .from(memberBankDetailChangesTable)
    .leftJoin(
      memberSnapshotsTable,
      eq(memberSnapshotsTable.auditId, memberBankDetailChangesTable.auditId),
    )
    .where(
      and(
        eq(memberBankDetailChangesTable.memberId, expected.entityId),
        between(memberBankDetailChangesTable.appliedAt, from, to),
      ),
    )
    .orderBy(desc(memberBankDetailChangesTable.appliedAt))
    .limit(10);
  const match = candidates
    .filter((candidate) => candidate.member !== null)
    .map((candidate) => ({
      ...candidate,
      distance: Math.abs(candidate.appliedAt.getTime() - expected.sentAt.getTime()),
    }))
    .sort((left, right) => left.distance - right.distance)[0];
  if (!match?.member || match.distance > MAX_CHANGE_DISTANCE_MS) return null;

  const organization = await loadBankDetailsConfirmationOrganization(db);
  const content = buildBankDetailsConfirmation({
    to: expected.recipient,
    memberName: snapshotMemberName(match.member),
    organization,
    newIbanLast4: match.newIbanLast4,
    debitSuspended: match.debitSuspended,
  });
  if (content.subject !== expected.subject) return null;
  return {
    bodyText: content.body,
    bodyHtml: content.html,
    attachmentNames: content.attachments.map((attachment) => attachment.filename),
  };
}
