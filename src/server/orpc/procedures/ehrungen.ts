import { ORPCError } from "@orpc/server";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import * as v from "valibot";
import { appendAudit } from "~/server/audit/log";
import { allocateDocRef } from "~/server/db/doc-ref";
import { ehrungenTable } from "~/server/db/schema/ehrungen";
import { membersTable } from "~/server/db/schema/members";
import { organizationSettingsTable } from "~/server/db/schema/organization-settings";
import { memberDisplayName } from "~/server/domain/member";
import { resolveEhrungJahr, resolveEhrungTitel } from "~/server/ehrungen/ehrung";
import { authedProc, vorstandProc } from "~/server/orpc/base";
import { buildEhrungsurkundeModel } from "~/server/pdf/ehrungsurkunde-model";
import { resolveClubLogo } from "~/server/pdf/logo";
import { renderPdfBase64 } from "~/server/pdf/renderer";
import { EhrungsurkundeDocument } from "~/server/pdf/templates/ehrungsurkunde";
import { presignDownload, putObject } from "~/server/s3/client";

const ISO_DATE = v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/, "Datum muss YYYY-MM-DD sein."));
const KindInput = v.picklist(["vereinsjubilaeum", "sonderehrung"]);
const JahreInput = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(150));
const YearInput = v.pipe(v.number(), v.integer(), v.minValue(1900), v.maxValue(2200));

