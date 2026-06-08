import { createHash } from "node:crypto";
import { asc, desc, eq } from "drizzle-orm";
import { lastFour } from "~/server/crypto/encrypt";
import type { DB } from "~/server/db/client";
import { abteilungenTable, memberAbteilungenTable } from "~/server/db/schema/abteilungen";
import { attachmentsTable } from "~/server/db/schema/attachments";
import { auditLogTable } from "~/server/db/schema/audit";
import { contractsTable } from "~/server/db/schema/contracts";
import { dsgvoConsentLogTable, dsgvoRequestsTable } from "~/server/db/schema/dsgvo";
import { sollStellungenTable } from "~/server/db/schema/fee-runs";
import { membersTable } from "~/server/db/schema/members";
import { relationshipsTable } from "~/server/db/schema/relationships";
import { sepaMandatesTable } from "~/server/db/schema/sepa";
import { memberRef } from "~/server/domain/member";
import { presignDownload } from "~/server/s3/client";

/**
 * Per DSGVO Art. 15 the data subject has the right to a full machine-readable
 * copy of all personal data we hold. This builds that package as a single
 * JSON object plus a deterministic SHA-256 of its canonical serialization,
 * so the same data always produces the same hash.
 *
 * IBAN columns are decrypted at SELECT time (custom type) but we re-mask
 * them in the export to `last4` only — the right of access does not require
 * us to hand over secrets we encrypt at rest. The mask is documented in
 * the package metadata.
 */
export type AuskunftsPackage = {
  generatedAt: string;
  generatedFor: { memberId: string; ref: string; mitgliedsnummer: string | null };
  notice: string;
  member: Record<string, unknown>;
  abteilungen: Array<Record<string, unknown>>;
  contracts: Array<Record<string, unknown>>;
  sepaMandates: Array<Record<string, unknown>>;
  fees: Array<Record<string, unknown>>;
  attachments: Array<{
    id: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    uploadedAt: string;
    downloadUrl: string;
    downloadUrlExpiresAt: string;
  }>;
  relationships: Array<Record<string, unknown>>;
  consentLog: Array<Record<string, unknown>>;
  auditTrail: Array<Record<string, unknown>>;
  previousRequests: Array<Record<string, unknown>>;
  meta: {
    encryptedFieldsRemoved: string[];
    retentionNotes: string[];
  };
};

const ENCRYPTED_COLUMNS = ["iban1"] as const;

function maskMember(raw: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...raw };
  for (const col of ENCRYPTED_COLUMNS) {
    const v = copy[col];
    if (typeof v === "string" && v.length > 0) {
      copy[col] = `***${lastFour(v)}`;
    }
  }
  return copy;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        sorted[k] = (v as Record<string, unknown>)[k];
      }
      return sorted;
    }
    if (v instanceof Date) return v.toISOString();
    return v;
  });
}

export type BuildAuskunftsPackageOpts = {
  /**
   * How long the embedded S3 download URLs stay valid. Default: 24 h.
   * The member only needs the JSON once; the URLs let them open attachments
   * directly from the dossier without re-authenticating.
   */
  attachmentUrlExpiresSeconds?: number;
};

