import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { ORPCError } from "@orpc/server";
import { and, count, desc, eq, gt, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import * as v from "valibot";
import {
  realAgeFromIso,
  validateBicMessage,
  validateIbanMessage,
  validateNameMessage,
  validatePastDateMessage,
  validatePhoneMessage,
  validatePlzMessage,
} from "~/lib/application-validation";
import { normalizeTenantPolicy } from "~/lib/tenant-settings";
import { lookupPlz, searchStreets } from "~/server/address/lookup";
import {
  decodeBase64Upload,
  extensionForMimeType,
  MIB,
  maxBase64Length,
} from "~/server/application/upload-bytes";
import {
  buildStatusUrl,
  buildUploadUrl,
  consumeUploadToken,
  issueStatusToken,
  issueUploadToken,
  peekStatusToken,
  peekUploadToken,
} from "~/server/application/upload-token";
import { appendAudit } from "~/server/audit/log";
import { authBaseUrl } from "~/server/auth/auth";
import { getMailer } from "~/server/auth/send-invite";
import { lastFour } from "~/server/crypto/encrypt";
import type { DB, DBOrTx } from "~/server/db/client";
import { allocateDocRef } from "~/server/db/doc-ref";
import { escapeLike } from "~/server/db/like";
import { withUniqueRetry } from "~/server/db/retry";
import { abteilungenTable, memberAbteilungenTable } from "~/server/db/schema/abteilungen";
import { attachmentsTable } from "~/server/db/schema/attachments";
import { contractsTable } from "~/server/db/schema/contracts";
import { emailLogTable } from "~/server/db/schema/email-log";
import { familienMitgliederTable, familienTable } from "~/server/db/schema/familien";
import { feeTypesTable } from "~/server/db/schema/fee-types";
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
import { relationshipsTable } from "~/server/db/schema/relationships";
import { sepaMandatesTable } from "~/server/db/schema/sepa";
import {
  type Altersgrenzen,
  type Antragstyp,
  detectAntragstyp,
  mitgliedschaftTypFor,
  parseISODate,
  realAge,
} from "~/server/domain/application/antragstyp";
import { divergentKontoinhaber } from "~/server/domain/application/payer";
import { resolveApplicationFee } from "~/server/domain/application/resolve-fee";
import { findDuplicateCandidates } from "~/server/domain/member/duplicate-detection";
import { type OnboardContractValues, onboardMember } from "~/server/domain/member/onboard";
import { lookupBankByIban } from "~/server/lib/blz";
import { toCsv } from "~/server/lib/csv";
import { logger } from "~/server/lib/logger";
import { EMAIL_KIND, type EmailLogEntry, recordEmail } from "~/server/mail/email-log";
import {
  sendApplicationDocumentMail,
  sendApplicationMails,
} from "~/server/mail/send-application-mail";
import { errorLogFields, publicProc, vorstandProc } from "~/server/orpc/base";
import { parsePayerName } from "~/server/orpc/procedures/sepa";
import { buildBeitrittModel } from "~/server/pdf/beitrittserklaerung-model";
import { resolveClubLogo } from "~/server/pdf/logo";
import { renderPdfBase64 } from "~/server/pdf/renderer";
import { BeitrittserklaerungDocument } from "~/server/pdf/templates/beitrittserklaerung";
import { rateLimit } from "~/server/redis/client";
import { deleteObject, getObject, presignDownload, putObject } from "~/server/s3/client";
import { invalidateMemberCaches } from "~/server/search/cache";
import { formatIbanGrouped, normalizeIban, validateIban } from "~/server/sepa/iban";
import { takeMemberSnapshot } from "~/server/snapshots/snapshot";
import type { Tenant } from "~/server/tenants/registry";

const execFileAsync = promisify(execFile);
const MAX_SIGNED_UPLOAD_BYTES = 10 * MIB;
const MAX_ADMIN_UPLOAD_BYTES = 20 * MIB;

const ANRede = v.picklist(["Herr", "Frau", "keine Angabe"]);
const ISODate = v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/));
const Name = v.pipe(v.string(), v.trim(), v.minLength(2), v.maxLength(100));

// Bounded so a crafted public submit can't send a huge array (memory / work
// amplification). A club has far fewer than 50 Abteilungen and families far
// fewer than 30 children.
const AbteilungIds = v.pipe(v.array(v.pipe(v.string(), v.maxLength(64))), v.maxLength(50));

const KindInput = v.object({
  vorname: Name,
  nachname: Name,
  geburtsdatum: ISODate,
  abteilungen: AbteilungIds,
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
  telefonOptOut: v.optional(v.boolean(), false),
  email: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.email())), null),
  abteilungen: AbteilungIds,
  erziehungsberechtigterVorname: v.optional(v.nullable(v.string()), null),
  erziehungsberechtigterNachname: v.optional(v.nullable(v.string()), null),
  partnerVorname: v.optional(v.nullable(v.string()), null),
  partnerNachname: v.optional(v.nullable(v.string()), null),
  partnerGeburtsdatum: v.optional(v.nullable(ISODate), null),
  partnerAbteilungen: v.optional(AbteilungIds, []),
  kinder: v.optional(v.pipe(v.array(KindInput), v.maxLength(30)), []),
  elternteilMitglied: v.optional(v.boolean(), false),
  kontoinhaber: v.optional(v.nullable(v.string()), null),
  iban: v.pipe(v.string(), v.minLength(15)),
  bic: v.optional(v.nullable(v.string()), null),
  kreditinstitut: v.optional(v.nullable(v.string()), null),
  /** Inline signature PNG as a data URI; absent for the paper-form path.
   *  Bounded so a crafted submit cannot pin memory or stall the PDF render
   *  (a real signature data URI is a few KB; 3 MB is a generous ceiling). */
  unterschriftBase64: v.optional(v.nullable(v.pipe(v.string(), v.maxLength(3_000_000))), null),
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

function baseUrl(tenant: Tenant): string {
  return authBaseUrl(tenant).replace(/\/+$/, "");
}

