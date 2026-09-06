import { formatDate } from "~/lib/format";
import type { ManualLetterOptions } from "~/lib/manual-letter";
import type { DB } from "~/server/db/client";
import { allocateDocRef } from "~/server/db/doc-ref";
import { organizationSettingsTable } from "~/server/db/schema/organization-settings";
import { type EMAIL_KIND, recordEmail } from "~/server/mail/email-log";
import type { MailBlock } from "~/server/mail/layout";
import { resolveClubLogo } from "~/server/pdf/logo";
import { renderPdfBase64 } from "~/server/pdf/renderer";
import { MitteilungDocument } from "~/server/pdf/templates/mitteilung";
import { deleteObject, putObject } from "~/server/s3/client";

export type PostalRecipient = {
  memberId: string;
  /** Address block, already in the order it should print. */
  recipientLines: string[];
  /** Mitgliedsnummer or comparable reference for the info block. */
  reference: string;
  referenceLabel?: string;
};

/**
 * A member has an email address that mail can actually reach. Anything else is
 * the postal case: no address at all, an unusable one, or one a mail server has
 * already rejected as permanently unreachable.
 */
export function canReachByEmail(member: {
  email?: string | null;
  emailUndeliverableAt?: Date | null;
}): boolean {
  const email = member.email?.trim() ?? "";
  return email.includes("@") && member.emailUndeliverableAt == null;
}

/**
 * Produce the paper version of a member notification and record that it was
 * produced. The content comes from the same blocks as the email, so the two
 * channels cannot say different things.
 *
 * The log entry is what makes "the member was informed" answerable regardless
 * of channel. It is deliberately `printed` rather than `sent`: the PDF exists,
 * but carrying it to a letterbox stays a human act, and the protocol should not
 * claim more than actually happened.
 */
export async function notifyByPost(
  db: DB,
  input: {
    kind: (typeof EMAIL_KIND)[keyof typeof EMAIL_KIND];
    recipient: PostalRecipient;
    subject: string;
    greeting: string | null;
    blocks: MailBlock[];
    closing?: string | null;
    letterOptions?: ManualLetterOptions;
    /** Plain text of the same content, stored so the protocol can show it. */
    bodyText: string;
    /** Documents travelling in the same envelope, named on the letter. */
    enclosures?: string[];
    actorEmail?: string | null;
    requestId?: string | null;
  },
): Promise<{ docRef: string; filename: string; base64: string }> {
  const [org] = await db.select().from(organizationSettingsTable).limit(1);
  const vereinsname = org?.vereinsname ?? "Verein";
  const senderLine = [
    vereinsname,
    org?.anschriftStrasse,
    [org?.anschriftPlz, org?.anschriftOrt].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join(" · ");

  const options = input.letterOptions;
  const closing = input.closing === undefined ? "Freundliche Grüße" : input.closing;
  const signatureLines = [
    options?.senderName || vereinsname,
    options?.senderTitle,
    options?.contact,
  ].filter((line): line is string => Boolean(line));
  const now = new Date();
  const docRef = await allocateDocRef(db, "MT", now.getUTCFullYear());
  const { base64 } = await renderPdfBase64(
    MitteilungDocument({
      club: {
        vereinsname,
        senderLine: options?.returnAddress || senderLine,
        logoDataUri: resolveClubLogo(org?.logo),
      },
      docRef,
      model: {
        recipientLines: input.recipient.recipientLines,
        reference: input.recipient.reference,
        referenceLabel: input.recipient.referenceLabel ?? "Mitgliedsnummer",
        datum: formatDate(options?.letterDate ?? now),
        subject: input.subject,
        greeting: input.greeting,
        blocks: input.blocks,
        closing,
        signatureLines,
        signatureSpace: options?.signatureSpace,
        enclosures: input.enclosures,
      },
    }),
  );

  const filename = `${input.subject.replace(/[^\w.-]+/g, "-")}-${docRef}.pdf`;
  // Keep the letter. Without this it exists only as a download, and a second
  // attempt mints a second document reference for the same message.
  const s3Key = `members/${input.recipient.memberId}/letters/${docRef}/${filename}`;
  await putObject({
    key: s3Key,
    body: Buffer.from(base64, "base64"),
    contentType: "application/pdf",
  });

  try {
    await recordEmail(
      {
        kind: input.kind,
        channel: "post",
        status: "printed",
        recipient: input.recipient.recipientLines.join(", "),
        subject: input.subject,
        bodyText: options
          ? [
              `Briefdatum: ${formatDate(options.letterDate ?? now)}`,
              `Rücksendeadresse: ${options.returnAddress || senderLine}`,
              input.bodyText,
              closing ? [closing, ...signatureLines].join("\n") : null,
              input.enclosures?.length ? `Anlagen: ${input.enclosures.join("; ")}` : null,
            ]
              .filter(Boolean)
              .join("\n\n")
          : input.bodyText,
        attachmentNames: [`${docRef}.pdf`, ...(input.enclosures ?? [])],
        detail: docRef,
        entityType: "member",
        entityId: input.recipient.memberId,
        documentS3Key: s3Key,
        documentFilename: filename,
        actorEmail: input.actorEmail ?? null,
        requestId: input.requestId ?? null,
      },
      db,
    );
  } catch (error) {
    // Leave no orphaned object behind when the row cannot be written.
    await deleteObject(s3Key).catch(() => {});
    throw error;
  }

  return { docRef, filename, base64 };
}

/** Address block for a member, in the order DIN 5008 expects. */
export function recipientLinesFor(member: {
  anrede?: string | null;
  vorname?: string | null;
  nachname?: string | null;
  firma1?: string | null;
  strasse?: string | null;
  hausnummer?: string | null;
  plz?: string | null;
  ort?: string | null;
}): string[] {
  const name =
    [member.vorname, member.nachname].filter(Boolean).join(" ") || member.firma1?.trim() || "";
  return [
    member.anrede?.trim() || null,
    name || null,
    [member.strasse, member.hausnummer].filter(Boolean).join(" ") || null,
    [member.plz, member.ort].filter(Boolean).join(" ") || null,
  ].filter((line): line is string => Boolean(line));
}

/** True when the address is complete enough to actually post something. */
export function hasPostalAddress(member: {
  strasse?: string | null;
  plz?: string | null;
  ort?: string | null;
}): boolean {
  return Boolean(member.strasse?.trim() && member.plz?.trim() && member.ort?.trim());
}
