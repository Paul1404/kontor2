/**
 * Vorstands-Benachrichtigung über neu aufgenommene Mitglieder.
 *
 * Beide Aufnahmewege lösen dieselbe Mail aus: die Genehmigung eines Antrags
 * (`applications.approve`) und die manuelle Neuanlage (`members.onboard`).
 * Ob und wohin sie geht, steht in den Vereins-Einstellungen. Die Mail ist
 * best-effort: eine Aufnahme darf niemals an einem SMTP-Problem scheitern,
 * deshalb wirft diese Funktion nicht und protokolliert jeden Ausgang im
 * Versandprotokoll.
 */

import { formatCurrency, formatDate } from "~/lib/format";
import { sendBrandedMail } from "~/server/auth/send-invite";
import type { DB } from "~/server/db/client";
import { organizationSettingsTable } from "~/server/db/schema/organization-settings";
import { logger } from "~/server/lib/logger";
import { EMAIL_KIND, recordEmail } from "~/server/mail/email-log";
import type { MailBlock } from "~/server/mail/layout";

/** Ein angelegter Datensatz: Anzeigename plus vergebene Nummer. */
export type NewMemberEntry = {
  name: string;
  /** Mitglieds- oder Kontaktnummer, so wie sie im Verein geführt wird. */
  reference: string;
};

export type NewMemberNotificationParams = {
  /** Hauptdatensatz, an dem die Mail im Versandprotokoll hängt. */
  memberId: string;
  /** Hauptperson zuerst, danach Partner, Kinder oder Erziehungsberechtigte. */
  members: NewMemberEntry[];
  /** Woher die Aufnahme kam. Steuert nur die Herkunftszeile. */
  origin: "antrag" | "manuell";
  /** Eintrittsdatum, `YYYY-MM-DD` oder Date. */
  eintritt?: Date | string | null;
  ort?: string | null;
  email?: string | null;
  /** Jahresbeitrag als Dezimalstring, so wie er gespeichert wird. */
  beitrag?: string | null;
  antragsnummer?: string | null;
  /** Benutzer, der die Aufnahme ausgelöst hat. */
  actorEmail?: string | null;
  requestId?: string | null;
};

const ORIGIN_LABEL: Record<NewMemberNotificationParams["origin"], string> = {
  antrag: "Genehmigter Aufnahmeantrag",
  manuell: "Manuelle Neuanlage in der Vereinsverwaltung",
};

/**
 * Empfänger der Benachrichtigung. Eigenes Postfach zuerst, danach die schon
 * gepflegten Adressen, damit ein Verein nichts doppelt eintragen muss.
 */
export function resolveNewMemberRecipient(org: {
  neumitgliedVorstandEmail: string | null;
  antragVorstandEmail: string | null;
  mitgliedschaftEmail: string | null;
  kontaktEmail: string | null;
}): string | null {
  const candidates = [
    org.neumitgliedVorstandEmail,
    org.antragVorstandEmail,
    org.mitgliedschaftEmail,
    org.kontaktEmail,
  ];
  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (value) return value;
  }
  return null;
}

export function newMemberSubject(members: NewMemberEntry[]): string {
  const primary = members[0];
  const name = primary?.name?.trim() || "Neuaufnahme";
  const reference = primary?.reference?.trim();
  const head = members.length > 1 ? `Neue Mitglieder: ${name}` : `Neues Mitglied: ${name}`;
  const suffix = members.length > 1 ? ` und ${members.length - 1} weitere` : "";
  return reference ? `${head}${suffix} (${reference})` : `${head}${suffix}`;
}

