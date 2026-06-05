import { randomUUID } from "node:crypto";
import { ORPCError } from "@orpc/server";
import { desc, eq, inArray } from "drizzle-orm";
import * as v from "valibot";
import { appendAudit } from "~/server/audit/log";
import { allocateDocRef } from "~/server/db/doc-ref";
import { contractsTable } from "~/server/db/schema/contracts";
import { sollStellungenTable } from "~/server/db/schema/fee-runs";
import { type KulanzRecipientSnapshot, kulanzLettersTable } from "~/server/db/schema/kulanz";
import { organizationSettingsTable } from "~/server/db/schema/organization-settings";
import {
  loadOpenPostings,
  memberDisplayName,
  resolveRecipients,
  sumDecimal,
} from "~/server/dunning/build-dunning";
import { authedProc, vorstandProc } from "~/server/orpc/base";
import {
  buildKulanzClubModel,
  buildKulanzLetterModel,
  type KulanzLetterModel,
} from "~/server/pdf/kulanz-model";
import { clubLogoDataUri } from "~/server/pdf/logo";
import { renderPdfBase64 } from "~/server/pdf/renderer";
import { KulanzSonderkuendigungDocument } from "~/server/pdf/templates/kulanz-sonderkuendigung";
import { deleteObject, presignDownload, putObject } from "~/server/s3/client";

function todayUtc(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function addDays(d: Date, days: number): Date {
  const n = new Date(d.getTime());
  n.setUTCDate(n.getUTCDate() + days);
  return n;
}

function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function safeFilenamePart(s: string): string {
  return s
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

const ISO_DATE = v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/));

