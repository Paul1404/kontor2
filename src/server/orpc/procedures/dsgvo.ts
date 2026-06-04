import { ORPCError } from "@orpc/server";
import { and, count, desc, eq } from "drizzle-orm";
import * as v from "valibot";
import { appendAudit } from "~/server/audit/log";
import { allocateDocRef } from "~/server/db/doc-ref";
import {
  consentTypeEnum,
  dsgvoConsentLogTable,
  dsgvoRequestStatusEnum,
  dsgvoRequestsTable,
  dsgvoRequestTypeEnum,
} from "~/server/db/schema/dsgvo";
import { membersTable } from "~/server/db/schema/members";
import { buildAuskunftsPackage } from "~/server/dsgvo/auskunft";
import { executeErasure, lastErasureAudit, previewErasure } from "~/server/dsgvo/erasure";
import { adminProc, vorstandProc } from "~/server/orpc/base";
import { renderPdfBase64 } from "~/server/pdf/renderer";
import { AuskunftDocument } from "~/server/pdf/templates/auskunft";

const RequestType = v.picklist(dsgvoRequestTypeEnum.enumValues);
const RequestStatus = v.picklist(dsgvoRequestStatusEnum.enumValues);
const ConsentType = v.picklist(consentTypeEnum.enumValues);

const RESPONSE_DEADLINE_DAYS = 30;

function makeDeadline(): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + RESPONSE_DEADLINE_DAYS);
  return d;
}

