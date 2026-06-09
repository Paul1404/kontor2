import { ORPCError } from "@orpc/server";
import { type AnyColumn, and, eq, inArray, isNull, sql } from "drizzle-orm";
import * as v from "valibot";
import { buildUploadUrl, issueUploadToken } from "~/server/application/upload-token";
import { lastFour } from "~/server/crypto/encrypt";
import type { DBOrTx } from "~/server/db/client";
import { allocateDocRef } from "~/server/db/doc-ref";
import { abteilungenTable } from "~/server/db/schema/abteilungen";
import { membersTable } from "~/server/db/schema/members";
import {
  type AntragKind,
  membershipApplicationFilesTable,
  membershipApplicationsTable,
} from "~/server/db/schema/membership-applications";
import { organizationSettingsTable } from "~/server/db/schema/organization-settings";
import {
  type Antragstyp,
  detectAntragstyp,
  mitgliedschaftTypFor,
  parseISODate,
  realAge,
} from "~/server/domain/application/antragstyp";
import { calculateFee } from "~/server/domain/application/fees";
import { env } from "~/server/env";
import { lookupBankByIban } from "~/server/lib/blz";
import { logger } from "~/server/lib/logger";
import { sendApplicationMails } from "~/server/mail/send-application-mail";
import { publicProc } from "~/server/orpc/base";
import { buildBeitrittModel } from "~/server/pdf/beitrittserklaerung-model";
import { clubLogoDataUri } from "~/server/pdf/logo";
import { renderPdfBase64 } from "~/server/pdf/renderer";
import { BeitrittserklaerungDocument } from "~/server/pdf/templates/beitrittserklaerung";
import { rateLimit } from "~/server/redis/client";
import { putObject } from "~/server/s3/client";
import { formatIbanGrouped, normalizeIban, validateIban } from "~/server/sepa/iban";

const ANRede = v.picklist(["Herr", "Frau", "keine Angabe"]);
const ISODate = v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/));
const Name = v.pipe(v.string(), v.trim(), v.minLength(2), v.maxLength(100));

const KindInput = v.object({
  vorname: Name,
  nachname: Name,
  geburtsdatum: ISODate,
  abteilungen: v.array(v.string()),
});

const SubmitInput = v.object({
  geschlecht: v.optional(v.nullable(ANRede), null),
  vorname: Name,
  nachname: Name,
  geburtsdatum: ISODate,
  strasse: v.optional(v.nullable(v.string()), null),
  hausnummer: v.optional(v.nullable(v.string()), null),
  plz: v.optional(v.nullable(v.string()), null),
  ort: v.optional(v.nullable(v.string()), null),
  telefon: v.optional(v.nullable(v.string()), null),
  email: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.email())), null),
  abteilungen: v.array(v.string()),
  erziehungsberechtigterVorname: v.optional(v.nullable(v.string()), null),
  erziehungsberechtigterNachname: v.optional(v.nullable(v.string()), null),
  partnerVorname: v.optional(v.nullable(v.string()), null),
  partnerNachname: v.optional(v.nullable(v.string()), null),
  partnerGeburtsdatum: v.optional(v.nullable(ISODate), null),
  partnerAbteilungen: v.optional(v.array(v.string()), []),
  kinder: v.optional(v.array(KindInput), []),
  elternteilMitglied: v.optional(v.boolean(), false),
  kontoinhaber: v.optional(v.nullable(v.string()), null),
  iban: v.pipe(v.string(), v.minLength(15)),
  bic: v.optional(v.nullable(v.string()), null),
  kreditinstitut: v.optional(v.nullable(v.string()), null),
  /** Inline signature PNG as a data URI; absent for the paper-form path. */
  unterschriftBase64: v.optional(v.nullable(v.string()), null),
  datenschutzAccepted: v.boolean(),
  satzungAccepted: v.boolean(),
  isTest: v.optional(v.boolean(), false),
});

const GESCHLECHT_MAP: Record<string, "m" | "w" | "unbekannt"> = {
  Herr: "m",
  Frau: "w",
  "keine Angabe": "unbekannt",
};

function clientIp(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "ip";
}