export const kulanzRouter = {
  /**
   * List members with open dues who are candidates for a Kulanz letter. Mirrors
   * the dunning selection (open/returned postings, soft-deleted and mahngesperrt
   * members excluded) but ignores Mahnstufe -- this is a one-off goodwill
   * letter, not a dunning escalation. `onlyWithoutEmail` narrows to the case the
   * letter is meant for: members we cannot reach by email.
   */
  preview: vorstandProc
    .input(v.optional(v.object({ onlyWithoutEmail: v.optional(v.boolean(), true) }), {}))
    .handler(async ({ context, input }) => {
      const runDate = todayUtc();
      const all = await loadOpenPostings(context.db, { cutoffDate: runDate });
      const eligible = all.filter((m) => !m.dunningBlocked);
      const recipients = await resolveRecipients(context.db, eligible, runDate);

      let items = eligible.map((m) => {
        const resolved = recipients.get(m.memberId);
        return {
          memberId: m.memberId,
          mitgliedsnummer: m.mitgliedsnummer,
          adrNr: m.adrNr,
          name: memberDisplayName(m),
          openSum: m.openSum,
          postingCount: m.postings.length,
          hasEmail: !!resolved?.recipientEmail,
          hasAddress: !!(resolved?.recipient.strasse && resolved.recipient.plz),
          isMinor: resolved?.isMinor ?? false,
          addressedToGuardian: (resolved?.guardianSource ?? null) !== null,
        };
      });

      if (input.onlyWithoutEmail) {
        items = items.filter((i) => !i.hasEmail);
      }

      return {
        runDate: toDateString(runDate),
        items,
        totals: {
          itemCount: items.length,
          openSum: sumDecimal(items.map((i) => i.openSum)),
          withoutAddress: items.filter((i) => !i.hasAddress).length,
        },
      };
    }),

  /**
   * Render one combined PDF (one letter per recipient) for the selected
   * members, store it in S3 and record a history row, then return the PDF
   * inline (base64) for immediate download. Does NOT touch Mahnstufe or any
   * Sollstellung: the offer to waive the open claim is a paper process, settled
   * manually when the member pays or returns the Kündigungsbestätigung.
   */
  generate: vorstandProc
    .input(
      v.object({
        memberIds: v.pipe(v.array(v.string()), v.minLength(1)),
        runDate: v.optional(v.nullable(ISO_DATE), null),
        deadlineDate: v.optional(v.nullable(ISO_DATE), null),
      }),
    )
    .handler(async ({ context, input }) => {
      const [org] = await context.db.select().from(organizationSettingsTable).limit(1);
      if (!org) {
        throw new ORPCError("PRECONDITION_FAILED", {
          message: "Vereinsdaten fehlen. Bitte unter Einstellungen > Vereinsdaten pflegen.",
        });
      }

      const runDate = input.runDate ? new Date(`${input.runDate}T00:00:00Z`) : todayUtc();
      const deadline = input.deadlineDate
        ? new Date(`${input.deadlineDate}T00:00:00Z`)
        : addDays(runDate, org.mahnFristTage);

      const all = await loadOpenPostings(context.db, {
        cutoffDate: runDate,
        memberIds: input.memberIds,
      });
      const eligible = all.filter((m) => !m.dunningBlocked);
      if (eligible.length === 0) {
        throw new ORPCError("PRECONDITION_FAILED", {
          message: "Keine versendbaren Schreiben (Empfänger gesperrt oder ohne offene Beträge).",
        });
      }

      // Pre-fetch contract descriptions so the table reads "Beitrag 2024
      // (Erwachsene Aktiv)" instead of a bare year.
      const sollIds = eligible.flatMap((m) => m.postings.map((p) => p.sollStellungId));
      const descRows =
        sollIds.length > 0
          ? await context.db
              .select({
                sollId: sollStellungenTable.id,
                artName: contractsTable.artName,
                vertragNr: contractsTable.vertragNr,
              })
              .from(sollStellungenTable)
              .innerJoin(contractsTable, eq(sollStellungenTable.contractId, contractsTable.id))
              .where(inArray(sollStellungenTable.id, sollIds))
          : [];
      const descBySoll = new Map(descRows.map((r) => [r.sollId, r.artName ?? r.vertragNr]));

      // Cancellations are a membership matter: route them to the dedicated
      // mitgliedschaft@ mailbox when set, otherwise fall back to the general
      // contact address so the offer never points at a dead end.
      const mitgliedschaftEmail = org.mitgliedschaftEmail ?? org.kontaktEmail;

      const recipients = await resolveRecipients(context.db, eligible, runDate);
      const club = buildKulanzClubModel({
        vereinsname: org.vereinsname,
        anschriftStrasse: org.anschriftStrasse,
        anschriftPlz: org.anschriftPlz,
        anschriftOrt: org.anschriftOrt,
        kontaktEmail: mitgliedschaftEmail,
        vereinsIban: org.vereinsIban,
        vereinsBic: org.vereinsBic,
        vereinsBankname: org.vereinsBankname,
        glaeubigerId: org.glaeubigerId,
        logoDataUri: clubLogoDataUri(),
      });

      const runDateStr = toDateString(runDate);
      const deadlineStr = toDateString(deadline);

      const letters: KulanzLetterModel[] = [];
      const snapshot: KulanzRecipientSnapshot[] = [];
      for (const m of eligible) {
        const resolved = recipients.get(m.memberId);
        const memberName = memberDisplayName(m);
        const mitgliedsnummer = m.mitgliedsnummer ?? `AdrNr ${m.adrNr}`;
        const recipient = resolved?.recipient ?? {
          anrede: m.anrede,
          name: memberName,
          strasse: m.strasse,
          hausnummer: m.hausnummer,
          plz: m.plz,
          ort: m.ort,
        };
        letters.push(
          buildKulanzLetterModel({
            recipient: {
              anrede: recipient.anrede,
              name: recipient.name,
              strasse: recipient.strasse,
              hausnummer: recipient.hausnummer,
              plz: recipient.plz,
              ort: recipient.ort,
              vertretungFor: resolved?.vertretungFor ?? null,
            },
            member: { mitgliedsnummer, name: memberName },
            postings: m.postings.map((p) => ({
              billingYear: p.billingYear,
              falligkeitsdatum: p.falligkeitsdatum,
              description: descBySoll.get(p.sollStellungId) ?? `Mitgliedsbeitrag ${p.billingYear}`,
              openAmount: p.openAmount,
              rueckgebuhr: p.rueckgebuhr,
            })),
            openSum: m.openSum,
            runDate: runDateStr,
            deadlineDate: deadlineStr,
            vereinsname: org.vereinsname,
            kontaktEmail: mitgliedschaftEmail,
          }),
        );
        snapshot.push({
          memberId: m.memberId,
          name: memberName,
          mitgliedsnummer,
          openSum: m.openSum,
        });
      }

      // Allocate a unique, human-readable reference (KS-2026-0001) so every run
      // is distinguishable from another with the same date and recipient count.
      const docRef = await allocateDocRef(context.db, "KS", Number(runDateStr.slice(0, 4)));

      const { base64 } = await renderPdfBase64(
        KulanzSonderkuendigungDocument({ club, letters, docRef }),
      );
      const pdf = Buffer.from(base64, "base64");

      const id = randomUUID();
      const filename = `Kulanz-${safeFilenamePart(docRef)}-${eligible.length}-Schreiben.pdf`;
      const s3Key = `kulanz/${id}/${filename}`;
      const totalOpen = sumDecimal(eligible.map((m) => m.openSum));

      await putObject({ key: s3Key, body: pdf, contentType: "application/pdf" });

      try {
        await context.db.transaction(async (tx) => {
          await tx.insert(kulanzLettersTable).values({
            id,
            docRef,
            runDate: runDateStr,
            deadlineDate: deadlineStr,
            recipientCount: eligible.length,
            totalOpen,
            recipients: snapshot,
            s3Key,
            filename,
            createdBy: context.session!.user.id,
          });
          await appendAudit(tx, {
            entityType: "kulanz_letter",
            entityId: id,
            action: "create",
            source: "ui",
            actorId: context.session!.user.id,
            actorEmail: context.session!.user.email,
            changes: {
              docRef: { before: null, after: docRef },
              recipientCount: { before: null, after: eligible.length },
              totalOpen: { before: null, after: totalOpen },
              deadlineDate: { before: null, after: deadlineStr },
            },
            requestId: context.requestId ?? null,
          });
        });
      } catch (err) {
        // Drop the orphaned S3 object so a failed insert leaves no litter.
        await deleteObject(s3Key).catch(() => {});
        throw err;
      }

      return { id, docRef, filename, base64, recipientCount: eligible.length };
    }),

  /** List past Kulanz letter runs, newest first. */
  list: authedProc.handler(async ({ context }) => {
    const rows = await context.db
      .select({
        id: kulanzLettersTable.id,
        docRef: kulanzLettersTable.docRef,
        runDate: kulanzLettersTable.runDate,
        deadlineDate: kulanzLettersTable.deadlineDate,
        recipientCount: kulanzLettersTable.recipientCount,
        totalOpen: kulanzLettersTable.totalOpen,
        filename: kulanzLettersTable.filename,
        createdAt: kulanzLettersTable.createdAt,
      })
      .from(kulanzLettersTable)
      .orderBy(desc(kulanzLettersTable.createdAt));
    return rows;
  }),

  /** Presigned download URL for a stored Kulanz letter run. */
  download: authedProc
    .input(v.object({ id: v.pipe(v.string(), v.minLength(1)) }))
    .handler(async ({ context, input }) => {
      const [row] = await context.db
        .select({ s3Key: kulanzLettersTable.s3Key, filename: kulanzLettersTable.filename })
        .from(kulanzLettersTable)
        .where(eq(kulanzLettersTable.id, input.id))
        .limit(1);
      if (!row) throw new ORPCError("NOT_FOUND", { message: "Dokument nicht gefunden." });
      const url = await presignDownload({ key: row.s3Key, filename: row.filename });
      return { url };
    }),
};