function statusUrlFor(tenant: Tenant, antragsnummer: string, token: string): string {
  return buildStatusUrl(baseUrl(tenant), antragsnummer, token);
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

async function extractTextBestEffort(opts: {
  bytes: Buffer;
  filename: string | null;
  mimeType: string | null;
}): Promise<{ available: boolean; text: string | null; error: string | null }> {
  const ext = (opts.filename?.split(".").pop() ?? "").toLowerCase();
  const mime = opts.mimeType ?? "";
  const dir = await mkdtemp(join(tmpdir(), "kontor2-ocr-"));
  try {
    const input = join(dir, `scan.${ext || (mime.includes("pdf") ? "pdf" : "bin")}`);
    await writeFile(input, opts.bytes);
    if (mime === "application/pdf" || ext === "pdf") {
      try {
        const { stdout } = await execFileAsync("pdftotext", ["-layout", input, "-"], {
          timeout: 30_000,
          maxBuffer: 2 * 1024 * 1024,
        });
        return { available: true, text: stdout.trim(), error: null };
      } catch {
        return {
          available: false,
          text: null,
          error:
            "pdftotext ist auf diesem Server nicht installiert oder konnte den Scan nicht lesen.",
        };
      }
    }
    if (mime.startsWith("image/") || ["jpg", "jpeg", "png", "tif", "tiff"].includes(ext)) {
      const outBase = join(dir, "out");
      try {
        await execFileAsync("tesseract", [input, outBase, "-l", "deu+eng"], {
          timeout: 60_000,
          maxBuffer: 2 * 1024 * 1024,
        });
        const text = await readFile(`${outBase}.txt`, "utf8");
        return { available: true, text: text.trim(), error: null };
      } catch {
        return {
          available: false,
          text: null,
          error:
            "Tesseract ist auf diesem Server nicht installiert oder konnte das Bild nicht lesen.",
        };
      }
    }
    return {
      available: false,
      text: null,
      error: "OCR für dieses Dateiformat ist nicht verfügbar.",
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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

/** The club's configured fee-category age boundaries from its settings row. */
function altersgrenzenOf(org: OrganizationSettings): Altersgrenzen {
  return {
    kindMax: org.kategorieKindMaxAlter,
    jugendlichMax: org.kategorieJugendlichMaxAlter,
    jungerErwachsenerMax: org.kategorieJungerErwachsenerMaxAlter,
  };
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

  const fee = await resolveApplicationFee(db, {
    kategorie: app.mitgliedschaftTyp,
    elternteilMitglied: app.elternteilMitglied,
    staffel: org.beitragsstaffel,
    altersgrenzen: altersgrenzenOf(org),
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
      logoDataUri: resolveClubLogo(org.logo),
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

/** SEPA mandate input derived from an application, or null without an IBAN. */
function applicationSepaInput(app: MembershipApplication, ibanPlain: string | null) {
  return ibanPlain
    ? { mandatsNr: app.mandatsreferenz, unterschriftDatum: app.consentAt, gueltigAb: new Date() }
    : null;
}

/** Guardian name: explicit fields first, else from the Kontoinhaber, else a
 *  fallback under the child's family name so the IBAN is not dropped. */
function applicationGuardianName(app: MembershipApplication, ibanPlain: string | null) {
  const vor = app.erziehungsberechtigterVorname?.trim() || "";
  const nach = app.erziehungsberechtigterNachname?.trim() || "";
  if (nach || vor) return { vorname: vor, nachname: nach };
  if (app.kontoinhaber) return parsePayerName(app.kontoinhaber, app.nachname);
  if (ibanPlain) return { vorname: "", nachname: app.nachname?.trim() || "Erziehungsberechtigt" };
  return { vorname: "", nachname: "" };
}

/** Validate the Vorstand's contract choice against the current Beitragsarten
 * and turn the optional German decimal input into a database-safe value. */
async function resolveApprovalContract(
  db: DB,
  opts: {
    art: number | null;
    betrag: string | null;
    quotedArt: number | null;
    quotedBetrag: string | null;
    abwKontoInh: string | null;
    isDirectDebit: boolean;
  },
): Promise<OnboardContractValues | null> {
  if (opts.art == null) {
    if (opts.betrag?.trim()) {
      throw new ORPCError("VALIDATION_FAILED", {
        message: "Ein Betrag kann nur zusammen mit einer Beitragsart gespeichert werden.",
      });
    }
    return null;
  }

  const [feeType] = await db
    .select({
      art: feeTypesTable.art,
      bezeichnung: feeTypesTable.bezeichnung,
      betrag1: feeTypesTable.betrag1,
      nichAktiv: feeTypesTable.nichAktiv,
    })
    .from(feeTypesTable)
    .where(eq(feeTypesTable.art, opts.art))
    .limit(1);
  if (!feeType) {
    throw new ORPCError("NOT_FOUND", { message: "Beitragsart nicht gefunden." });
  }
  if (feeType.nichAktiv === "J") {
    throw new ORPCError("PRECONDITION_FAILED", {
      message: "Diese Beitragsart ist inaktiv. Bitte eine aktive Beitragsart wählen.",
    });
  }

  const rawBetrag =
    opts.betrag ?? (opts.art === opts.quotedArt ? opts.quotedBetrag : feeType.betrag1);
  const trimmed = rawBetrag?.trim() ?? "";
  const betrag = trimmed ? trimmed.replace(",", ".") : null;
  if (betrag != null && !/^\d+(?:\.\d{1,8})?$/.test(betrag)) {
    throw new ORPCError("VALIDATION_FAILED", {
      message: `Ungültiger Betrag: "${rawBetrag}".`,
    });
  }

  return {
    art: feeType.art,
    artName: feeType.bezeichnung?.trim() || `Art ${feeType.art}`,
    vertragNr: null,
    betrag,
    sollstellung: null,
    vertragBegin: new Date(),
    abwKontoInh: opts.abwKontoInh,
    isDirectDebit: opts.isDirectDebit,
  };
}

/**
 * Create the secondary members of an application around an already-existing
 * primary: the guardian (kontakt + payer + Vertreter, mandate on the guardian)
 * for a minor, or the partner, children and the Familie record (primary = payer)
 * for a family. Shared by both the create-new and the link-to-existing approval
 * paths so family/minor linking reuses the exact same modelling. Returns the
 * refs of the members it created.
 */
async function createApplicationSecondaries(
  tx: DBOrTx,
  opts: {
    app: MembershipApplication;
    primary: { id: string; adrNr: number };
    ibanPlain: string | null;
    fallbackEintritt: string;
    actorId: string;
    actorEmail: string;
    requestId: string | null;
  },
): Promise<string[]> {
  const { app, primary, ibanPlain } = opts;
  const sepa = applicationSepaInput(app, ibanPlain);
  const base = {
    fallbackEintritt: opts.fallbackEintritt,
    actorId: opts.actorId,
    actorEmail: opts.actorEmail,
    requestId: opts.requestId,
  };
  const refs: string[] = [];

  if (app.antragstyp === "kind") {
    const guardianName = applicationGuardianName(app, ibanPlain);
    if (guardianName.nachname || guardianName.vorname) {
      const guardian = await onboardMember(tx, {
        patch: {
          vorname: guardianName.vorname || null,
          nachname: guardianName.nachname || null,
          strasse: app.strasse,
          hausnummer: app.hausnummer,
          plz: app.plz,
          ort: app.ort,
          ...(ibanPlain
            ? {
                iban1: ibanPlain,
                iban1Last4: app.ibanLast4 ?? lastFour(ibanPlain),
                bic1: app.bic,
                abwKontoInh: app.kontoinhaber ?? null,
              }
            : {}),
        },
        isKontakt: true,
        status: "aktiv",
        abteilungen: [],
        contract: null,
        sepa,
        ...base,
      });
      refs.push(guardian.ref);
      await tx.insert(relationshipsTable).values({
        fromMemberId: primary.id,
        toMemberId: guardian.id,
        fromAdrNr: primary.adrNr,
        toAdrNr: guardian.adrNr,
        beziehung: "Erziehungsberechtigt",
        istVertreter: true,
      });
      for (const memberId of [primary.id, guardian.id]) {
        await takeMemberSnapshot(tx, memberId, {
          trigger: "mutation",
          actorId: opts.actorId,
          actorEmail: opts.actorEmail,
        });
      }
    }
  }

  if (app.antragstyp === "familie") {
    let partnerId: string | null = null;
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
        contract: null,
        sepa: null,
        ...base,
      });
      partnerId = p.id;
      refs.push(p.ref);
    }
    const childIds: string[] = [];
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
        contract: null,
        sepa: null,
        ...base,
      });
      childIds.push(c.id);
      refs.push(c.ref);
    }

    const today = new Date().toISOString().slice(0, 10);
    const [fam] = await tx
      .insert(familienTable)
      .values({ name: `Familie ${app.nachname}`, zahlerMemberId: primary.id })
      .returning({ id: familienTable.id });
    if (fam) {
      await tx.insert(familienMitgliederTable).values([
        { familieId: fam.id, memberId: primary.id, rolle: "zahler", von: today },
        ...(partnerId
          ? [{ familieId: fam.id, memberId: partnerId, rolle: "partner" as const, von: today }]
          : []),
        ...childIds.map((id) => ({
          familieId: fam.id,
          memberId: id,
          rolle: "kind" as const,
          von: today,
        })),
      ]);
      for (const memberId of [primary.id, ...(partnerId ? [partnerId] : []), ...childIds]) {
        await takeMemberSnapshot(tx, memberId, {
          trigger: "mutation",
          actorId: opts.actorId,
          actorEmail: opts.actorEmail,
        });
      }
    }
  }

  return refs;
}

/**
 * Approve an application by linking it to an EXISTING member instead of creating
 * a new one (the dedup gate's "verknüpfen" choice). Enriches only missing or
 * placeholder fields on the primary (never overwrites good data), adds a
 * contract/mandate only when the member has none, adds the Abteilungen, then
 * builds the same secondary members (guardian / partner / children / Familie) as
 * the create path. Works for einzel, kind and familie; for a minor the bank
 * details stay on the guardian, not the linked child.
 */
async function approveByLinking(
  db: DB,
  opts: {
    app: MembershipApplication;
    memberId: string;
    contract: OnboardContractValues | null;
    actorId: string;
    actorEmail: string;
    requestId: string | null;
  },
): Promise<{ primaryId: string; refs: string[] }> {
  const { app } = opts;
  const ibanPlain = app.iban?.trim() ? app.iban.trim() : null;
  // A minor's bank details belong on the guardian (created as a secondary), not
  // on the linked child, so the child primary is not enriched with IBAN/mandate.
  const isMinor = app.antragstyp === "kind";
  const today = new Date().toISOString().slice(0, 10);
  const isPlaceholderDob = (d: Date | string | null) => {
    if (!d) return true;
    return (d instanceof Date ? d : new Date(d)).toISOString().slice(0, 10).endsWith("-01-01");
  };

  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select({
        status: membershipApplicationsTable.status,
        memberId: membershipApplicationsTable.memberId,
      })
      .from(membershipApplicationsTable)
      .where(eq(membershipApplicationsTable.id, app.id))
      .limit(1)
      .for("update");
    if (!locked || locked.status === "genehmigt" || locked.memberId) {
      throw new ORPCError("CONFLICT", { message: "Antrag ist bereits genehmigt." });
    }

    const [member] = await tx
      .select()
      .from(membersTable)
      .where(and(eq(membersTable.id, opts.memberId), isNull(membersTable.deletedAt)))
      .limit(1);
    if (!member) {
      throw new ORPCError("NOT_FOUND", { message: "Verknüpftes Mitglied nicht gefunden." });
    }

    // Enrich only missing / placeholder fields; never overwrite good data.
    const patch: Record<string, unknown> = {};
    const changes: Record<string, { before: unknown; after: unknown }> = {};
    const fill = (key: keyof typeof member, value: unknown, missing: boolean) => {
      if (missing && value != null && String(value).trim() !== "") {
        patch[key as string] = value;
        changes[key as string] = { before: member[key] ?? null, after: value };
      }
    };
    fill("email", app.email, !member.email);
    fill("telefon1", app.telefon, !member.telefon1);
    fill("geburtsdatum", app.geburtsdatum, isPlaceholderDob(member.geburtsdatum));
    fill("strasse", app.strasse, !member.strasse);
    fill("hausnummer", app.hausnummer, !member.hausnummer);
    fill("plz", app.plz, !member.plz);
    fill("ort", app.ort, !member.ort);
    if (!isMinor && ibanPlain && !member.iban1) {
      patch.iban1 = ibanPlain;
      patch.iban1Last4 = app.ibanLast4 ?? lastFour(ibanPlain);
      patch.bic1 = app.bic;
      changes.iban1 = { before: null, after: app.ibanLast4 ?? lastFour(ibanPlain) };
    }
    if (Object.keys(patch).length > 0) {
      patch.updatedAt = new Date();
      await tx
        .update(membersTable)
        .set(patch as never)
        .where(eq(membersTable.id, member.id));
    }

    const ref = (member.memberNo ??
      member.kontaktNo ??
      member.mitgliedsnummer ??
      `A${member.adrNr}`) as string;

    // Contract only when the member has no currently billable contract and the
    // reviewer picked a Beitragsart. Historical contracts may keep vertrag_ende
    // null while gekuend_zum closes them for billing.
    const now = new Date();
    const existingContract = await tx
      .select({ id: contractsTable.id })
      .from(contractsTable)
      .where(
        and(
          eq(contractsTable.memberId, member.id),
          or(isNull(contractsTable.vertragEnde), gt(contractsTable.vertragEnde, now)),
          or(isNull(contractsTable.gekuendZum), gt(contractsTable.gekuendZum, now)),
        ),
      )
      .limit(1);
    if (existingContract.length === 0 && opts.contract) {
      const existingNumbers = await tx
        .select({ vertragNr: contractsTable.vertragNr })
        .from(contractsTable)
        .where(eq(contractsTable.adrNr, member.adrNr));
      const nextVertragNr =
        Math.max(
          0,
          ...existingNumbers
            .map((r) => Number.parseInt(r.vertragNr, 10))
            .filter((n) => Number.isFinite(n)),
        ) + 1;
      await tx.insert(contractsTable).values({
        memberId: member.id,
        adrNr: member.adrNr,
        mitglNr: ref,
        vertragNr: String(nextVertragNr),
        art: opts.contract.art,
        artName: opts.contract.artName,
        betrag: opts.contract.betrag,
        sollstellung: opts.contract.sollstellung,
        vertragBegin: opts.contract.vertragBegin,
        abwKontoInh: opts.contract.abwKontoInh ?? null,
        isDirectDebit: opts.contract.isDirectDebit ?? false,
      } as never);
      changes.vertragAngelegt = { before: null, after: 1 };
    }

    // SEPA mandate only when none exists and an IBAN is on file.
    const existingMandate = await tx
      .select({ id: sepaMandatesTable.id })
      .from(sepaMandatesTable)
      .where(and(eq(sepaMandatesTable.memberId, member.id), eq(sepaMandatesTable.isDeleted, false)))
      .limit(1);
    if (!isMinor && existingMandate.length === 0 && ibanPlain) {
      await tx.insert(sepaMandatesTable).values({
        memberId: member.id,
        adrNr: member.adrNr,
        mandatsNr: app.mandatsreferenz ?? "M1",
        angelegtAm: new Date(),
        unterschriftDatum: app.consentAt,
        gueltigAb: new Date(),
      } as never);
      changes.mandatAngelegt = { before: null, after: 1 };
    }

    // Abteilungen: additive.
    let abtAdded = 0;
    for (const abteilungId of app.abteilungen ?? []) {
      const active = await tx
        .select({ memberId: memberAbteilungenTable.memberId })
        .from(memberAbteilungenTable)
        .where(
          and(
            eq(memberAbteilungenTable.memberId, member.id),
            eq(memberAbteilungenTable.abteilungId, abteilungId),
            isNull(memberAbteilungenTable.austrittsdatum),
          ),
        )
        .limit(1);
      if (active.length > 0) continue;
      const r = await tx
        .insert(memberAbteilungenTable)
        .values({ memberId: member.id, abteilungId, eintrittsdatum: today })
        .onConflictDoNothing()
        .returning({ memberId: memberAbteilungenTable.memberId });
      if (r.length) abtAdded++;
    }
    if (abtAdded > 0) changes.abteilungenAdded = { before: null, after: abtAdded };

    // Build the secondary members (guardian / partner / children / Familie)
    // around the linked primary, exactly as the create path does.
    const secondaryRefs = await createApplicationSecondaries(tx, {
      app,
      primary: { id: member.id, adrNr: member.adrNr },
      ibanPlain,
      fallbackEintritt: today,
      actorId: opts.actorId,
      actorEmail: opts.actorEmail,
      requestId: opts.requestId,
    });
    const allRefs = [ref, ...secondaryRefs];
    if (secondaryRefs.length > 0) {
      changes.weitereMitglieder = { before: null, after: secondaryRefs.join(", ") };
    }

    await tx
      .update(membershipApplicationsTable)
      .set({
        status: "genehmigt",
        memberId: member.id,
        mitgliedsnummer: allRefs.join(", "),
        updatedAt: new Date(),
      })
      .where(eq(membershipApplicationsTable.id, app.id));

    changes.verknuepfterAntrag = { before: null, after: app.antragsnummer };
    const memberAuditId = await appendAudit(tx, {
      entityType: "member",
      entityId: member.id,
      action: "update",
      source: "ui",
      actorId: opts.actorId,
      actorEmail: opts.actorEmail,
      changes,
      requestId: opts.requestId,
    });
    await takeMemberSnapshot(tx, member.id, {
      trigger: "mutation",
      actorId: opts.actorId,
      actorEmail: opts.actorEmail,
      auditId: memberAuditId,
    });
    await appendAudit(tx, {
      entityType: "membership_application",
      entityId: app.id,
      action: "update",
      source: "ui",
      actorId: opts.actorId,
      actorEmail: opts.actorEmail,
      changes: {
        status: { before: app.status, after: "genehmigt" },
        memberId: { before: null, after: member.id },
      },
      requestId: opts.requestId,
    });

    return { primaryId: member.id, refs: allRefs };
  });
}

