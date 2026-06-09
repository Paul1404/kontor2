import { ORPCError } from "@orpc/server";
import { type AnyColumn, and, count, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import * as v from "valibot";
import {
  buildUploadUrl,
  consumeUploadToken,
  issueUploadToken,
  peekUploadToken,
} from "~/server/application/upload-token";
import { appendAudit } from "~/server/audit/log";
import { getMailer } from "~/server/auth/send-invite";
import { lastFour } from "~/server/crypto/encrypt";
import type { DBOrTx } from "~/server/db/client";
import { allocateDocRef } from "~/server/db/doc-ref";
import { escapeLike } from "~/server/db/like";
import { withUniqueRetry } from "~/server/db/retry";
import { abteilungenTable } from "~/server/db/schema/abteilungen";
import { emailLogTable } from "~/server/db/schema/email-log";
import { membersTable } from "~/server/db/schema/members";
import {
  type AntragKind,
  type AntragStatus,
  type MembershipApplication,
  membershipApplicationFilesTable,
  membershipApplicationsTable,
} from "~/server/db/schema/membership-applications";
import {
  type OrganizationSettings,
  organizationSettingsTable,
} from "~/server/db/schema/organization-settings";
import {
  type Antragstyp,
  detectAntragstyp,
  mitgliedschaftTypFor,
  parseISODate,
  realAge,
} from "~/server/domain/application/antragstyp";
import { calculateFee } from "~/server/domain/application/fees";
import { onboardMember } from "~/server/domain/member/onboard";
import { env } from "~/server/env";
import { lookupBankByIban } from "~/server/lib/blz";
import { toCsv } from "~/server/lib/csv";
import { logger } from "~/server/lib/logger";
import { EMAIL_KIND, type EmailLogEntry, recordEmail } from "~/server/mail/email-log";
import {
  sendApplicationDocumentMail,
  sendApplicationMails,
} from "~/server/mail/send-application-mail";
import { errorLogFields, publicProc, vorstandProc } from "~/server/orpc/base";
import { buildBeitrittModel } from "~/server/pdf/beitrittserklaerung-model";
import { clubLogoDataUri } from "~/server/pdf/logo";
import { renderPdfBase64 } from "~/server/pdf/renderer";
import { BeitrittserklaerungDocument } from "~/server/pdf/templates/beitrittserklaerung";
import { rateLimit } from "~/server/redis/client";
import { getObject, presignDownload, putObject } from "~/server/s3/client";
import { invalidateMemberCaches } from "~/server/search/cache";
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

function anredeFromGeschlecht(g: "m" | "w" | "d" | "unbekannt" | null): string | null {
  if (g === "m") return "Herr";
  if (g === "w") return "Frau";
  return null;
}

/** Split a `data:<mime>;base64,<data>` URI into its mime type and raw bytes. */
function parseDataUri(uri: string): { mime: string; body: Buffer } | null {
  const m = /^data:([^;]+);base64,(.+)$/s.exec(uri);
  if (!m) return null;
  return { mime: m[1]!, body: Buffer.from(m[2]!, "base64") };
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

/**
 * Render the genehmigte Beitrittserklärung: the original application data with
 * the applicant's signature re-embedded from the stored `signature_image` and
 * the Vorstands-Gegenzeichnung from the organization settings. Stores it in S3
 * as an `approved_pdf` file and returns the bytes for the welcome mail.
 */
async function buildApprovedPdf(
  db: DBOrTx,
  app: MembershipApplication,
  org: OrganizationSettings,
  approvedAt: Date,
): Promise<Buffer> {
  const allAbtIds = [
    ...new Set([
      ...(app.abteilungen ?? []),
      ...(app.partnerAbteilungen ?? []),
      ...(app.kinder ?? []).flatMap((k) => k.abteilungen),
    ]),
  ];
  const abtNames = await loadActiveAbteilungen(db, allAbtIds);

  // Re-embed the applicant's signature if we kept it (online path only).
  let signatureDataUri: string | null = null;
  const [sigFile] = await db
    .select({
      s3Key: membershipApplicationFilesTable.s3Key,
      mimeType: membershipApplicationFilesTable.mimeType,
    })
    .from(membershipApplicationFilesTable)
    .where(
      and(
        eq(membershipApplicationFilesTable.applicationId, app.id),
        eq(membershipApplicationFilesTable.kind, "signature_image"),
      ),
    )
    .orderBy(desc(membershipApplicationFilesTable.uploadedAt))
    .limit(1);
  if (sigFile) {
    const bytes = await getObject(sigFile.s3Key);
    signatureDataUri = `data:${sigFile.mimeType ?? "image/png"};base64,${bytes.toString("base64")}`;
  }

  const fee = calculateFee({
    kategorie: app.mitgliedschaftTyp,
    elternteilMitglied: app.elternteilMitglied,
    staffel: org.beitragsstaffel,
  });

  const model = buildBeitrittModel({
    antragsnummer: app.antragsnummer,
    antragstyp: app.antragstyp,
    geschlecht: app.geschlecht,
    vorname: app.vorname,
    nachname: app.nachname,
    geburtsdatum: app.geburtsdatum,
    strasse: app.strasse,
    hausnummer: app.hausnummer,
    plz: app.plz,
    ort: app.ort,
    telefon: app.telefon,
    email: app.email,
    erziehungsberechtigterVorname: app.erziehungsberechtigterVorname,
    erziehungsberechtigterNachname: app.erziehungsberechtigterNachname,
    partnerVorname: app.partnerVorname,
    partnerNachname: app.partnerNachname,
    partnerGeburtsdatum: app.partnerGeburtsdatum,
    partnerAbteilungen: (app.partnerAbteilungen ?? []).map((id) => abtNames.get(id) ?? id),
    kinder: (app.kinder ?? []).map((k) => ({
      ...k,
      abteilungen: (k.abteilungen ?? []).map((id) => abtNames.get(id) ?? id),
    })),
    abteilungen: (app.abteilungen ?? []).map((id) => abtNames.get(id) ?? id),
    mitgliedschaftLabel: fee.label,
    jahresbeitrag: app.jahresbeitrag ?? fee.betrag,
    kontoinhaber: app.kontoinhaber,
    ibanFormatted: app.iban ? formatIbanGrouped(app.iban) : null,
    bic: app.bic,
    kreditinstitut: app.kreditinstitut,
    mandatsreferenz: app.mandatsreferenz,
    consentAt: app.consentAt,
    signatureDataUri,
    countersignatureDataUri: org.antragGegenzeichnungBild,
    countersignerName: org.antragGegenzeichnerName,
    approvedAt,
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
  const s3Key = `applications/${app.id}/${app.antragsnummer}-genehmigt.pdf`;
  await putObject({ key: s3Key, body: pdf, contentType: "application/pdf" });
  await db.insert(membershipApplicationFilesTable).values({
    applicationId: app.id,
    kind: "approved_pdf",
    s3Key,
    filename: `Beitrittserklaerung-${app.antragsnummer}-genehmigt.pdf`,
    mimeType: "application/pdf",
    sizeBytes: pdf.byteLength,
  });
  return pdf;
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

      // Keep the raw inline signature on its own so the genehmigte PDF can
      // re-embed it later next to the Vorstands-Gegenzeichnung.
      if (hasSignature && input.unterschriftBase64) {
        const sig = parseDataUri(input.unterschriftBase64);
        if (sig) {
          const sigKey = `applications/${inserted.id}/signature.${sig.mime === "image/jpeg" ? "jpg" : "png"}`;
          await putObject({ key: sigKey, body: sig.body, contentType: sig.mime });
          await context.db.insert(membershipApplicationFilesTable).values({
            applicationId: inserted.id,
            kind: "signature_image",
            s3Key: sigKey,
            filename: `signature-${inserted.antragsnummer}.png`,
            mimeType: sig.mime,
            sizeBytes: sig.body.byteLength,
          });
        }
      }

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
      await recordEmail(
        mailRes.records.map((r) => ({
          ...r,
          entityType: "membership_application",
          entityId: inserted.id,
          requestId: context.requestId ?? null,
        })),
        context.db,
      );
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

  /**
   * Public: resolve an upload token to its application so the upload page can
   * render. Does NOT consume the token (the actual upload does).
   */
  uploadInfo: publicProc
    .input(v.object({ token: v.string() }))
    .handler(async ({ context, input }) => {
      const peek = await peekUploadToken(context.db, input.token);
      if (!peek) {
        throw new ORPCError("NOT_FOUND", {
          message: "Der Upload-Link ist ungültig oder abgelaufen.",
        });
      }
      const [app] = await context.db
        .select({
          antragsnummer: membershipApplicationsTable.antragsnummer,
          vorname: membershipApplicationsTable.vorname,
          nachname: membershipApplicationsTable.nachname,
          status: membershipApplicationsTable.status,
        })
        .from(membershipApplicationsTable)
        .where(eq(membershipApplicationsTable.id, peek.applicationId))
        .limit(1);
      if (!app) throw new ORPCError("NOT_FOUND", { message: "Antrag nicht gefunden." });
      return app;
    }),

  /**
   * Public: accept the signed paper Beitrittserklärung scan. The token is
   * single-use and consumed here; the file is stored in S3 and the application
   * advances to `dokument_hochgeladen`. The scan is sent as a base64 data URI
   * to stay on the existing JSON RPC surface; capped at 10 MB.
   */
  uploadSigned: publicProc
    .input(
      v.object({
        token: v.string(),
        filename: v.pipe(v.string(), v.minLength(1)),
        mimeType: v.pipe(v.string(), v.minLength(1)),
        contentBase64: v.pipe(v.string(), v.minLength(1)),
      }),
    )
    .handler(async ({ context, input }) => {
      const limit = await rateLimit({
        key: `antrag-upload:${clientIp(context.headers)}`,
        limit: 10,
        windowSeconds: 600,
      });
      if (!limit.allowed) {
        throw new ORPCError("TOO_MANY_REQUESTS", { message: "Zu viele Anfragen." });
      }
      const allowed = ["application/pdf", "image/jpeg", "image/png", "image/heic"];
      if (!allowed.includes(input.mimeType)) {
        throw new ORPCError("VALIDATION_FAILED", { message: "Nicht erlaubtes Dateiformat." });
      }
      const body = Buffer.from(input.contentBase64, "base64");
      if (body.byteLength === 0) {
        throw new ORPCError("VALIDATION_FAILED", { message: "Leere Datei." });
      }
      if (body.byteLength > 10 * 1024 * 1024) {
        throw new ORPCError("VALIDATION_FAILED", { message: "Datei zu groß (max. 10 MB)." });
      }
      const claim = await consumeUploadToken(context.db, input.token);
      if (!claim) {
        throw new ORPCError("NOT_FOUND", {
          message: "Der Upload-Link ist ungültig, abgelaufen oder bereits benutzt.",
        });
      }
      const ext = input.filename.split(".").pop()?.toLowerCase() ?? "bin";
      const s3Key = `applications/${claim.applicationId}/signed-${Date.now()}.${ext}`;
      await putObject({ key: s3Key, body, contentType: input.mimeType });
      await context.db.insert(membershipApplicationFilesTable).values({
        applicationId: claim.applicationId,
        kind: "signed_scan",
        s3Key,
        filename: input.filename,
        mimeType: input.mimeType,
        sizeBytes: body.byteLength,
      });
      await context.db
        .update(membershipApplicationsTable)
        .set({ status: "dokument_hochgeladen", updatedAt: new Date() })
        .where(
          and(
            eq(membershipApplicationsTable.id, claim.applicationId),
            eq(membershipApplicationsTable.status, "neu"),
          ),
        );
      return { ok: true };
    }),

  // ---- Admin / Vorstand ----

  /** Paginated application list with search, status filter and test toggle. */
  list: vorstandProc
    .input(
      v.object({
        q: v.optional(v.string(), ""),
        status: v.optional(
          v.nullable(
            v.picklist([
              "neu",
              "scan_eingegangen",
              "dokument_hochgeladen",
              "in_bearbeitung",
              "genehmigt",
              "abgelehnt",
            ]),
          ),
          null,
        ),
        includeTest: v.optional(v.boolean(), false),
        page: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1)), 1),
        pageSize: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(200)), 50),
      }),
    )
    .handler(async ({ context, input }) => {
      const t = membershipApplicationsTable;
      const conds = [];
      if (!input.includeTest) conds.push(eq(t.isTest, false));
      if (input.status) conds.push(eq(t.status, input.status));
      const q = input.q.trim();
      if (q) {
        const like = `%${escapeLike(q)}%`;
        conds.push(
          or(
            ilike(t.nachname, like),
            ilike(t.vorname, like),
            ilike(t.antragsnummer, like),
            ilike(t.email, like),
          ),
        );
      }
      const where = conds.length > 0 ? and(...conds) : undefined;
      const totalRow = (await context.db.select({ total: count() }).from(t).where(where))[0];
      const total = totalRow?.total ?? 0;
      const rows = await context.db
        .select({
          id: t.id,
          antragsnummer: t.antragsnummer,
          antragstyp: t.antragstyp,
          status: t.status,
          source: t.source,
          vorname: t.vorname,
          nachname: t.nachname,
          email: t.email,
          mitgliedschaftTyp: t.mitgliedschaftTyp,
          jahresbeitrag: t.jahresbeitrag,
          isTest: t.isTest,
          createdAt: t.createdAt,
        })
        .from(t)
        .where(where)
        .orderBy(desc(t.createdAt))
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize);
      return { rows, total, page: input.page, pageSize: input.pageSize };
    }),

  /** Full application detail with files and the email log. IBAN is masked. */
  get: vorstandProc
    .input(v.object({ id: v.pipe(v.string(), v.uuid()) }))
    .handler(async ({ context, input }) => {
      const t = membershipApplicationsTable;
      const [row] = await context.db.select().from(t).where(eq(t.id, input.id)).limit(1);
      if (!row) throw new ORPCError("NOT_FOUND", { message: "Antrag nicht gefunden." });
      const [files, emails] = await Promise.all([
        context.db
          .select({
            id: membershipApplicationFilesTable.id,
            kind: membershipApplicationFilesTable.kind,
            filename: membershipApplicationFilesTable.filename,
            mimeType: membershipApplicationFilesTable.mimeType,
            sizeBytes: membershipApplicationFilesTable.sizeBytes,
            uploadedAt: membershipApplicationFilesTable.uploadedAt,
          })
          .from(membershipApplicationFilesTable)
          .where(eq(membershipApplicationFilesTable.applicationId, input.id))
          .orderBy(desc(membershipApplicationFilesTable.uploadedAt)),
        context.db
          .select({
            id: emailLogTable.id,
            kind: emailLogTable.kind,
            status: emailLogTable.status,
            recipient: emailLogTable.recipient,
            subject: emailLogTable.subject,
            detail: emailLogTable.detail,
            createdAt: emailLogTable.createdAt,
          })
          .from(emailLogTable)
          .where(
            and(
              eq(emailLogTable.entityType, "membership_application"),
              eq(emailLogTable.entityId, input.id),
            ),
          )
          .orderBy(desc(emailLogTable.createdAt)),
      ]);
      const { iban, ...rest } = row;
      return {
        ...rest,
        ibanMasked: row.ibanLast4 ? `**** **** **** **** ${row.ibanLast4}` : null,
        files,
        emails,
      };
    }),

  /**
   * Presigned download URL for one application file. The signature image is
   * deliberately not downloadable on its own; it only ever leaves the system
   * embedded in the generated/approved PDF.
   */
  fileUrl: vorstandProc
    .input(v.object({ id: v.pipe(v.string(), v.uuid()) }))
    .handler(async ({ context, input }) => {
      const [file] = await context.db
        .select({
          s3Key: membershipApplicationFilesTable.s3Key,
          filename: membershipApplicationFilesTable.filename,
          kind: membershipApplicationFilesTable.kind,
        })
        .from(membershipApplicationFilesTable)
        .where(eq(membershipApplicationFilesTable.id, input.id))
        .limit(1);
      if (!file || file.kind === "signature_image") {
        throw new ORPCError("NOT_FOUND", { message: "Datei nicht gefunden." });
      }
      const url = await presignDownload({
        key: file.s3Key,
        filename: file.filename ?? "antrag.pdf",
        expiresSeconds: 300,
      });
      return { url, filename: file.filename ?? "antrag.pdf" };
    }),

  /** Edit notes and move the application through the non-terminal statuses. */
  update: vorstandProc
    .input(
      v.object({
        id: v.pipe(v.string(), v.uuid()),
        status: v.optional(
          v.nullable(
            v.picklist(["neu", "scan_eingegangen", "dokument_hochgeladen", "in_bearbeitung"]),
          ),
          null,
        ),
        notes: v.optional(v.nullable(v.string()), null),
      }),
    )
    .handler(async ({ context, input }) => {
      const t = membershipApplicationsTable;
      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (input.status) patch.status = input.status;
      if (input.notes !== null) patch.notes = input.notes;
      const res = await context.db
        .update(t)
        .set(patch)
        .where(eq(t.id, input.id))
        .returning({ id: t.id });
      if (res.length === 0) throw new ORPCError("NOT_FOUND", { message: "Antrag nicht gefunden." });
      return { ok: true };
    }),

  /** Decline an application with a reason that is emailed to the applicant. */
  decline: vorstandProc
    .input(
      v.object({
        id: v.pipe(v.string(), v.uuid()),
        reason: v.pipe(v.string(), v.trim(), v.minLength(1)),
      }),
    )
    .handler(async ({ context, input }) => {
      const t = membershipApplicationsTable;
      const [app] = await context.db.select().from(t).where(eq(t.id, input.id)).limit(1);
      if (!app) throw new ORPCError("NOT_FOUND", { message: "Antrag nicht gefunden." });
      if (app.status === "genehmigt") {
        throw new ORPCError("CONFLICT", {
          message: "Ein genehmigter Antrag kann nicht abgelehnt werden.",
        });
      }
      await context.db
        .update(t)
        .set({ status: "abgelehnt", adminDeclineReason: input.reason, updatedAt: new Date() })
        .where(eq(t.id, input.id));

      const subject = `Ihr Aufnahmeantrag (${app.antragsnummer})`;
      const base = {
        kind: EMAIL_KIND.antragDecline,
        subject,
        entityType: "membership_application",
        entityId: app.id,
        actorEmail: context.session!.user.email,
        requestId: context.requestId ?? null,
      } satisfies Partial<EmailLogEntry>;
      let record: EmailLogEntry;
      if (app.email) {
        const mailer = await getMailer();
        const [org] = await context.db.select().from(organizationSettingsTable).limit(1);
        if (!mailer) {
          record = {
            ...base,
            status: "skipped",
            recipient: app.email,
            detail: "smtp_not_configured",
          };
        } else {
          try {
            await mailer.send({
              to: app.email,
              subject,
              text: [
                `Hallo ${app.vorname} ${app.nachname},`,
                "",
                `Ihr Aufnahmeantrag beim ${org?.vereinsname ?? "Verein"} konnte leider nicht angenommen werden.`,
                "",
                `Begründung: ${input.reason}`,
              ].join("\n"),
            });
            record = { ...base, status: "sent", recipient: app.email };
          } catch (err) {
            record = {
              ...base,
              status: "failed",
              recipient: app.email,
              detail: err instanceof Error ? err.message : String(err),
            };
          }
        }
      } else {
        record = { ...base, status: "skipped", detail: "no_recipient" };
      }
      await recordEmail(record, context.db);
      return { ok: true };
    }),

  /**
   * Approve an application: create the member (and, for a family, the partner
   * and children) via the shared `onboardMember`, link the created member back
   * to the application, and email the applicant. A contract is created when a
   * fee art is supplied; the SEPA mandate uses the application's Mandatsreferenz.
   */
  approve: vorstandProc
    .input(
      v.object({
        id: v.pipe(v.string(), v.uuid()),
        art: v.optional(v.nullable(v.pipe(v.number(), v.integer())), null),
        betrag: v.optional(v.nullable(v.string()), null),
      }),
    )
    .handler(async ({ context, input }) => {
      const t = membershipApplicationsTable;
      const [app] = await context.db.select().from(t).where(eq(t.id, input.id)).limit(1);
      if (!app) throw new ORPCError("NOT_FOUND", { message: "Antrag nicht gefunden." });
      if (app.status === "genehmigt" || app.memberId) {
        throw new ORPCError("CONFLICT", { message: "Antrag ist bereits genehmigt." });
      }

      const actorId = context.session!.user.id;
      const actorEmail = context.session!.user.email;
      const fallbackEintritt = new Date().toISOString().slice(0, 10);
      const isMinor = app.antragstyp === "kind";
      const ibanPlain = app.iban?.trim() ? app.iban.trim() : null;

      const primaryPatch: Record<string, unknown> = {
        anrede: anredeFromGeschlecht(app.geschlecht),
        geschlecht: app.geschlecht,
        vorname: app.vorname,
        nachname: app.nachname,
        geburtsdatum: app.geburtsdatum,
        strasse: app.strasse,
        hausnummer: app.hausnummer,
        plz: app.plz,
        ort: app.ort,
        telefon1: app.telefon,
        email: app.email,
        eintritt: new Date(),
      };
      if (isMinor) {
        const guardian =
          `${app.erziehungsberechtigterVorname ?? ""} ${app.erziehungsberechtigterNachname ?? ""}`.trim();
        primaryPatch.vertreterName = guardian || null;
        primaryPatch.vertreterStrasse =
          [app.strasse, app.hausnummer].filter(Boolean).join(" ") || null;
        primaryPatch.vertreterPlz = app.plz;
        primaryPatch.vertreterOrt = app.ort;
      }
      if (ibanPlain) {
        primaryPatch.iban1 = ibanPlain;
        primaryPatch.iban1Last4 = app.ibanLast4 ?? lastFour(ibanPlain);
        primaryPatch.bic1 = app.bic;
      }

      const contract =
        input.art != null
          ? {
              art: input.art,
              artName: null,
              vertragNr: null,
              betrag: input.betrag ?? app.jahresbeitrag ?? null,
              sollstellung: null,
              vertragBegin: new Date(),
            }
          : null;
      const sepa = ibanPlain
        ? {
            mandatsNr: app.mandatsreferenz,
            unterschriftDatum: app.consentAt,
            gueltigAb: new Date(),
          }
        : null;

      const result = await withUniqueRetry(() =>
        context.db.transaction(async (tx) => {
          const primary = await onboardMember(tx, {
            patch: primaryPatch,
            isKontakt: false,
            status: "aktiv",
            abteilungen: (app.abteilungen ?? []).map((id) => ({ abteilungId: id })),
            fallbackEintritt,
            contract,
            sepa,
            actorId,
            actorEmail,
            requestId: context.requestId ?? null,
          });
          const refs = [primary.ref];

          if (app.antragstyp === "familie") {
            if (app.partnerVorname && app.partnerNachname) {
              const p = await onboardMember(tx, {
                patch: {
                  vorname: app.partnerVorname,
                  nachname: app.partnerNachname,
                  geburtsdatum: app.partnerGeburtsdatum,
                  strasse: app.strasse,
                  hausnummer: app.hausnummer,
                  plz: app.plz,
                  ort: app.ort,
                  eintritt: new Date(),
                },
                isKontakt: false,
                status: "aktiv",
                abteilungen: (app.partnerAbteilungen ?? []).map((id) => ({ abteilungId: id })),
                fallbackEintritt,
                contract: null,
                sepa: null,
                actorId,
                actorEmail,
                requestId: context.requestId ?? null,
              });
              refs.push(p.ref);
            }
            for (const k of app.kinder ?? []) {
              const c = await onboardMember(tx, {
                patch: {
                  vorname: k.vorname,
                  nachname: k.nachname,
                  geburtsdatum: k.geburtsdatum ? parseISODate(k.geburtsdatum) : null,
                  strasse: app.strasse,
                  hausnummer: app.hausnummer,
                  plz: app.plz,
                  ort: app.ort,
                  eintritt: new Date(),
                },
                isKontakt: false,
                status: "aktiv",
                abteilungen: (k.abteilungen ?? []).map((id) => ({ abteilungId: id })),
                fallbackEintritt,
                contract: null,
                sepa: null,
                actorId,
                actorEmail,
                requestId: context.requestId ?? null,
              });
              refs.push(c.ref);
            }
          }

          await tx
            .update(t)
            .set({
              status: "genehmigt",
              memberId: primary.id,
              mitgliedsnummer: refs.join(", "),
              updatedAt: new Date(),
            })
            .where(eq(t.id, app.id));

          await appendAudit(tx, {
            entityType: "membership_application",
            entityId: app.id,
            action: "update",
            source: "ui",
            actorId,
            actorEmail,
            changes: {
              status: { before: app.status, after: "genehmigt" },
              mitgliedsnummer: { before: null, after: refs.join(", ") },
            },
            requestId: context.requestId ?? null,
          });

          return { primaryId: primary.id, refs };
        }),
      );

      await invalidateMemberCaches();

      const [org] = await context.db.select().from(organizationSettingsTable).limit(1);
      const approvedAt = new Date();

      // Render the genehmigte Beitrittserklärung: the applicant's signature
      // (re-embedded from the stored image) plus the Vorstands-Gegenzeichnung.
      // Best-effort -- a render/storage hiccup must not undo the approval.
      let approvedPdf: Buffer | null = null;
      try {
        if (org) {
          approvedPdf = await buildApprovedPdf(context.db, app, org, approvedAt);
        }
      } catch (err) {
        logger.error("application.approve.pdf_failed", {
          antragsnummer: app.antragsnummer,
          ...errorLogFields(err),
        });
      }

      if (app.email) {
        const sent = await sendApplicationDocumentMail({
          to: app.email,
          subject: `Willkommen beim ${org?.vereinsname ?? "Verein"}`,
          text: [
            `Hallo ${app.vorname} ${app.nachname},`,
            "",
            `Ihr Aufnahmeantrag wurde angenommen. Ihre Mitgliedsnummer: ${result.refs.join(", ")}.`,
            "",
            ...(approvedPdf ? ["Die genehmigte Beitrittserklärung finden Sie im Anhang.", ""] : []),
            "Herzlich willkommen.",
          ].join("\n"),
          pdf: approvedPdf
            ? {
                filename: `Beitrittserklaerung-${app.antragsnummer}-genehmigt.pdf`,
                content: approvedPdf,
                contentType: "application/pdf",
              }
            : null,
        });
        await recordEmail(
          {
            kind: EMAIL_KIND.antragApproval,
            status: sent.status,
            recipient: app.email,
            subject: `Willkommen beim ${org?.vereinsname ?? "Verein"}`,
            detail: sent.detail,
            entityType: "membership_application",
            entityId: app.id,
            actorEmail,
            requestId: context.requestId ?? null,
          },
          context.db,
        );
      } else {
        await recordEmail(
          {
            kind: EMAIL_KIND.antragApproval,
            status: "skipped",
            detail: "no_recipient",
            entityType: "membership_application",
            entityId: app.id,
            actorEmail,
            requestId: context.requestId ?? null,
          },
          context.db,
        );
      }

      return { memberId: result.primaryId, mitgliedsnummer: result.refs.join(", ") };
    }),

  /** Dashboard counters for the application queue. */
  stats: vorstandProc.handler(async ({ context }) => {
    const t = membershipApplicationsTable;
    const rows = await context.db
      .select({ status: t.status, n: count() })
      .from(t)
      .where(eq(t.isTest, false))
      .groupBy(t.status);
    const byStatus: Record<string, number> = {};
    let total = 0;
    for (const r of rows) {
      byStatus[r.status] = r.n;
      total += r.n;
    }
    const revenueRow = (
      await context.db
        .select({ revenue: sql<string>`coalesce(sum(${t.jahresbeitrag}), 0)::text` })
        .from(t)
        .where(and(eq(t.isTest, false), eq(t.status, "genehmigt")))
    )[0];
    return { total, byStatus, revenueApproved: revenueRow?.revenue ?? "0" };
  }),

  /** Export applications as a German CSV (semicolon, BOM). */
  exportCsv: vorstandProc
    .input(v.object({ includeTest: v.optional(v.boolean(), false) }))
    .handler(async ({ context, input }) => {
      const t = membershipApplicationsTable;
      const rows = await context.db
        .select({
          antragsnummer: t.antragsnummer,
          status: t.status,
          antragstyp: t.antragstyp,
          vorname: t.vorname,
          nachname: t.nachname,
          email: t.email,
          plz: t.plz,
          ort: t.ort,
          mitgliedschaftTyp: t.mitgliedschaftTyp,
          jahresbeitrag: t.jahresbeitrag,
          mitgliedsnummer: t.mitgliedsnummer,
          createdAt: t.createdAt,
        })
        .from(t)
        .where(input.includeTest ? undefined : eq(t.isTest, false))
        .orderBy(desc(t.createdAt));
      const content = toCsv(rows, [
        { key: "antragsnummer", label: "Antragsnummer" },
        { key: "status", label: "Status" },
        { key: "antragstyp", label: "Antragstyp" },
        { key: "vorname", label: "Vorname" },
        { key: "nachname", label: "Nachname" },
        { key: "email", label: "E-Mail" },
        { key: "plz", label: "PLZ" },
        { key: "ort", label: "Ort" },
        { key: "mitgliedschaftTyp", label: "Mitgliedschaft" },
        { key: "jahresbeitrag", label: "Jahresbeitrag" },
        { key: "mitgliedsnummer", label: "Mitgliedsnummer" },
        {
          key: "createdAt",
          label: "Eingegangen",
          format: (val) => (val instanceof Date ? val.toISOString().slice(0, 10) : ""),
        },
      ]);
      return { filename: "antraege.csv", content };
    }),
};

// Re-exported for callers that need the status union without importing schema.
export type { AntragStatus };