export const dsgvoRouter = {
  listRequests: vorstandProc
    .input(
      v.object({
        page: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1)), 1),
        pageSize: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(200)), 50),
        status: v.optional(v.nullable(RequestStatus), null),
        type: v.optional(v.nullable(RequestType), null),
      }),
    )
    .handler(async ({ context, input }) => {
      const conditions: ReturnType<typeof eq>[] = [];
      if (input.status) conditions.push(eq(dsgvoRequestsTable.status, input.status) as never);
      if (input.type) conditions.push(eq(dsgvoRequestsTable.type, input.type) as never);
      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const offset = (input.page - 1) * input.pageSize;
      const [rows, totals] = await Promise.all([
        context.db
          .select({
            id: dsgvoRequestsTable.id,
            memberId: dsgvoRequestsTable.memberId,
            type: dsgvoRequestsTable.type,
            status: dsgvoRequestsTable.status,
            requestedAt: dsgvoRequestsTable.requestedAt,
            requestedByEmail: dsgvoRequestsTable.requestedByEmail,
            deadline: dsgvoRequestsTable.deadline,
            completedAt: dsgvoRequestsTable.completedAt,
            notes: dsgvoRequestsTable.notes,
            deliverableSha256: dsgvoRequestsTable.deliverableSha256,
            memberVorname: membersTable.vorname,
            memberNachname: membersTable.nachname,
            memberMitglnr: membersTable.mitglnr,
            // Legacy Kontakte have no mitglnr; the member link falls back to
            // the numeric adrNr, which the detail route resolves.
            memberAdrNr: membersTable.adrNr,
          })
          .from(dsgvoRequestsTable)
          .leftJoin(membersTable, eq(membersTable.id, dsgvoRequestsTable.memberId))
          .where(where)
          .orderBy(desc(dsgvoRequestsTable.requestedAt))
          .limit(input.pageSize)
          .offset(offset),
        context.db.select({ c: count() }).from(dsgvoRequestsTable).where(where),
      ]);

      return { rows, total: totals[0]?.c ?? 0 };
    }),

  getRequest: vorstandProc
    .input(v.object({ id: v.pipe(v.string(), v.uuid()) }))
    .handler(async ({ context, input }) => {
      const [row] = await context.db
        .select({
          id: dsgvoRequestsTable.id,
          memberId: dsgvoRequestsTable.memberId,
          type: dsgvoRequestsTable.type,
          status: dsgvoRequestsTable.status,
          requestedAt: dsgvoRequestsTable.requestedAt,
          requestedByEmail: dsgvoRequestsTable.requestedByEmail,
          deadline: dsgvoRequestsTable.deadline,
          completedAt: dsgvoRequestsTable.completedAt,
          notes: dsgvoRequestsTable.notes,
          docRef: dsgvoRequestsTable.docRef,
          deliverableSha256: dsgvoRequestsTable.deliverableSha256,
          deliverableSizeBytes: dsgvoRequestsTable.deliverableSizeBytes,
          memberVorname: membersTable.vorname,
          memberNachname: membersTable.nachname,
          memberMitglnr: membersTable.mitglnr,
          memberAdrNr: membersTable.adrNr,
        })
        .from(dsgvoRequestsTable)
        .leftJoin(membersTable, eq(membersTable.id, dsgvoRequestsTable.memberId))
        .where(eq(dsgvoRequestsTable.id, input.id))
        .limit(1);
      if (!row) throw new ORPCError("NOT_FOUND", { message: "Anfrage nicht gefunden." });
      return row;
    }),

  /**
   * One-shot: create request, build dossier, render PDF, mark completed,
   * return the JSON + base64 PDF for immediate download. Caller stores both.
   */
  createAuskunftRequest: vorstandProc
    .input(
      v.object({
        memberId: v.pipe(v.string(), v.uuid()),
        notes: v.optional(v.string(), ""),
      }),
    )
    .handler(async ({ context, input }) => {
      const [member] = await context.db
        .select({
          id: membersTable.id,
          mitglnr: membersTable.mitglnr,
          nachname: membersTable.nachname,
        })
        .from(membersTable)
        .where(eq(membersTable.id, input.memberId))
        .limit(1);
      if (!member) throw new ORPCError("NOT_FOUND", { message: "Mitglied nicht gefunden." });

      const { pkg, sha256, byteSize } = await buildAuskunftsPackage(context.db, input.memberId);
      const now = new Date();
      const docRef = await allocateDocRef(context.db, "DS", now.getUTCFullYear());
      const pdf = await renderPdfBase64(AuskunftDocument({ pkg, docRef }));

      const actor = context.session?.user;
      // Request record + audit entry are written atomically so an export is
      // never logged as delivered without its audit row (or vice versa).
      const created = await context.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(dsgvoRequestsTable)
          .values({
            memberId: input.memberId,
            type: "auskunft",
            status: "completed",
            requestedAt: now,
            requestedBy: actor?.id ?? null,
            requestedByEmail: actor?.email ?? null,
            deadline: makeDeadline(),
            completedAt: now,
            completedBy: actor?.id ?? null,
            notes: input.notes || null,
            docRef,
            deliverableSha256: sha256,
            deliverableSizeBytes: byteSize,
          })
          .returning({ id: dsgvoRequestsTable.id });

        await appendAudit(tx, {
          entityType: "member",
          entityId: input.memberId,
          action: "dsgvo_export",
          source: "dsgvo",
          actorId: actor?.id ?? null,
          actorEmail: actor?.email ?? null,
          changes: {
            sha256: { before: null, after: sha256 },
            requestId: { before: null, after: row?.id ?? null },
          },
          requestId: context.requestId,
        });
        return row;
      });

      const slug = (member.mitglnr ?? member.id.slice(0, 8)).replace(/[^a-z0-9]/gi, "");
      return {
        requestId: created?.id,
        docRef,
        json: {
          filename: `dsgvo-auskunft-${docRef}-${slug}.json`,
          content: JSON.stringify(pkg, null, 2),
        },
        pdf: {
          filename: `dsgvo-auskunft-${docRef}-${slug}.pdf`,
          base64: pdf.base64,
        },
        sha256,
      };
    }),

  previewErasure: adminProc
    .input(v.object({ memberId: v.pipe(v.string(), v.uuid()) }))
    .handler(async ({ context, input }) => {
      return previewErasure(context.db, input.memberId);
    }),

  createErasureRequest: adminProc
    .input(
      v.object({
        memberId: v.pipe(v.string(), v.uuid()),
        notes: v.optional(v.string(), ""),
      }),
    )
    .handler(async ({ context, input }) => {
      const actor = context.session?.user;
      const [created] = await context.db
        .insert(dsgvoRequestsTable)
        .values({
          memberId: input.memberId,
          type: "loeschung",
          status: "open",
          requestedBy: actor?.id ?? null,
          requestedByEmail: actor?.email ?? null,
          deadline: makeDeadline(),
          notes: input.notes || null,
        })
        .returning({ id: dsgvoRequestsTable.id });
      return { id: created?.id };
    }),

  executeErasure: adminProc
    .input(
      v.object({
        memberId: v.pipe(v.string(), v.uuid()),
        requestId: v.optional(v.nullable(v.pipe(v.string(), v.uuid())), null),
        forceOverride: v.optional(v.boolean(), false),
        overrideReason: v.optional(v.string(), ""),
      }),
    )
    .handler(async ({ context, input }) => {
      const actor = context.session?.user;
      // Guard failures (retention not expired, missing override reason,
      // member not found) are raised as typed ORPCErrors inside
      // executeErasure and propagate with the right code. Unexpected errors
      // bubble to the observability layer and surface as a generic 500
      // instead of being mislabelled as a validation error.
      return await executeErasure(context.db, input.memberId, {
        forceOverride: input.forceOverride,
        overrideReason: input.overrideReason,
        requestId: input.requestId,
        actorId: actor?.id ?? null,
        actorEmail: actor?.email ?? null,
      });
    }),

  lastErasure: vorstandProc
    .input(v.object({ memberId: v.pipe(v.string(), v.uuid()) }))
    .handler(async ({ context, input }) => {
      return lastErasureAudit(context.db, input.memberId);
    }),

  recordConsent: vorstandProc
    .input(
      v.object({
        memberId: v.pipe(v.string(), v.uuid()),
        consentType: ConsentType,
        granted: v.boolean(),
        evidence: v.optional(v.string(), ""),
      }),
    )
    .handler(async ({ context, input }) => {
      const actor = context.session?.user;
      // Consent record + its audit entry must land together — a consent log
      // without an audit trail is a compliance gap.
      await context.db.transaction(async (tx) => {
        await tx.insert(dsgvoConsentLogTable).values({
          memberId: input.memberId,
          consentType: input.consentType,
          granted: input.granted,
          recordedBy: actor?.id ?? null,
          recordedByEmail: actor?.email ?? null,
          evidence: input.evidence || null,
        });
        await appendAudit(tx, {
          entityType: "member",
          entityId: input.memberId,
          action: "dsgvo_consent_change",
          source: "dsgvo",
          actorId: actor?.id ?? null,
          actorEmail: actor?.email ?? null,
          changes: {
            [input.consentType]: { before: null, after: input.granted },
          },
          requestId: context.requestId,
        });
      });
      return { ok: true };
    }),

  getConsentState: vorstandProc
    .input(v.object({ memberId: v.pipe(v.string(), v.uuid()) }))
    .handler(async ({ context, input }) => {
      const rows = await context.db
        .select()
        .from(dsgvoConsentLogTable)
        .where(eq(dsgvoConsentLogTable.memberId, input.memberId))
        .orderBy(desc(dsgvoConsentLogTable.recordedAt));

      const latest = new Map<string, (typeof rows)[number]>();
      for (const r of rows) {
        if (!latest.has(r.consentType)) latest.set(r.consentType, r);
      }
      return {
        history: rows,
        current: Array.from(latest.values()),
      };
    }),
};