function baseUrl(): string {
  return env().BETTER_AUTH_URL.replace(/\/+$/, "");
}

function statusUrlFor(antragsnummer: string): string {
  return `${baseUrl()}/antrag/status?nr=${encodeURIComponent(antragsnummer)}`;
}

/** Numeric suffix of an ANT-YYYY-NNNN reference, for the Mandatsreferenz. */
function refSuffix(antragsnummer: string): string {
  const m = /-(\d+)$/.exec(antragsnummer);
  return m ? m[1]! : antragsnummer;
}

async function loadActiveAbteilungen(db: DBOrTx, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({
      id: abteilungenTable.id,
      name: abteilungenTable.name,
      inaktiv: abteilungenTable.inaktiv,
    })
    .from(abteilungenTable)
    .where(inArray(abteilungenTable.id, ids));
  return new Map(rows.filter((r) => !r.inaktiv).map((r) => [r.id, r.name]));
}

export const applicationsRouter = {
  /**
   * Public club info for the application form: name, active Abteilungen, the
   * fee schedule and the legal links. No auth; safe, non-sensitive fields only.
   */
  publicSettings: publicProc.handler(async ({ context }) => {
    const [org] = await context.db.select().from(organizationSettingsTable).limit(1);
    const abteilungen = await context.db
      .select({ id: abteilungenTable.id, name: abteilungenTable.name })
      .from(abteilungenTable)
      .where(eq(abteilungenTable.inaktiv, false))
      .orderBy(abteilungenTable.name);
    return {
      vereinsname: org?.vereinsname ?? "Verein",
      datenschutzUrl: org?.datenschutzUrl ?? null,
      satzungUrl: org?.satzungUrl ?? null,
      beitragsstaffel: org?.beitragsstaffel ?? null,
      abteilungen,
    };
  }),

  /** Compute the membership category + annual fee for a previewed application. */
  calculateFee: publicProc
    .input(
      v.object({
        geburtsdatum: ISODate,
        antragstyp: v.picklist(["einzel", "kind", "familie"]),
        elternteilMitglied: v.optional(v.boolean(), false),
      }),
    )
    .handler(async ({ context, input }) => {
      const dob = parseISODate(input.geburtsdatum);
      if (Number.isNaN(dob.getTime())) {
        throw new ORPCError("VALIDATION_FAILED", { message: "Ungültiges Geburtsdatum." });
      }
      const kategorie = mitgliedschaftTypFor(input.antragstyp as Antragstyp, dob);
      const [org] = await context.db.select().from(organizationSettingsTable).limit(1);
      const fee = calculateFee({
        kategorie,
        elternteilMitglied: input.elternteilMitglied,
        staffel: org?.beitragsstaffel ?? null,
      });
      return { kategorie, jahresbeitrag: fee.betrag, label: fee.label };
    }),

  /** Validate an IBAN and look up BIC + bank name (public form helper). */
  lookupIban: publicProc
    .input(v.object({ iban: v.string() }))
    .handler(async ({ context, input }) => {
      const limit = await rateLimit({
        key: `antrag-iban:${clientIp(context.headers)}`,
        limit: 60,
        windowSeconds: 60,
      });
      if (!limit.allowed) {
        throw new ORPCError("TOO_MANY_REQUESTS", { message: "Zu viele Anfragen." });
      }
      const iban = normalizeIban(input.iban);
      if (!validateIban(iban)) return { valid: false as const };
      const hit = lookupBankByIban(iban);
      return { valid: true as const, bic: hit?.bic ?? null, name: hit?.name ?? null };
    }),

  /** Duplicate guard on name + DOB against members and open applications. */
  checkDuplicate: publicProc
    .input(v.object({ vorname: v.string(), nachname: v.string(), geburtsdatum: ISODate }))
    .handler(async ({ context, input }) => {
      const dob = parseISODate(input.geburtsdatum);
      const vor = input.vorname.trim().toLowerCase();
      const nach = input.nachname.trim().toLowerCase();
      if (!vor || !nach || Number.isNaN(dob.getTime())) return { duplicate: false };
      // Match name + DOB against both existing members and open applications.
      const nameMatch = (vorCol: AnyColumn, nachCol: AnyColumn) =>
        and(sql`lower(${vorCol}) = ${vor}`, sql`lower(${nachCol}) = ${nach}`);
      const [apps, members] = await Promise.all([
        context.db
          .select({ id: membershipApplicationsTable.id })
          .from(membershipApplicationsTable)
          .where(
            and(
              eq(membershipApplicationsTable.geburtsdatum, dob),
              nameMatch(membershipApplicationsTable.vorname, membershipApplicationsTable.nachname),
            ),
          )
          .limit(1),
        context.db
          .select({ id: membersTable.id })
          .from(membersTable)
          .where(
            and(
              eq(membersTable.geburtsdatum, dob),
              isNull(membersTable.deletedAt),
              nameMatch(membersTable.vorname, membersTable.nachname),
            ),
          )
          .limit(1),
      ]);
      return { duplicate: apps.length > 0 || members.length > 0 };
    }),

  /** Public status lookup by Antragsnummer; returns only status, no PII. */
  lookupStatus: publicProc
    .input(v.object({ antragsnummer: v.string() }))
    .handler(async ({ context, input }) => {
      const [row] = await context.db
        .select({
          antragsnummer: membershipApplicationsTable.antragsnummer,
          status: membershipApplicationsTable.status,
          adminDeclineReason: membershipApplicationsTable.adminDeclineReason,
          createdAt: membershipApplicationsTable.createdAt,
        })
        .from(membershipApplicationsTable)
        .where(
          eq(membershipApplicationsTable.antragsnummer, input.antragsnummer.trim().toUpperCase()),
        )
        .limit(1);
      if (!row) throw new ORPCError("NOT_FOUND", { message: "Antragsnummer nicht gefunden." });
      return {
        antragsnummer: row.antragsnummer,
        status: row.status,
        createdAt: row.createdAt,
        declineReason: row.status === "abgelehnt" ? row.adminDeclineReason : null,
      };
    }),

  /** Submit a new membership application. Public, rate-limited. */
  submit: publicProc.input(SubmitInput).handler(async ({ context, input }) => {
    const limit = await rateLimit({
      key: `antrag-submit:${clientIp(context.headers)}`,
      limit: 5,
      windowSeconds: 600,
    });
    if (!limit.allowed) {
      throw new ORPCError("TOO_MANY_REQUESTS", {
        message: "Zu viele Anträge. Bitte versuchen Sie es in einigen Minuten erneut.",
      });
    }

    if (!input.datenschutzAccepted || !input.satzungAccepted) {
      throw new ORPCError("VALIDATION_FAILED", {
        message: "Datenschutzerklärung und Satzung müssen akzeptiert werden.",
      });
    }

    const dob = parseISODate(input.geburtsdatum);
    if (Number.isNaN(dob.getTime()) || dob >= new Date()) {
      throw new ORPCError("VALIDATION_FAILED", { message: "Geburtsdatum ungültig." });
    }
    if (realAge(dob) > 120) {
      throw new ORPCError("VALIDATION_FAILED", { message: "Geburtsdatum ungültig." });
    }

    const hasChildren = (input.kinder ?? []).length > 0;
    const hasPartner =
      (input.partnerVorname ?? "").trim().length >= 2 &&
      (input.partnerNachname ?? "").trim().length >= 2;
    const antragstyp = detectAntragstyp({ geburtsdatum: dob, hasChildren, hasPartner });
    const kategorie = mitgliedschaftTypFor(antragstyp, dob);

    if (antragstyp === "kind") {
      if (
        !(input.erziehungsberechtigterVorname ?? "").trim() ||
        !(input.erziehungsberechtigterNachname ?? "").trim()
      ) {
        throw new ORPCError("VALIDATION_FAILED", {
          message: "Für Minderjährige ist eine gesetzliche Vertretung erforderlich.",
        });
      }
    }

    const iban = normalizeIban(input.iban);
    if (!validateIban(iban)) {
      throw new ORPCError("VALIDATION_FAILED", {
        message: "IBAN ungültig (Prüfsumme fehlerhaft).",
      });
    }

    const [org] = await context.db.select().from(organizationSettingsTable).limit(1);
    if (!org) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Der Verein hat das Antragsformular noch nicht eingerichtet.",
      });
    }

    // Resolve + validate Abteilungen (active only). Snapshot names for the PDF.
    const allAbtIds = [
      ...new Set([
        ...input.abteilungen,
        ...input.partnerAbteilungen,
        ...(input.kinder ?? []).flatMap((k) => k.abteilungen),
      ]),
    ];
    const abtNames = await loadActiveAbteilungen(context.db, allAbtIds);
    for (const id of input.abteilungen) {
      if (!abtNames.has(id)) {
        throw new ORPCError("VALIDATION_FAILED", { message: "Ungültige Abteilung." });
      }
    }

    const fee = calculateFee({
      kategorie,
      elternteilMitglied: input.elternteilMitglied,
      staffel: org.beitragsstaffel,
    });
    const year = new Date().getUTCFullYear();
    const geschlecht: "m" | "w" | "unbekannt" | null = input.geschlecht
      ? (GESCHLECHT_MAP[input.geschlecht] ?? "unbekannt")
      : null;
    const hasSignature = Boolean(input.unterschriftBase64);

    // Insert the row (+ mint the reference) atomically. PDF/file/mail happen
    // post-commit and are best-effort so an SMTP/S3 blip never loses an antrag.
    const inserted = await context.db.transaction(async (tx) => {
      const antragsnummer = await allocateDocRef(tx, "ANT", year);
      const mandatsreferenz = `${org.mandatsreferenzPrefix}${year}-${refSuffix(antragsnummer)}`;
      const [row] = await tx
        .insert(membershipApplicationsTable)
        .values({
          antragsnummer,
          antragstyp,
          status: hasSignature ? "dokument_hochgeladen" : "neu",
          source: "online",
          mitgliedschaftTyp: kategorie,
          geschlecht,
          vorname: input.vorname.trim(),
          nachname: input.nachname.trim(),
          geburtsdatum: dob,
          strasse: input.strasse,
          hausnummer: input.hausnummer,
          plz: input.plz,
          ort: input.ort,
          telefon: input.telefon,
          email: input.email,
          erziehungsberechtigterVorname: input.erziehungsberechtigterVorname,
          erziehungsberechtigterNachname: input.erziehungsberechtigterNachname,
          partnerVorname: input.partnerVorname,
          partnerNachname: input.partnerNachname,
          partnerGeburtsdatum: input.partnerGeburtsdatum
            ? parseISODate(input.partnerGeburtsdatum)
            : null,
          partnerAbteilungen: input.partnerAbteilungen,
          kinder: (input.kinder ?? []) as AntragKind[],
          abteilungen: input.abteilungen,
          elternteilMitglied: input.elternteilMitglied,
          jahresbeitrag: fee.betrag,
          kontoinhaber: input.kontoinhaber,
          iban,
          ibanLast4: lastFour(iban),
          bic: input.bic ? input.bic.toUpperCase().replace(/\s+/g, "") : null,
          kreditinstitut: input.kreditinstitut,
          mandatsreferenz,
          consentAt: new Date(),
          datenschutzAccepted: input.datenschutzAccepted,
          satzungAccepted: input.satzungAccepted,
          consentIp: clientIp(context.headers),
          isTest: input.isTest,
        })
        .returning({
          id: membershipApplicationsTable.id,
          antragsnummer: membershipApplicationsTable.antragsnummer,
          mandatsreferenz: membershipApplicationsTable.mandatsreferenz,
        });
      if (!row) throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Anlage fehlgeschlagen." });
      return row;
    });

    // Render the Beitrittserklärung PDF, store it, optionally issue an upload
    // token, then email applicant + club. All best-effort.
    let uploadUrl: string | null = null;
    try {
      const model = buildBeitrittModel({
        antragsnummer: inserted.antragsnummer,
        antragstyp,
        geschlecht,
        vorname: input.vorname,
        nachname: input.nachname,
        geburtsdatum: dob,
        strasse: input.strasse,
        hausnummer: input.hausnummer,
        plz: input.plz,
        ort: input.ort,
        telefon: input.telefon,
        email: input.email,
        erziehungsberechtigterVorname: input.erziehungsberechtigterVorname,
        erziehungsberechtigterNachname: input.erziehungsberechtigterNachname,
        partnerVorname: input.partnerVorname,
        partnerNachname: input.partnerNachname,
        partnerGeburtsdatum: input.partnerGeburtsdatum
          ? parseISODate(input.partnerGeburtsdatum)
          : null,
        partnerAbteilungen: input.partnerAbteilungen.map((id) => abtNames.get(id) ?? id),
        kinder: (input.kinder ?? []).map((k) => ({
          ...k,
          abteilungen: k.abteilungen.map((id) => abtNames.get(id) ?? id),
        })),
        abteilungen: input.abteilungen.map((id) => abtNames.get(id) ?? id),
        mitgliedschaftLabel: fee.label,
        jahresbeitrag: fee.betrag,
        kontoinhaber: input.kontoinhaber,
        ibanFormatted: formatIbanGrouped(iban),
        bic: input.bic ? input.bic.toUpperCase().replace(/\s+/g, "") : null,
        kreditinstitut: input.kreditinstitut,
        mandatsreferenz: inserted.mandatsreferenz,
        consentAt: new Date(),
        signatureDataUri: input.unterschriftBase64 ?? null,
        club: {
          vereinsname: org.vereinsname,
          ort: org.anschriftOrt ?? "",
          anschriftStrasse: org.anschriftStrasse,
          anschriftPlz: org.anschriftPlz,
          anschriftOrt: org.anschriftOrt,
          kontaktEmail: org.mitgliedschaftEmail ?? org.kontaktEmail,
          kontaktTelefon: org.kontaktTelefon,
          glaeubigerId: org.glaeubigerId,
          datenschutzUrl: org.datenschutzUrl,
          satzungUrl: org.satzungUrl,
          logoDataUri: clubLogoDataUri(),
        },
      });
      const { base64 } = await renderPdfBase64(BeitrittserklaerungDocument({ model }));
      const pdf = Buffer.from(base64, "base64");
      const s3Key = `applications/${inserted.id}/${inserted.antragsnummer}.pdf`;
      await putObject({ key: s3Key, body: pdf, contentType: "application/pdf" });
      await context.db.insert(membershipApplicationFilesTable).values({
        applicationId: inserted.id,
        kind: hasSignature ? "signed_scan" : "generated_pdf",
        s3Key,
        filename: `Beitrittserklaerung-${inserted.antragsnummer}.pdf`,
        mimeType: "application/pdf",
        sizeBytes: pdf.byteLength,
      });

      // Paper path (no inline signature): hand out a 30-day upload link.
      if (!hasSignature) {
        const token = await issueUploadToken(context.db, { applicationId: inserted.id });
        uploadUrl = buildUploadUrl(baseUrl(), token.rawToken);
      }

      const clubEmail = org.antragVorstandEmail ?? org.mitgliedschaftEmail ?? org.kontaktEmail;
      const mailRes = await sendApplicationMails({
        vereinsname: org.vereinsname,
        applicantEmail: input.email,
        applicantName:
          antragstyp === "kind"
            ? `${input.erziehungsberechtigterVorname ?? ""} ${input.erziehungsberechtigterNachname ?? ""}`.trim()
            : `${input.vorname} ${input.nachname}`.trim(),
        clubEmail,
        notifyClub: org.antragBenachrichtigungAktiv,
        antragsnummer: inserted.antragsnummer,
        statusUrl: statusUrlFor(inserted.antragsnummer),
        uploadUrl,
        pdf: {
          filename: `Beitrittserklaerung-${inserted.antragsnummer}.pdf`,
          content: pdf,
          contentType: "application/pdf",
        },
      });
      if (mailRes.applicantSent || mailRes.clubSent) {
        await context.db
          .update(membershipApplicationsTable)
          .set({ emailSent: true })
          .where(eq(membershipApplicationsTable.id, inserted.id));
      }
    } catch (err) {
      logger.error("application.submit.post_commit_failed", {
        antragsnummer: inserted.antragsnummer,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return {
      antragsnummer: inserted.antragsnummer,
      statusUrl: statusUrlFor(inserted.antragsnummer),
    };
  }),
};