function safeFilenamePart(s: string): string {
  return s
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

const MEMBER_NAME_COLUMNS = {
  id: membersTable.id,
  memberNo: membersTable.memberNo,
  kontaktNo: membersTable.kontaktNo,
  mitgliedsnummer: membersTable.mitgliedsnummer,
  adrNr: membersTable.adrNr,
  vorname: membersTable.vorname,
  nachname: membersTable.nachname,
  kurzname: membersTable.kurzname,
  firma1: membersTable.firma1,
} as const;

export const ehrungenRouter = {
  /** Recorded honors for one member, newest award first. */
  forMember: authedProc
    .input(v.object({ memberId: v.string() }))
    .handler(async ({ context, input }) => {
      const rows = await context.db
        .select()
        .from(ehrungenTable)
        .where(and(eq(ehrungenTable.memberId, input.memberId), isNull(ehrungenTable.deletedAt)))
        .orderBy(desc(ehrungenTable.verliehenAm), desc(ehrungenTable.createdAt))
        .limit(100);
      return rows.map((r) => ({ ...r, hasUrkunde: !!r.urkundeS3Key }));
    }),

  /**
   * Already-awarded Vereinsjubiläen for the report's selected year and
   * milestones. The report cross-references these so each due member shows as
   * open or honored, with the recorded honor's id for the Urkunde action.
   */
  statusForYear: authedProc
    .input(v.object({ year: YearInput, jubilaeen: v.optional(v.array(JahreInput)) }))
    .handler(async ({ context, input }) => {
      const conditions = [
        eq(ehrungenTable.kind, "vereinsjubilaeum"),
        eq(ehrungenTable.jahr, input.year),
        isNull(ehrungenTable.deletedAt),
      ];
      if (input.jubilaeen?.length) {
        conditions.push(inArray(ehrungenTable.jubilaeumJahre, input.jubilaeen));
      }
      const rows = await context.db
        .select({
          ehrungId: ehrungenTable.id,
          memberId: ehrungenTable.memberId,
          jubilaeumJahre: ehrungenTable.jubilaeumJahre,
          verliehenAm: ehrungenTable.verliehenAm,
          urkundeS3Key: ehrungenTable.urkundeS3Key,
        })
        .from(ehrungenTable)
        .where(and(...conditions));
      return {
        honored: rows.map((r) => ({
          ehrungId: r.ehrungId,
          memberId: r.memberId,
          jubilaeumJahre: r.jubilaeumJahre,
          verliehenAm: r.verliehenAm,
          hasUrkunde: !!r.urkundeS3Key,
        })),
      };
    }),

  /** Record an awarded honor. Vorstand only. */
  record: vorstandProc
    .input(
      v.object({
        memberId: v.string(),
        kind: KindInput,
        jubilaeumJahre: v.optional(v.nullable(JahreInput), null),
        titel: v.optional(v.pipe(v.string(), v.maxLength(120)), ""),
        verliehenAm: ISO_DATE,
        jahr: v.optional(v.nullable(YearInput), null),
        notiz: v.optional(v.nullable(v.pipe(v.string(), v.maxLength(1000))), null),
      }),
    )
    .handler(async ({ context, input }) => {
      const [member] = await context.db
        .select({ id: membersTable.id })
        .from(membersTable)
        .where(eq(membersTable.id, input.memberId))
        .limit(1);
      if (!member) throw new ORPCError("NOT_FOUND", { message: "Mitglied nicht gefunden." });

      const jubilaeumJahre = input.kind === "vereinsjubilaeum" ? input.jubilaeumJahre : null;
      if (input.kind === "vereinsjubilaeum" && jubilaeumJahre == null) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Für ein Vereinsjubiläum sind die Jahre erforderlich.",
        });
      }

      const titel = resolveEhrungTitel(input.kind, input.titel, jubilaeumJahre);
      if (!titel) {
        throw new ORPCError("BAD_REQUEST", { message: "Titel der Ehrung erforderlich." });
      }

      // Block honoring the same anniversary twice (also guarded by a partial
      // unique index; this gives a friendlier message before the round trip).
      if (jubilaeumJahre != null) {
        const [existing] = await context.db
          .select({ id: ehrungenTable.id })
          .from(ehrungenTable)
          .where(
            and(
              eq(ehrungenTable.memberId, input.memberId),
              eq(ehrungenTable.jubilaeumJahre, jubilaeumJahre),
              isNull(ehrungenTable.deletedAt),
            ),
          )
          .limit(1);
        if (existing) {
          throw new ORPCError("CONFLICT", {
            message: `Das ${jubilaeumJahre}-jährige Jubiläum ist für dieses Mitglied bereits erfasst.`,
          });
        }
      }

      const jahr = resolveEhrungJahr(input.jahr, input.verliehenAm);

      const [row] = await context.db
        .insert(ehrungenTable)
        .values({
          memberId: input.memberId,
          kind: input.kind,
          jubilaeumJahre,
          titel,
          verliehenAm: input.verliehenAm,
          jahr,
          notiz: input.notiz ?? null,
          createdBy: context.session!.user.id,
          createdByEmail: context.session!.user.email,
        })
        .returning();

      await appendAudit(context.db, {
        entityType: "ehrung",
        entityId: row!.id,
        action: "create",
        source: "ui",
        actorId: context.session!.user.id,
        actorEmail: context.session!.user.email,
        changes: {
          memberId: { before: null, after: input.memberId },
          titel: { before: null, after: titel },
          verliehenAm: { before: null, after: input.verliehenAm },
        },
        requestId: context.requestId ?? null,
      });

      return row;
    }),

  /** Soft-delete a recorded honor. Vorstand only. */
  remove: vorstandProc.input(v.object({ id: v.string() })).handler(async ({ context, input }) => {
    const [row] = await context.db
      .update(ehrungenTable)
      .set({ deletedAt: new Date() })
      .where(and(eq(ehrungenTable.id, input.id), isNull(ehrungenTable.deletedAt)))
      .returning({ id: ehrungenTable.id, memberId: ehrungenTable.memberId });
    if (!row) throw new ORPCError("NOT_FOUND", { message: "Ehrung nicht gefunden." });
    await appendAudit(context.db, {
      entityType: "ehrung",
      entityId: row.id,
      action: "delete",
      source: "ui",
      actorId: context.session!.user.id,
      actorEmail: context.session!.user.email,
      changes: { deletedAt: { before: null, after: new Date().toISOString() } },
      requestId: context.requestId ?? null,
    });
    return { ok: true };
  }),

  /**
   * Render the Ehrungsurkunde for a recorded honor, store it in S3 and return it
   * inline (base64) for immediate download. Reuses the document reference if the
   * certificate was generated before, so re-printing keeps the same number.
   */
  urkunde: vorstandProc.input(v.object({ id: v.string() })).handler(async ({ context, input }) => {
    const [ehrung] = await context.db
      .select()
      .from(ehrungenTable)
      .where(and(eq(ehrungenTable.id, input.id), isNull(ehrungenTable.deletedAt)))
      .limit(1);
    if (!ehrung) throw new ORPCError("NOT_FOUND", { message: "Ehrung nicht gefunden." });

    const [member] = await context.db
      .select(MEMBER_NAME_COLUMNS)
      .from(membersTable)
      .where(eq(membersTable.id, ehrung.memberId))
      .limit(1);
    if (!member) throw new ORPCError("NOT_FOUND", { message: "Mitglied nicht gefunden." });

    const [org] = await context.db.select().from(organizationSettingsTable).limit(1);
    if (!org) {
      throw new ORPCError("PRECONDITION_FAILED", {
        message: "Vereinsdaten fehlen. Bitte unter Einstellungen > Vereinsdaten pflegen.",
      });
    }

    const empfaengerName = memberDisplayName(member);
    const docRef = ehrung.urkundeDocRef ?? (await allocateDocRef(context.db, "EU", ehrung.jahr));

    const model = buildEhrungsurkundeModel({
      vereinsname: org.vereinsname,
      ort: org.anschriftOrt,
      logoDataUri: resolveClubLogo(org.logo),
      empfaengerName,
      mitgliedsnummer: member.mitgliedsnummer,
      kind: ehrung.kind,
      jubilaeumJahre: ehrung.jubilaeumJahre,
      titel: ehrung.titel,
      verliehenAm: ehrung.verliehenAm,
      docRef,
      brandColor: org.primaryColor,
    });

    const { base64 } = await renderPdfBase64(EhrungsurkundeDocument({ model }));
    const pdf = Buffer.from(base64, "base64");
    const filename = `Ehrenurkunde-${safeFilenamePart(docRef)}-${safeFilenamePart(empfaengerName)}.pdf`;
    const s3Key = ehrung.urkundeS3Key ?? `ehrungen/${ehrung.id}/${filename}`;

    await putObject({ key: s3Key, body: pdf, contentType: "application/pdf" });

    await context.db
      .update(ehrungenTable)
      .set({
        urkundeDocRef: docRef,
        urkundeS3Key: s3Key,
        urkundeFilename: filename,
        urkundeErstelltAm: new Date(),
      })
      .where(eq(ehrungenTable.id, ehrung.id));

    return { filename, base64, docRef };
  }),

  /** Presigned download URL for a previously generated Ehrungsurkunde. */
  downloadUrkunde: authedProc
    .input(v.object({ id: v.string() }))
    .handler(async ({ context, input }) => {
      const [row] = await context.db
        .select({
          s3Key: ehrungenTable.urkundeS3Key,
          filename: ehrungenTable.urkundeFilename,
        })
        .from(ehrungenTable)
        .where(eq(ehrungenTable.id, input.id))
        .limit(1);
      if (!row?.s3Key) {
        throw new ORPCError("NOT_FOUND", { message: "Noch keine Urkunde erzeugt." });
      }
      const url = await presignDownload({ key: row.s3Key, filename: row.filename ?? undefined });
      return { url };
    }),
};