/** Body der Benachrichtigung. Ausgelagert, damit der Inhalt testbar bleibt. */
export function newMemberBlocks(params: NewMemberNotificationParams): MailBlock[] {
  const { members } = params;
  const references = members.map((m) => m.reference).filter(Boolean);
  const blocks: MailBlock[] = [
    {
      kind: "paragraph",
      text:
        members.length > 1
          ? "Es wurden neue Mitglieder aufgenommen."
          : "Es wurde ein neues Mitglied aufgenommen.",
    },
  ];
  if (references.length > 0) {
    blocks.push({
      kind: "callout",
      label: references.length > 1 ? "Mitgliedsnummern" : "Mitgliedsnummer",
      value: references.join(", "),
    });
  }

  const items = members.map((m) => (m.reference ? `${m.name} (${m.reference})` : m.name));
  blocks.push({ kind: "bullets", items });

  const details: string[] = [];
  const eintritt = formatDate(params.eintritt ?? null);
  if (eintritt) details.push(`Eintritt: ${eintritt}`);
  if (params.ort?.trim()) details.push(`Ort: ${params.ort.trim()}`);
  if (params.email?.trim()) details.push(`E-Mail: ${params.email.trim()}`);
  const beitrag = formatCurrency(params.beitrag ?? null);
  if (beitrag) details.push(`Jahresbeitrag: ${beitrag}`);
  if (params.antragsnummer?.trim()) details.push(`Antragsnummer: ${params.antragsnummer.trim()}`);
  details.push(`Herkunft: ${ORIGIN_LABEL[params.origin]}`);
  if (params.actorEmail?.trim()) details.push(`Erfasst von: ${params.actorEmail.trim()}`);
  blocks.push({ kind: "bullets", items: details });

  blocks.push({
    kind: "note",
    text: "Die vollständigen Daten stehen im Bereich Mitglieder.",
  });
  return blocks;
}

/**
 * Benachrichtigung senden, sofern eingeschaltet, und den Ausgang protokollieren.
 * Ist die Benachrichtigung abgeschaltet, passiert nichts und es wird auch nichts
 * protokolliert. Fehlt nur der Empfänger, entsteht ein übersprungener Eintrag,
 * damit im Versandprotokoll sichtbar bleibt, warum keine Mail ankam.
 */
export async function notifyVorstandNewMember(
  db: DB,
  params: NewMemberNotificationParams,
): Promise<void> {
  try {
    if (params.members.length === 0) return;
    const [org] = await db
      .select({
        neumitgliedBenachrichtigungAktiv:
          organizationSettingsTable.neumitgliedBenachrichtigungAktiv,
        neumitgliedVorstandEmail: organizationSettingsTable.neumitgliedVorstandEmail,
        antragVorstandEmail: organizationSettingsTable.antragVorstandEmail,
        mitgliedschaftEmail: organizationSettingsTable.mitgliedschaftEmail,
        kontaktEmail: organizationSettingsTable.kontaktEmail,
      })
      .from(organizationSettingsTable)
      .limit(1);
    if (!org?.neumitgliedBenachrichtigungAktiv) return;

    const subject = newMemberSubject(params.members);
    const base = {
      kind: EMAIL_KIND.newMemberNotification,
      subject,
      entityType: "member",
      entityId: params.memberId,
      actorEmail: params.actorEmail ?? null,
      requestId: params.requestId ?? null,
    };

    const recipient = resolveNewMemberRecipient(org);
    if (!recipient) {
      await recordEmail({ ...base, status: "skipped", detail: "no_recipient" }, db);
      return;
    }

    const res = await sendBrandedMail(db, {
      to: recipient,
      subject,
      document: {
        preheader: subject,
        subline: "Interne Benachrichtigung",
        greeting: null,
        // Der Verein schreibt sich selbst, also keine Grußformel.
        closing: null,
        blocks: newMemberBlocks(params),
      },
    });
    if (!res.ok && res.reason !== "smtp_not_configured") {
      logger.warn("member.new.notification_failed", { reason: res.reason });
    }
    await recordEmail(
      {
        ...base,
        status: res.ok ? "sent" : res.reason === "smtp_not_configured" ? "skipped" : "failed",
        recipient,
        bodyText: res.bodyText,
        bodyHtml: res.bodyHtml,
        messageId: res.messageId,
        detail: res.ok ? null : res.reason,
      },
      db,
    );
  } catch (err) {
    logger.error("member.new.notification_error", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