/**
 * Copy an approved application's documents (signed scan + the generated
 * Beitrittserklärung) into the member's attachments, so they are findable on the
 * member, not only on the application. The attachments `s3_key` is unique, so we
 * copy the S3 object to a per-member key. Idempotent and best-effort: a failure
 * is logged but never undoes the approval.
 */
async function attachApplicationFilesToMember(
  db: DB,
  applicationId: string,
  memberId: string,
  uploadedBy: string,
): Promise<void> {
  const files = await db
    .select()
    .from(membershipApplicationFilesTable)
    .where(
      and(
        eq(membershipApplicationFilesTable.applicationId, applicationId),
        inArray(membershipApplicationFilesTable.kind, ["signed_scan", "approved_pdf"]),
      ),
    );
  for (const f of files) {
    const destKey = `members/${memberId}/antrag-${f.kind}-${f.id}`;
    try {
      const [existing] = await db
        .select({ id: attachmentsTable.id })
        .from(attachmentsTable)
        .where(eq(attachmentsTable.s3Key, destKey))
        .limit(1);
      if (existing) continue;
      const bytes = await getObject(f.s3Key);
      const mime =
        f.mimeType ?? (f.kind === "approved_pdf" ? "application/pdf" : "application/octet-stream");
      await putObject({ key: destKey, body: bytes, contentType: mime });
      const filename =
        f.filename ??
        (f.kind === "approved_pdf"
          ? "Beitrittserklaerung-genehmigt.pdf"
          : "Beitrittserklaerung-Scan");
      await db.insert(attachmentsTable).values({
        memberId,
        filename,
        mimeType: mime,
        sizeBytes: f.sizeBytes ?? bytes.length,
        s3Key: destKey,
        uploadedBy,
      });
    } catch (err) {
      logger.error("application.approve.attach_failed", {
        applicationId,
        memberId,
        fileId: f.id,
        ...errorLogFields(err),
      });
    }
  }
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
      anschriftStrasse: org?.anschriftStrasse ?? null,
      anschriftPlz: org?.anschriftPlz ?? null,
      anschriftOrt: org?.anschriftOrt ?? null,
      kontaktEmail: org?.kontaktEmail ?? null,
      kontaktTelefon: org?.kontaktTelefon ?? null,
      datenschutzUrl: org?.datenschutzUrl ?? null,
      satzungUrl: org?.satzungUrl ?? null,
      glaeubigerId: org?.glaeubigerId ?? null,
      beitragsstaffel: org?.beitragsstaffel ?? null,
      tenantPolicy: normalizeTenantPolicy(org?.tenantPolicy),
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
      const [org] = await context.db.select().from(organizationSettingsTable).limit(1);
      if (!org) {
        throw new ORPCError("PRECONDITION_FAILED", {
          message: "Der Verein hat das Antragsformular noch nicht eingerichtet.",
        });
      }
      const kategorie = mitgliedschaftTypFor(
        input.antragstyp as Antragstyp,
        dob,
        altersgrenzenOf(org),
      );
      // Quote from the Beitragsart tagged for this role; falls back to the
      // Staffel, throws if neither is configured.
      const fee = await resolveApplicationFee(context.db, {
        kategorie,
        elternteilMitglied: input.elternteilMitglied,
        staffel: org.beitragsstaffel,
        altersgrenzen: altersgrenzenOf(org),
      });
      return { kategorie, jahresbeitrag: fee.betrag, label: fee.label, art: fee.art };
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

  /** PLZ -> Ort resolution for the public form (OpenStreetMap Nominatim). */
  lookupPlz: publicProc
    .input(v.object({ plz: v.pipe(v.string(), v.regex(/^\d{5}$/)) }))
    .handler(async ({ context, input }) => {
      const limit = await rateLimit({
        key: `antrag-plz:${clientIp(context.headers)}`,
        limit: 60,
        windowSeconds: 60,
      });
      if (!limit.allowed) {
        throw new ORPCError("TOO_MANY_REQUESTS", { message: "Zu viele Anfragen." });
      }
      return { orte: await lookupPlz(input.plz) };
    }),

  /** Street autocomplete for the public form, optionally scoped by PLZ. */
  searchStreets: publicProc
    .input(
      v.object({
        query: v.pipe(v.string(), v.trim(), v.maxLength(120)),
        plz: v.optional(v.nullable(v.string()), null),
      }),
    )
    .handler(async ({ context, input }) => {
      const limit = await rateLimit({
        key: `antrag-street:${clientIp(context.headers)}`,
        limit: 60,
        windowSeconds: 60,
      });
      if (!limit.allowed) {
        throw new ORPCError("TOO_MANY_REQUESTS", { message: "Zu viele Anfragen." });
      }
      return { results: await searchStreets(input.query, input.plz ?? undefined) };
    }),

  /** Duplicate guard on name + DOB against members and open applications. */
  checkDuplicate: publicProc
    .input(v.object({ vorname: v.string(), nachname: v.string(), geburtsdatum: ISODate }))
    .handler(async ({ context, input }) => {
      // Public, so return only a boolean: no member PII may leak to an anonymous
      // applicant. The Vorstand gets the scored candidates via duplicateCandidates.
      const candidates = await findDuplicateCandidates(context.db, {
        vorname: input.vorname,
        nachname: input.nachname,
        geburtsdatum: input.geburtsdatum,
      });
      return { duplicate: candidates.length > 0 };
    }),

  /**
   * Scored duplicate candidates (existing members + other open applications) for
   * one application, for the approval screen's dedup gate. Vorstand only, so it
   * may return identifying details. The IBAN is the strongest signal.
   */
  duplicateCandidates: vorstandProc
    .input(v.object({ applicationId: v.pipe(v.string(), v.uuid()) }))
    .handler(async ({ context, input }) => {
      const [app] = await context.db
        .select({
          id: membershipApplicationsTable.id,
          vorname: membershipApplicationsTable.vorname,
          nachname: membershipApplicationsTable.nachname,
          geburtsdatum: membershipApplicationsTable.geburtsdatum,
          iban: membershipApplicationsTable.iban,
          ibanLast4: membershipApplicationsTable.ibanLast4,
          email: membershipApplicationsTable.email,
          plz: membershipApplicationsTable.plz,
        })
        .from(membershipApplicationsTable)
        .where(eq(membershipApplicationsTable.id, input.applicationId))
        .limit(1);
      if (!app) throw new ORPCError("NOT_FOUND", { message: "Antrag nicht gefunden." });
      const candidates = await findDuplicateCandidates(
        context.db,
        {
          vorname: app.vorname,
          nachname: app.nachname,
          geburtsdatum: app.geburtsdatum,
          iban: app.iban,
          ibanLast4: app.ibanLast4,
          email: app.email,
          plz: app.plz,
        },
        { applicationId: app.id },
      );
      return { candidates };
    }),

  /** Public status lookup by an application-scoped bearer token. */
  lookupStatus: publicProc
    .input(
      v.object({
        antragsnummer: v.string(),
        token: v.pipe(v.string(), v.minLength(32), v.maxLength(128)),
      }),
    )
    .handler(async ({ context, input }) => {
      // Throttle per IP: the Antragsnummer is a low-entropy reference
      // (ANT-YYYY-NNNN), so without a limit the status of every application
      // could be enumerated. 20 lookups per 5 minutes covers an applicant
      // checking back without enabling a sweep.
      const limit = await rateLimit({
        key: `antrag-status:${clientIp(context.headers)}`,
        limit: 20,
        windowSeconds: 300,
      });
      if (!limit.allowed) {
        throw new ORPCError("TOO_MANY_REQUESTS", {
          message: "Zu viele Anfragen. Bitte versuchen Sie es in einigen Minuten erneut.",
        });
      }
      const grant = await peekStatusToken(context.db, input.token);
      if (!grant) throw new ORPCError("NOT_FOUND", { message: "Status-Link ungültig." });
      const [row] = await context.db
        .select({
          antragsnummer: membershipApplicationsTable.antragsnummer,
          status: membershipApplicationsTable.status,
          adminDeclineReason: membershipApplicationsTable.adminDeclineReason,
          createdAt: membershipApplicationsTable.createdAt,
        })
        .from(membershipApplicationsTable)
        .where(
          and(
            eq(membershipApplicationsTable.id, grant.applicationId),
            eq(membershipApplicationsTable.antragsnummer, input.antragsnummer.trim().toUpperCase()),
          ),
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

    const fail = (message: string) => {
      throw new ORPCError("VALIDATION_FAILED", { message });
    };
    const mainNameErrors = [
      validateNameMessage(input.vorname, "Vorname"),
      validateNameMessage(input.nachname, "Nachname"),
    ].filter(Boolean);
    if (mainNameErrors[0]) fail(mainNameErrors[0]);
    const dobMessage = validatePastDateMessage(input.geburtsdatum, "Geburtsdatum", {
      maxAge: 120,
    });
    if (dobMessage) fail(dobMessage);

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
    const [org] = await context.db.select().from(organizationSettingsTable).limit(1);
    if (!org) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Der Verein hat das Antragsformular noch nicht eingerichtet.",
      });
    }
    const tenantPolicy = normalizeTenantPolicy(org.tenantPolicy);
    const antragstyp = detectAntragstyp({
      geburtsdatum: dob,
      hasChildren,
      hasPartner,
      familyPartnerRequired: tenantPolicy.familyPartnerRequired,
    });
    const kategorie = mitgliedschaftTypFor(antragstyp, dob, altersgrenzenOf(org));

    if (antragstyp === "kind") {
      const gv = validateNameMessage(
        input.erziehungsberechtigterVorname ?? "",
        "Vorname der gesetzlichen Vertretung",
      );
      if (gv) fail(gv);
      const gn = validateNameMessage(
        input.erziehungsberechtigterNachname ?? "",
        "Nachname der gesetzlichen Vertretung",
      );
      if (gn) fail(gn);
    }

    if (!input.strasse?.trim() || input.strasse.trim().length < 3) {
      fail("Bitte eine vollständige Straße angeben.");
    }
    const plzMessage = validatePlzMessage(input.plz ?? "");
    if (plzMessage) fail(plzMessage);
    if (!input.ort?.trim() || input.ort.trim().length < 2) fail("Ort ist erforderlich.");
    const phoneMessage = validatePhoneMessage(input.telefon ?? "", input.telefonOptOut);
    if (phoneMessage) fail(phoneMessage);

    const iban = normalizeIban(input.iban);
    const ibanMessage = validateIbanMessage(iban);
    if (ibanMessage || !validateIban(iban)) fail(ibanMessage ?? "IBAN ungültig.");
    const bicMessage = validateBicMessage(input.bic);
    if (bicMessage) fail(bicMessage);

    if (hasChildren) {
      if (tenantPolicy.familyPartnerRequired && !hasPartner) {
        fail(
          "Für die Familienmitgliedschaft ist ein Partner oder zweites Elternteil erforderlich.",
        );
      }
      if (hasPartner) {
        const pv = validateNameMessage(input.partnerVorname ?? "", "Vorname des Partners");
        if (pv) fail(pv);
        const pn = validateNameMessage(input.partnerNachname ?? "", "Nachname des Partners");
        if (pn) fail(pn);
        const pd = validatePastDateMessage(
          input.partnerGeburtsdatum ?? "",
          "Geburtsdatum des Partners",
          { maxAge: 120 },
        );
        if (pd) fail(pd);
        if ((realAgeFromIso(input.partnerGeburtsdatum ?? "") ?? 0) < 18) {
          fail("Partner oder zweites Elternteil muss volljährig sein.");
        }
      }
      for (const [idx, kind] of (input.kinder ?? []).entries()) {
        const kv = validateNameMessage(kind.vorname, `Vorname von Kind ${idx + 1}`);
        if (kv) fail(kv);
        const kn = validateNameMessage(kind.nachname, `Nachname von Kind ${idx + 1}`);
        if (kn) fail(kn);
        const kd = validatePastDateMessage(kind.geburtsdatum, `Geburtsdatum von Kind ${idx + 1}`);
        if (kd) fail(kd);
        if ((realAgeFromIso(kind.geburtsdatum) ?? 99) > tenantPolicy.familyChildMaxAge) {
          fail(`Kind ${idx + 1} darf höchstens ${tenantPolicy.familyChildMaxAge} Jahre alt sein.`);
        }
        if (tenantPolicy.departmentPerPersonRequired && kind.abteilungen.length === 0) {
          fail(`Für Kind ${idx + 1} muss mindestens eine Abteilung gewählt werden.`);
        }
      }
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
    for (const id of input.partnerAbteilungen) {
      if (!abtNames.has(id)) {
        throw new ORPCError("VALIDATION_FAILED", { message: "Ungültige Partner-Abteilung." });
      }
    }
    for (const kind of input.kinder ?? []) {
      for (const id of kind.abteilungen) {
        if (!abtNames.has(id)) {
          throw new ORPCError("VALIDATION_FAILED", { message: "Ungültige Kinder-Abteilung." });
        }
      }
    }

    const fee = await resolveApplicationFee(context.db, {
      kategorie,
      elternteilMitglied: input.elternteilMitglied,
      staffel: org.beitragsstaffel,
      altersgrenzen: altersgrenzenOf(org),
    });
    const year = new Date().getUTCFullYear();
    const geschlecht: "m" | "w" | "unbekannt" | null = input.geschlecht
      ? (GESCHLECHT_MAP[input.geschlecht] ?? "unbekannt")
      : null;
    const signature = input.unterschriftBase64 ? parseDataUri(input.unterschriftBase64) : null;
    if (
      input.unterschriftBase64 &&
      (!signature ||
        !["image/png", "image/jpeg"].includes(signature.mime) ||
        signature.body.byteLength === 0)
    ) {
      fail("Die Unterschrift muss ein gültiges PNG- oder JPEG-Bild sein.");
    }
    const hasSignature = signature !== null;

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
          // Document storage happens after the row commit. Only advance the
          // workflow once the PDF and its file record are durable.
          status: "neu",
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
          vorgeschlageneArt: fee.art,
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
      const statusToken = await issueStatusToken(tx, { applicationId: row.id });
      return { ...row, statusToken: statusToken.rawToken };
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
          logoDataUri: resolveClubLogo(org.logo),
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
      if (hasSignature) {
        await context.db
          .update(membershipApplicationsTable)
          .set({ status: "dokument_hochgeladen", updatedAt: new Date() })
          .where(eq(membershipApplicationsTable.id, inserted.id));
      }

      // Keep the raw inline signature on its own so the genehmigte PDF can
      // re-embed it later next to the Vorstands-Gegenzeichnung.
      if (signature) {
        const sigKey = `applications/${inserted.id}/signature.${signature.mime === "image/jpeg" ? "jpg" : "png"}`;
        await putObject({ key: sigKey, body: signature.body, contentType: signature.mime });
        await context.db.insert(membershipApplicationFilesTable).values({
          applicationId: inserted.id,
          kind: "signature_image",
          s3Key: sigKey,
          filename: `signature-${inserted.antragsnummer}.${signature.mime === "image/jpeg" ? "jpg" : "png"}`,
          mimeType: signature.mime,
          sizeBytes: signature.body.byteLength,
        });
      }

      // Paper path (no inline signature): hand out a 30-day upload link.
      if (!hasSignature) {
        const token = await issueUploadToken(context.db, { applicationId: inserted.id });
        uploadUrl = buildUploadUrl(baseUrl(context.tenant), token.rawToken);
      }

      const clubEmail = org.antragVorstandEmail ?? org.mitgliedschaftEmail ?? org.kontaktEmail;
      const mailRes = await sendApplicationMails(context.db, {
        vereinsname: org.vereinsname,
        applicantEmail: input.email,
        applicantName:
          antragstyp === "kind"
            ? `${input.erziehungsberechtigterVorname ?? ""} ${input.erziehungsberechtigterNachname ?? ""}`.trim()
            : `${input.vorname} ${input.nachname}`.trim(),
        clubEmail,
        notifyClub: org.antragBenachrichtigungAktiv,
        antragsnummer: inserted.antragsnummer,
        statusUrl: statusUrlFor(context.tenant, inserted.antragsnummer, inserted.statusToken),
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
      statusUrl: statusUrlFor(context.tenant, inserted.antragsnummer, inserted.statusToken),
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
        contentBase64: v.pipe(
          v.string(),
          v.minLength(1),
          v.maxLength(maxBase64Length(MAX_SIGNED_UPLOAD_BYTES)),
        ),
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
      const body = decodeBase64Upload(
        input.contentBase64,
        MAX_SIGNED_UPLOAD_BYTES,
        "Datei zu groß (max. 10 MB).",
      );
      // Resolve the token WITHOUT consuming it, store the file in S3, and only
      // then consume the token. Consuming first meant a transient S3 failure
      // burned the single-use link forever with no file stored. peek->store->
      // consume keeps the link reusable if the upload fails; the consume still
      // closes the concurrent-claim race (consumed_at IS NULL guard).
      const peek = await peekUploadToken(context.db, input.token);
      if (!peek) {
        throw new ORPCError("NOT_FOUND", {
          message: "Der Upload-Link ist ungültig, abgelaufen oder bereits benutzt.",
        });
      }
      const ext = extensionForMimeType(input.mimeType) ?? "bin";
      const s3Key = `applications/${peek.applicationId}/signed-${randomUUID()}.${ext}`;
      await putObject({ key: s3Key, body, contentType: input.mimeType });

      let claim: { applicationId: string } | null;
      try {
        claim = await consumeUploadToken(context.db, input.token, async (tx, applicationId) => {
          await tx.insert(membershipApplicationFilesTable).values({
            applicationId,
            kind: "signed_scan",
            s3Key,
            filename: input.filename,
            mimeType: input.mimeType,
            sizeBytes: body.byteLength,
          });
          await tx
            .update(membershipApplicationsTable)
            .set({ status: "dokument_hochgeladen", updatedAt: new Date() })
            .where(
              and(
                eq(membershipApplicationsTable.id, applicationId),
                eq(membershipApplicationsTable.status, "neu"),
              ),
            );
        });
      } catch (error) {
        await deleteObject(s3Key).catch(() => undefined);
        throw error;
      }
      if (!claim) {
        await deleteObject(s3Key).catch(() => undefined);
        throw new ORPCError("NOT_FOUND", {
          message: "Der Upload-Link ist ungültig, abgelaufen oder bereits benutzt.",
        });
      }
      return { ok: true };
    }),

  /**
   * Public: accept a scan of an already-filled PAPER Beitrittserklärung without
   * the applicant filling the online form. Creates a `scan_eingegangen`
   * placeholder application whose person fields are filled in later by the
   * Vorstand from the scan; stores the file and (best-effort) notifies the club
   * and the applicant. Capped at 20 MB.
   */
  submitPaperScan: publicProc
    .input(
      v.object({
        filename: v.pipe(v.string(), v.minLength(1)),
        mimeType: v.pipe(v.string(), v.minLength(1)),
        contentBase64: v.pipe(
          v.string(),
          v.minLength(1),
          v.maxLength(maxBase64Length(MAX_ADMIN_UPLOAD_BYTES)),
        ),
        email: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.email())), null),
      }),
    )
    .handler(async ({ context, input }) => {
      const limit = await rateLimit({
        key: `antrag-paper:${clientIp(context.headers)}`,
        limit: 5,
        windowSeconds: 600,
      });
      if (!limit.allowed) {
        throw new ORPCError("TOO_MANY_REQUESTS", {
          message: "Zu viele Uploads. Bitte versuchen Sie es in einigen Minuten erneut.",
        });
      }
      const allowed = ["application/pdf", "image/jpeg", "image/png", "image/heic"];
      if (!allowed.includes(input.mimeType)) {
        throw new ORPCError("VALIDATION_FAILED", { message: "Nicht erlaubtes Dateiformat." });
      }
      const body = decodeBase64Upload(
        input.contentBase64,
        MAX_ADMIN_UPLOAD_BYTES,
        "Datei zu groß (max. 20 MB).",
      );
      const [org] = await context.db.select().from(organizationSettingsTable).limit(1);
      if (!org) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Der Verein hat das Antragsformular noch nicht eingerichtet.",
        });
      }

      const year = new Date().getUTCFullYear();
      const applicationId = randomUUID();
      const ext = extensionForMimeType(input.mimeType) ?? "bin";
      const s3Key = `applications/${applicationId}/paper-${randomUUID()}.${ext}`;
      await putObject({ key: s3Key, body, contentType: input.mimeType });
      // Placeholder person fields: the row carries no real applicant data until
      // the Vorstand transcribes the scan. They are NOT NULL in the schema, so
      // use clearly-marked sentinels that read as "needs entry" in the list.
      let inserted: { id: string; antragsnummer: string; statusToken: string };
      try {
        inserted = await context.db.transaction(async (tx) => {
          const antragsnummer = await allocateDocRef(tx, "ANT", year);
          const [row] = await tx
            .insert(membershipApplicationsTable)
            .values({
              id: applicationId,
              antragsnummer,
              antragstyp: "einzel",
              status: "scan_eingegangen",
              source: "legacy",
              mitgliedschaftTyp: "erwachsener",
              vorname: "Papier-Antrag",
              nachname: "(zu erfassen)",
              geburtsdatum: new Date("1900-01-01"),
              email: input.email,
              consentIp: clientIp(context.headers),
            })
            .returning({
              id: membershipApplicationsTable.id,
              antragsnummer: membershipApplicationsTable.antragsnummer,
            });
          if (!row) {
            throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Anlage fehlgeschlagen." });
          }
          await tx.insert(membershipApplicationFilesTable).values({
            applicationId: row.id,
            kind: "signed_scan",
            s3Key,
            filename: input.filename,
            mimeType: input.mimeType,
            sizeBytes: body.byteLength,
          });
          const statusToken = await issueStatusToken(tx, { applicationId: row.id });
          return { ...row, statusToken: statusToken.rawToken };
        });
      } catch (error) {
        await deleteObject(s3Key).catch(() => undefined);
        throw error;
      }

      // The scan is durable now. Notification remains best-effort.
      try {
        const records: EmailLogEntry[] = [];
        if (input.email) {
          const subject = `${org.vereinsname}: Ihr Papier-Antrag`;
          const bodyText = [
            "Hallo,",
            "",
            "vielen Dank. Ihr Papier-Antrag ist bei uns eingegangen.",
            `Ihre Vorgangsnummer lautet ${inserted.antragsnummer}.`,
            "",
            `Den aktuellen Stand sehen Sie hier: ${statusUrlFor(context.tenant, inserted.antragsnummer, inserted.statusToken)}`,
            "",
            "Bitte achten Sie darauf, dass auf dem Scan Ihre Kontaktdaten gut lesbar sind.",
          ].join("\n");
          const res = await sendApplicationDocumentMail(context.db, {
            to: input.email,
            subject,
            text: bodyText,
            subline: "Aufnahmeantrag",
          });
          records.push({
            kind: EMAIL_KIND.antragConfirmation,
            status: res.status,
            recipient: input.email,
            subject,
            bodyText,
            detail: res.detail,
          });
        }
        const clubEmail = org.antragVorstandEmail ?? org.mitgliedschaftEmail ?? org.kontaktEmail;
        if (org.antragBenachrichtigungAktiv && clubEmail) {
          const subject = `Neuer Papier-Antrag: ${inserted.antragsnummer}`;
          const bodyText = [
            "Ein neuer Papier-Antrag wurde über das Online-Formular hochgeladen.",
            `Vorgangsnummer: ${inserted.antragsnummer}.`,
            input.email ? `Kontakt: ${input.email}` : "Es wurde keine E-Mail angegeben.",
            "",
            "Bitte im Bereich Anträge prüfen und die Daten aus dem Scan erfassen.",
          ].join("\n");
          const res = await sendApplicationDocumentMail(context.db, {
            to: clubEmail,
            subject,
            text: bodyText,
            subline: "Interne Benachrichtigung",
            closing: null,
          });
          records.push({
            kind: EMAIL_KIND.antragClubNotification,
            status: res.status,
            recipient: clubEmail,
            subject,
            bodyText,
            detail: res.detail,
          });
        }
        if (records.length > 0) {
          if (records.some((r) => r.status === "sent")) {
            await context.db
              .update(membershipApplicationsTable)
              .set({ emailSent: true })
              .where(eq(membershipApplicationsTable.id, inserted.id));
          }
          await recordEmail(
            records.map((r) => ({
              ...r,
              entityType: "membership_application",
              entityId: inserted.id,
              requestId: context.requestId ?? null,
            })),
            context.db,
          );
        }
      } catch (err) {
        logger.error("application.paper.post_commit_failed", {
          antragsnummer: inserted.antragsnummer,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      return { antragsnummer: inserted.antragsnummer };
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
        /** Which archive bucket to show: active (default), only archived, or all. */
        archived: v.optional(v.picklist(["aktiv", "archiviert", "alle"]), "aktiv"),
        page: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1)), 1),
        pageSize: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(200)), 50),
      }),
    )
    .handler(async ({ context, input }) => {
      const t = membershipApplicationsTable;
      const conds = [];
      if (!input.includeTest) conds.push(eq(t.isTest, false));
      if (input.status) conds.push(eq(t.status, input.status));
      if (input.archived === "aktiv") conds.push(isNull(t.archivedAt));
      else if (input.archived === "archiviert") conds.push(sql`${t.archivedAt} is not null`);
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
          archivedAt: t.archivedAt,
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
      // Volle IBAN für die (vorstand-gesicherte) Antragsansicht: der Vorstand
      // braucht sie zur Mandatsprüfung. Eine IBAN ist kein Passwort -> nicht maskiert.
      return {
        ...row,
        ibanFormatted: row.iban ? formatIbanGrouped(row.iban) : null,
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
          mimeType: membershipApplicationFilesTable.mimeType,
          kind: membershipApplicationFilesTable.kind,
        })
        .from(membershipApplicationFilesTable)
        .where(eq(membershipApplicationFilesTable.id, input.id))
        .limit(1);
      if (!file || file.kind === "signature_image") {
        throw new ORPCError("NOT_FOUND", { message: "Datei nicht gefunden." });
      }
      // Inline-Disposition, damit der eingebaute PDF-Viewer das Dokument anzeigt
      // statt es herunterzuladen.
      const url = await presignDownload({
        key: file.s3Key,
        filename: file.filename ?? "antrag.pdf",
        expiresSeconds: 300,
        inline: true,
        contentType: file.mimeType ?? "application/pdf",
      });
      return { url, filename: file.filename ?? "antrag.pdf" };
    }),

  /** Best-effort OCR/text extraction for an uploaded signed scan. */
  fileText: vorstandProc
    .input(v.object({ id: v.pipe(v.string(), v.uuid()) }))
    .handler(async ({ context, input }) => {
      const [file] = await context.db
        .select({
          s3Key: membershipApplicationFilesTable.s3Key,
          filename: membershipApplicationFilesTable.filename,
          mimeType: membershipApplicationFilesTable.mimeType,
          kind: membershipApplicationFilesTable.kind,
        })
        .from(membershipApplicationFilesTable)
        .where(eq(membershipApplicationFilesTable.id, input.id))
        .limit(1);
      if (file?.kind !== "signed_scan") {
        throw new ORPCError("NOT_FOUND", { message: "Scan nicht gefunden." });
      }
      const bytes = await getObject(file.s3Key);
      return extractTextBestEffort({
        bytes,
        filename: file.filename,
        mimeType: file.mimeType,
      });
    }),

  /** Vorstand: resend the initial application confirmation/club notification. */
  resendInitialMail: vorstandProc
    .input(v.object({ id: v.pipe(v.string(), v.uuid()) }))
    .handler(async ({ context, input }) => {
      const [app] = await context.db
        .select()
        .from(membershipApplicationsTable)
        .where(eq(membershipApplicationsTable.id, input.id))
        .limit(1);
      if (!app) throw new ORPCError("NOT_FOUND", { message: "Antrag nicht gefunden." });
      const [org] = await context.db.select().from(organizationSettingsTable).limit(1);
      if (!org)
        throw new ORPCError("PRECONDITION_FAILED", { message: "Verein nicht eingerichtet." });

      const [file] = await context.db
        .select()
        .from(membershipApplicationFilesTable)
        .where(
          and(
            eq(membershipApplicationFilesTable.applicationId, app.id),
            inArray(membershipApplicationFilesTable.kind, ["generated_pdf", "signed_scan"]),
          ),
        )
        .orderBy(desc(membershipApplicationFilesTable.uploadedAt))
        .limit(1);
      if (!file) {
        throw new ORPCError("PRECONDITION_FAILED", {
          message: "Für diesen Antrag gibt es kein versendbares PDF.",
        });
      }

      let uploadUrl: string | null = null;
      if (app.status === "neu") {
        const token = await issueUploadToken(context.db, { applicationId: app.id });
        uploadUrl = buildUploadUrl(baseUrl(context.tenant), token.rawToken);
      }
      const statusToken = await issueStatusToken(context.db, { applicationId: app.id });
      const pdf = await getObject(file.s3Key);
      const applicantName =
        app.antragstyp === "kind"
          ? `${app.erziehungsberechtigterVorname ?? ""} ${app.erziehungsberechtigterNachname ?? ""}`.trim()
          : `${app.vorname} ${app.nachname}`.trim();
      const clubEmail = org.antragVorstandEmail ?? org.mitgliedschaftEmail ?? org.kontaktEmail;
      const res = await sendApplicationMails(context.db, {
        vereinsname: org.vereinsname,
        applicantEmail: app.email,
        applicantName,
        clubEmail,
        notifyClub: org.antragBenachrichtigungAktiv,
        antragsnummer: app.antragsnummer,
        statusUrl: statusUrlFor(context.tenant, app.antragsnummer, statusToken.rawToken),
        uploadUrl,
        pdf: {
          filename: file.filename ?? `Beitrittserklaerung-${app.antragsnummer}.pdf`,
          content: pdf,
          contentType: file.mimeType ?? "application/pdf",
        },
      });
      if (res.applicantSent || res.clubSent) {
        await context.db
          .update(membershipApplicationsTable)
          .set({ emailSent: true, updatedAt: new Date() })
          .where(eq(membershipApplicationsTable.id, app.id));
      }
      await recordEmail(
        res.records.map((r) => ({
          ...r,
          entityType: "membership_application",
          entityId: app.id,
          actorEmail: context.session!.user.email,
          requestId: context.requestId ?? null,
        })),
        context.db,
      );
      return { applicantSent: res.applicantSent, clubSent: res.clubSent };
    }),

  /** Vorstand: upload or replace the signed application document. */
  adminUploadSigned: vorstandProc
    .input(
      v.object({
        id: v.pipe(v.string(), v.uuid()),
        filename: v.pipe(v.string(), v.minLength(1)),
        mimeType: v.pipe(v.string(), v.minLength(1)),
        contentBase64: v.pipe(
          v.string(),
          v.minLength(1),
          v.maxLength(maxBase64Length(MAX_ADMIN_UPLOAD_BYTES)),
        ),
      }),
    )
    .handler(async ({ context, input }) => {
      const [app] = await context.db
        .select({ id: membershipApplicationsTable.id, status: membershipApplicationsTable.status })
        .from(membershipApplicationsTable)
        .where(eq(membershipApplicationsTable.id, input.id))
        .limit(1);
      if (!app) throw new ORPCError("NOT_FOUND", { message: "Antrag nicht gefunden." });
      if (app.status === "genehmigt" || app.status === "abgelehnt") {
        throw new ORPCError("CONFLICT", {
          message:
            "Bei abgeschlossenen Anträgen kann das unterschriebene Dokument nicht ersetzt werden.",
        });
      }
      const allowed = ["application/pdf", "image/jpeg", "image/png", "image/heic", "image/heif"];
      if (!allowed.includes(input.mimeType)) {
        throw new ORPCError("VALIDATION_FAILED", { message: "Nicht erlaubtes Dateiformat." });
      }
      const body = decodeBase64Upload(
        input.contentBase64,
        MAX_ADMIN_UPLOAD_BYTES,
        "Datei zu groß (max. 20 MB).",
      );
      const ext = extensionForMimeType(input.mimeType) ?? "bin";
      const s3Key = `applications/${input.id}/admin-signed-${Date.now()}.${ext}`;
      await putObject({ key: s3Key, body, contentType: input.mimeType });
      await context.db.insert(membershipApplicationFilesTable).values({
        applicationId: input.id,
        kind: "signed_scan",
        s3Key,
        filename: input.filename,
        mimeType: input.mimeType,
        sizeBytes: body.byteLength,
      });
      await context.db
        .update(membershipApplicationsTable)
        .set({
          status:
            app.status === "neu" || app.status === "scan_eingegangen"
              ? "dokument_hochgeladen"
              : app.status,
          updatedAt: new Date(),
        })
        .where(eq(membershipApplicationsTable.id, input.id));
      const nextStatus =
        app.status === "neu" || app.status === "scan_eingegangen"
          ? "dokument_hochgeladen"
          : app.status;
      await appendAudit(context.db, {
        entityType: "membership_application",
        entityId: input.id,
        action: "update",
        source: "ui",
        actorId: context.session!.user.id,
        actorEmail: context.session!.user.email,
        changes: {
          signedScan: { before: null, after: input.filename },
          status: { before: app.status, after: nextStatus },
        },
        requestId: context.requestId ?? null,
      });
      return { ok: true };
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

  /**
   * Archive or unarchive an application. Archiving keeps the row for the record
   * but hides it from the default list; it is fully reversible. Independent of
   * the workflow status, so a genehmigt/abgelehnt Antrag can be tidied away.
   */
  setArchived: vorstandProc
    .input(v.object({ id: v.pipe(v.string(), v.uuid()), archived: v.boolean() }))
    .handler(async ({ context, input }) => {
      const t = membershipApplicationsTable;
      const [app] = await context.db
        .select({ id: t.id, archivedAt: t.archivedAt })
        .from(t)
        .where(eq(t.id, input.id))
        .limit(1);
      if (!app) throw new ORPCError("NOT_FOUND", { message: "Antrag nicht gefunden." });
      const next = input.archived ? new Date() : null;
      await context.db
        .update(t)
        .set({ archivedAt: next, updatedAt: new Date() })
        .where(eq(t.id, input.id));
      await appendAudit(context.db, {
        entityType: "membership_application",
        entityId: input.id,
        action: "update",
        source: "ui",
        actorId: context.session!.user.id,
        actorEmail: context.session!.user.email,
        changes: {
          archived: { before: app.archivedAt != null, after: input.archived },
        },
        requestId: context.requestId ?? null,
      });
      return { ok: true };
    }),

  /**
   * Permanently delete an application and its stored documents. Use for test or
   * spam submissions, not routine cleanup (prefer archive). The database cascade
   * removes the file and token rows; the S3 objects are deleted best-effort
   * first so an orphaned key does not block the row delete. The email and audit
   * log entries remain as a historical trail.
   */
  remove: vorstandProc
    .input(v.object({ id: v.pipe(v.string(), v.uuid()) }))
    .handler(async ({ context, input }) => {
      const t = membershipApplicationsTable;
      const [app] = await context.db
        .select({ id: t.id, antragsnummer: t.antragsnummer, status: t.status })
        .from(t)
        .where(eq(t.id, input.id))
        .limit(1);
      if (!app) throw new ORPCError("NOT_FOUND", { message: "Antrag nicht gefunden." });

      const files = await context.db
        .select({ s3Key: membershipApplicationFilesTable.s3Key })
        .from(membershipApplicationFilesTable)
        .where(eq(membershipApplicationFilesTable.applicationId, input.id));
      for (const f of files) {
        try {
          await deleteObject(f.s3Key);
        } catch (err) {
          // A missing or already-deleted object must not block the row delete.
          logger.warn("antrag delete: S3 object cleanup failed", {
            err: err instanceof Error ? err.message : String(err),
            s3Key: f.s3Key,
            applicationId: input.id,
          });
        }
      }

      // Record the deletion before the row vanishes so the audit trail keeps it.
      await appendAudit(context.db, {
        entityType: "membership_application",
        entityId: input.id,
        action: "delete",
        source: "ui",
        actorId: context.session!.user.id,
        actorEmail: context.session!.user.email,
        changes: {
          antragsnummer: { before: app.antragsnummer, after: null },
          status: { before: app.status, after: null },
        },
        requestId: context.requestId ?? null,
      });
      await context.db.delete(t).where(eq(t.id, input.id));
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

      const [org] = await context.db.select().from(organizationSettingsTable).limit(1);
      const subject = `${org?.vereinsname ?? "Verein"}: Ihr Aufnahmeantrag (${app.antragsnummer})`;
      const declineBody = [
        `Hallo ${app.vorname} ${app.nachname},`,
        "",
        "Ihr Aufnahmeantrag konnte leider nicht angenommen werden.",
        "",
        `Begründung: ${input.reason}`,
      ].join("\n");
      const base = {
        kind: EMAIL_KIND.antragDecline,
        subject,
        bodyText: declineBody,
        entityType: "membership_application",
        entityId: app.id,
        actorEmail: context.session!.user.email,
        requestId: context.requestId ?? null,
      } satisfies Partial<EmailLogEntry>;
      let record: EmailLogEntry;
      if (app.email) {
        const mailer = await getMailer(context.db);
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
              text: declineBody,
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
        /** Dedup gate: link to this existing member instead of creating a new one. */
        linkToMemberId: v.optional(v.nullable(v.pipe(v.string(), v.uuid())), null),
      }),
    )
    .handler(async ({ context, input }) => {
      const t = membershipApplicationsTable;
      const [app] = await context.db.select().from(t).where(eq(t.id, input.id)).limit(1);
      if (!app) throw new ORPCError("NOT_FOUND", { message: "Antrag nicht gefunden." });
      if (app.status === "genehmigt" || app.memberId) {
        throw new ORPCError("CONFLICT", { message: "Antrag ist bereits genehmigt." });
      }
      const [signedFile] = await context.db
        .select({ id: membershipApplicationFilesTable.id })
        .from(membershipApplicationFilesTable)
        .where(
          and(
            eq(membershipApplicationFilesTable.applicationId, app.id),
            eq(membershipApplicationFilesTable.kind, "signed_scan"),
          ),
        )
        .limit(1);
      if (!signedFile) {
        throw new ORPCError("PRECONDITION_FAILED", {
          message:
            "Der Antrag kann erst genehmigt werden, wenn das unterschriebene Dokument vorliegt.",
        });
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
      // Abweichender Kontoinhaber: zahlt der Antragsteller von einem fremden
      // Konto (Kontoinhaber != Antragsteller), wird der echte Kontoinhaber als
      // SEPA-Lastschrift-Name gefuehrt. Nur fuer Selbstzahler (Einzel/Familie);
      // bei Minderjaehrigen ist der Zahler ohnehin der Vertreter (Kontakt).
      const selfPayerAbwKontoInh = isMinor
        ? null
        : divergentKontoinhaber(app.kontoinhaber, app.vorname, app.nachname);

      // Bei Minderjährigen liegt die Bankverbindung beim Erziehungsberechtigten
      // (Zahler), nicht beim Kind. Sonst (Einzel/Familie) zahlt der
      // Antragsteller selbst.
      if (ibanPlain && !isMinor) {
        primaryPatch.iban1 = ibanPlain;
        primaryPatch.iban1Last4 = app.ibanLast4 ?? lastFour(ibanPlain);
        primaryPatch.bic1 = app.bic;
        if (selfPayerAbwKontoInh) primaryPatch.abwKontoInh = selfPayerAbwKontoInh;
      }

      const contract = await resolveApprovalContract(context.db, {
        art: input.art,
        betrag: input.betrag,
        quotedArt: app.vorgeschlageneArt,
        quotedBetrag: app.jahresbeitrag,
        abwKontoInh: selfPayerAbwKontoInh,
        // Direct debit whenever a bank account was given. True for a minor's
        // contract too: the debit runs against the guardian's mandate
        // (resolved via the Vertreter link in the fee run).
        isDirectDebit: ibanPlain != null,
      });
      const sepa = ibanPlain
        ? {
            mandatsNr: app.mandatsreferenz,
            unterschriftDatum: app.consentAt,
            gueltigAb: new Date(),
          }
        : null;

      const result = input.linkToMemberId
        ? await approveByLinking(context.db, {
            app,
            memberId: input.linkToMemberId,
            contract,
            actorId,
            actorEmail,
            requestId: context.requestId ?? null,
          })
        : await withUniqueRetry(() =>
            context.db.transaction(async (tx) => {
              // Lock the application row and re-check inside the transaction. The
              // status check above runs outside any lock, so two concurrent approve
              // calls could both pass it and each create a full set of members. The
              // FOR UPDATE lock serializes them; the second sees genehmigt/memberId
              // and aborts (rolling back its just-created members).
              const [locked] = await tx
                .select({ status: t.status, memberId: t.memberId })
                .from(t)
                .where(eq(t.id, app.id))
                .limit(1)
                .for("update");
              if (!locked || locked.status === "genehmigt" || locked.memberId) {
                throw new ORPCError("CONFLICT", { message: "Antrag ist bereits genehmigt." });
              }
              const primary = await onboardMember(tx, {
                patch: primaryPatch,
                isKontakt: false,
                status: "aktiv",
                abteilungen: (app.abteilungen ?? []).map((id) => ({ abteilungId: id })),
                fallbackEintritt,
                contract,
                // Das Mandat eines Kindes liegt beim Vertreter (unten), nicht beim Kind.
                sepa: isMinor ? null : sepa,
                actorId,
                actorEmail,
                requestId: context.requestId ?? null,
              });
              const refs = [
                primary.ref,
                ...(await createApplicationSecondaries(tx, {
                  app,
                  primary: { id: primary.id, adrNr: primary.adrNr },
                  ibanPlain,
                  fallbackEintritt,
                  actorId,
                  actorEmail,
                  requestId: context.requestId ?? null,
                })),
              ];

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

      await invalidateMemberCaches(context.tenant.key);

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

      // Copy the signed scan and the generated Beitrittserklärung onto the member,
      // so the documents are findable on the member (new or linked), not only on
      // the application. Best-effort, never undoes the approval.
      await attachApplicationFilesToMember(context.db, app.id, result.primaryId, actorId);

      if (app.email) {
        const approvalSubject = `${org?.vereinsname ?? "Verein"}: Willkommen`;
        const approvalBody = [
          `Hallo ${app.vorname} ${app.nachname},`,
          "",
          `Ihr Aufnahmeantrag wurde angenommen. Ihre Mitgliedsnummer: ${result.refs.join(", ")}.`,
          "",
          ...(approvedPdf ? ["Die genehmigte Beitrittserklärung finden Sie im Anhang.", ""] : []),
          "Herzlich willkommen.",
        ].join("\n");
        const sent = await sendApplicationDocumentMail(context.db, {
          to: app.email,
          subject: approvalSubject,
          text: approvalBody,
          subline: "Mitgliedschaft",
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
            subject: approvalSubject,
            bodyText: approvalBody,
            attachmentNames: approvedPdf
              ? [`Beitrittserklaerung-${app.antragsnummer}-genehmigt.pdf`]
              : null,
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
      .where(and(eq(t.isTest, false), isNull(t.archivedAt)))
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
        .where(and(eq(t.isTest, false), isNull(t.archivedAt), eq(t.status, "genehmigt")))
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