export async function buildAuskunftsPackage(
  db: DB,
  memberId: string,
  opts: BuildAuskunftsPackageOpts = {},
): Promise<{ pkg: AuskunftsPackage; sha256: string; byteSize: number }> {
  const expiresSeconds = opts.attachmentUrlExpiresSeconds ?? 24 * 60 * 60;

  const [memberRow] = await db
    .select()
    .from(membersTable)
    .where(eq(membersTable.id, memberId))
    .limit(1);

  if (!memberRow) {
    throw new Error(`Mitglied ${memberId} nicht gefunden.`);
  }

  const [
    abts,
    contracts,
    sepa,
    fees,
    attachments,
    relationships,
    consent,
    audit,
    previousRequests,
  ] = await Promise.all([
    db
      .select({
        eintrittsdatum: memberAbteilungenTable.eintrittsdatum,
        austrittsdatum: memberAbteilungenTable.austrittsdatum,
        abteilungId: abteilungenTable.id,
        abteilungName: abteilungenTable.name,
        sportart: abteilungenTable.sportart,
        verbandName: abteilungenTable.verbandName,
      })
      .from(memberAbteilungenTable)
      .innerJoin(abteilungenTable, eq(abteilungenTable.id, memberAbteilungenTable.abteilungId))
      .where(eq(memberAbteilungenTable.memberId, memberId))
      .orderBy(asc(memberAbteilungenTable.eintrittsdatum)),
    db.select().from(contractsTable).where(eq(contractsTable.memberId, memberId)),
    db.select().from(sepaMandatesTable).where(eq(sepaMandatesTable.memberId, memberId)),
    db.select().from(sollStellungenTable).where(eq(sollStellungenTable.memberId, memberId)),
    db.select().from(attachmentsTable).where(eq(attachmentsTable.memberId, memberId)),
    db.select().from(relationshipsTable).where(eq(relationshipsTable.fromMemberId, memberId)),
    db
      .select()
      .from(dsgvoConsentLogTable)
      .where(eq(dsgvoConsentLogTable.memberId, memberId))
      .orderBy(desc(dsgvoConsentLogTable.recordedAt)),
    db
      .select()
      .from(auditLogTable)
      .where(eq(auditLogTable.entityId, memberId))
      .orderBy(desc(auditLogTable.createdAt))
      .limit(500),
    db
      .select()
      .from(dsgvoRequestsTable)
      .where(eq(dsgvoRequestsTable.memberId, memberId))
      .orderBy(desc(dsgvoRequestsTable.requestedAt)),
  ]);

  const downloadUrlExpiresAt = new Date(Date.now() + expiresSeconds * 1000).toISOString();
  const attachmentsWithUrls = await Promise.all(
    attachments.map(async (a) => {
      const url = await presignDownload({
        key: a.s3Key,
        filename: a.filename,
        expiresSeconds,
      });
      return {
        id: a.id,
        filename: a.filename,
        mimeType: a.mimeType,
        sizeBytes: a.sizeBytes,
        uploadedAt: a.uploadedAt.toISOString(),
        downloadUrl: url,
        downloadUrlExpiresAt,
      };
    }),
  );

  const pkg: AuskunftsPackage = {
    generatedAt: new Date().toISOString(),
    generatedFor: {
      memberId: memberRow.id,
      ref: memberRef(memberRow),
      mitgliedsnummer: memberRow.mitgliedsnummer,
    },
    notice:
      "Diese Datei enthält alle zu Ihrer Person gespeicherten Daten gemäß " +
      "Art. 15 DSGVO. IBAN-Felder wurden auf die letzten vier Ziffern maskiert, " +
      "da die Originalwerte AES-256-verschlüsselt gespeichert sind. " +
      "Dokumenten-Downloadlinks sind 24 Stunden gültig.",
    member: maskMember(memberRow as unknown as Record<string, unknown>),
    abteilungen: abts as unknown as Array<Record<string, unknown>>,
    contracts: contracts as unknown as Array<Record<string, unknown>>,
    sepaMandates: sepa as unknown as Array<Record<string, unknown>>,
    fees: fees as unknown as Array<Record<string, unknown>>,
    attachments: attachmentsWithUrls,
    relationships: relationships as unknown as Array<Record<string, unknown>>,
    consentLog: consent as unknown as Array<Record<string, unknown>>,
    auditTrail: audit as unknown as Array<Record<string, unknown>>,
    previousRequests: previousRequests as unknown as Array<Record<string, unknown>>,
    meta: {
      encryptedFieldsRemoved: [...ENCRYPTED_COLUMNS],
      retentionNotes: [
        "Finanzdaten (Beiträge, Mahnungen, SEPA-Mandate) unterliegen den steuerlichen Aufbewahrungspflichten nach §147 AO (10 Jahre).",
        "SEPA-Mandate werden gemäß SEPA-Rulebook 14 Monate nach letzter Verwendung aufbewahrt.",
      ],
    },
  };

  // Strip the downloadUrl from the digest so the same data produces the
  // same hash even when the URL contains a fresh signature.
  const canonical = stableStringify({
    ...pkg,
    attachments: pkg.attachments.map((a) => ({
      id: a.id,
      filename: a.filename,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      uploadedAt: a.uploadedAt,
    })),
    generatedAt: "<excluded>",
    meta: { ...pkg.meta },
  });
  const sha256 = createHash("sha256").update(canonical).digest("hex");
  const byteSize = Buffer.byteLength(JSON.stringify(pkg));

  return { pkg, sha256, byteSize };
}
