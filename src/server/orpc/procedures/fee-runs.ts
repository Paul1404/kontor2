import { ORPCError } from "@orpc/server";
import { and, count, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import * as v from "valibot";
import { appendAudit } from "~/server/audit/log";
import { contractsTable } from "~/server/db/schema/contracts";
import { feeRunItemsTable, feeRunsTable, sollStellungenTable } from "~/server/db/schema/fee-runs";
import { membersTable } from "~/server/db/schema/members";
import { organizationSettingsTable } from "~/server/db/schema/organization-settings";
import { sepaMandatesTable } from "~/server/db/schema/sepa";
import { authedProc, vorstandProc } from "~/server/orpc/base";
import { buildFeeRunPreview } from "~/server/sepa/build-fee-run";
import { buildPain008, type Pain008Item } from "~/server/sepa/pain008";

const PreviewInput = v.object({
  billingYear: v.pipe(v.number(), v.integer(), v.minValue(2000), v.maxValue(2100)),
  falligkeitsdatum: v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/)),
  mandateOverrides: v.optional(v.record(v.string(), v.string()), {}),
});

const CommitInput = v.object({
  billingYear: v.pipe(v.number(), v.integer(), v.minValue(2000), v.maxValue(2100)),
  falligkeitsdatum: v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/)),
  mandateOverrides: v.optional(v.record(v.string(), v.string()), {}),
  expectedTotalAmount: v.pipe(v.string(), v.minLength(1)),
  expectedItemCount: v.pipe(v.number(), v.integer(), v.minValue(0)),
  notes: v.optional(v.nullable(v.string()), null),
});

function parseFalligkeit(s: string): Date {
  // Parse YYYY-MM-DD as UTC midnight to avoid timezone drift.
  const [y, m, d] = s.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
}

function pad(n: number, width: number): string {
  return n.toString().padStart(width, "0");
}

function buildMsgId(year: number, runUuid: string): string {
  // 35-char max for ISO 20022 MsgId. Use prefix + first 16 chars of UUID.
  return `SV-${year}-${runUuid.replace(/-/g, "").slice(0, 16)}`.slice(0, 35);
}

function buildXmlFilename(date: Date): string {
  const y = date.getUTCFullYear();
  const m = pad(date.getUTCMonth() + 1, 2);
  const d = pad(date.getUTCDate(), 2);
  const h = pad(date.getUTCHours(), 2);
  const mi = pad(date.getUTCMinutes(), 2);
  return `SEPAXML${y}${m}${d}${h}${mi}.xml`;
}

export const feeRunsRouter = {
  preview: vorstandProc.input(PreviewInput).handler(async ({ context, input }) => {
    return buildFeeRunPreview(context.db, {
      billingYear: input.billingYear,
      falligkeitsdatum: parseFalligkeit(input.falligkeitsdatum),
      mandateOverrides: input.mandateOverrides,
    });
  }),

  commit: vorstandProc.input(CommitInput).handler(async ({ context, input }) => {
    // Singleton org settings must exist before generating XML.
    const [org] = await context.db.select().from(organizationSettingsTable).limit(1);
    if (!org) {
      throw new ORPCError("PRECONDITION_FAILED", {
        message:
          "Vereinsdaten fehlen. Bitte unter Einstellungen > Vereinsdaten Gläubiger-ID, IBAN und BIC pflegen.",
      });
    }

    // Block duplicate committed runs for the same year.
    const [existing] = await context.db
      .select({ id: feeRunsTable.id })
      .from(feeRunsTable)
      .where(
        and(eq(feeRunsTable.billingYear, input.billingYear), eq(feeRunsTable.status, "committed")),
      )
      .limit(1);
    if (existing) {
      throw new ORPCError("CONFLICT", {
        message: `Für ${input.billingYear} existiert bereits ein abgeschlossener Beitragslauf. Stornieren Sie ihn, um einen neuen zu erzeugen.`,
      });
    }

    const falligkeitsdatum = parseFalligkeit(input.falligkeitsdatum);
    const preview = await buildFeeRunPreview(context.db, {
      billingYear: input.billingYear,
      falligkeitsdatum,
      mandateOverrides: input.mandateOverrides,
    });

    // Optimistic-concurrency: if the world changed since the user clicked
    // Vorschau, refuse to commit.
    if (
      preview.totals.count !== input.expectedItemCount ||
      preview.totals.grandTotal !== input.expectedTotalAmount
    ) {
      throw new ORPCError("CONFLICT", {
        message: `Daten haben sich geändert seit der Vorschau (jetzt ${preview.totals.count} Posten, ${preview.totals.grandTotal} EUR). Bitte erneut prüfen.`,
      });
    }

    if (preview.candidates.length === 0) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Keine berechtigten Posten -- nichts zu erzeugen.",
      });
    }

    // Re-fetch member rows once to decrypt IBANs for XML generation.
    const memberIds = Array.from(new Set(preview.candidates.map((c) => c.memberId)));
    const members = await context.db
      .select({
        id: membersTable.id,
        iban1: membersTable.iban1,
        bic1: membersTable.bic1,
      })
      .from(membersTable)
      .where(inArray(membersTable.id, memberIds));
    // `iban1` is transparently decrypted by the `encryptedText` Drizzle
    // custom type — it arrives here as a plain string already.
    const ibanByMember = new Map<string, string>();
    for (const m of members) {
      if (m.iban1) ibanByMember.set(m.id, m.iban1);
    }

    const orgIban = org.vereinsIban;
    if (!orgIban) {
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: "Vereins-IBAN ist nicht hinterlegt.",
      });
    }

    // Bulk-load all mandate metadata up-front. With ~500 active debits,
    // doing this once is dramatically faster than one select-per-candidate
    // inside the transaction (which previously caused timeouts).
    const mandateIds = Array.from(new Set(preview.candidates.map((c) => c.chosenMandateId)));
    const mandates =
      mandateIds.length === 0
        ? []
        : await context.db
            .select({
              id: sepaMandatesTable.id,
              mandatsNr: sepaMandatesTable.mandatsNr,
              unterschriftDatum: sepaMandatesTable.unterschriftDatum,
              ersteVerwendung: sepaMandatesTable.ersteVerwendung,
            })
            .from(sepaMandatesTable)
            .where(inArray(sepaMandatesTable.id, mandateIds));
    const mandateById = new Map(mandates.map((m) => [m.id, m]));

    const result = await context.db.transaction(async (tx) => {
      // Serialize commits for the same billing year. Without this, two
      // concurrent requests can both pass the duplicate-check above and both
      // insert a committed run -> double SEPA collection. The advisory xact
      // lock blocks the second commit until the first finishes and is
      // released automatically at COMMIT/ROLLBACK. We then re-check inside
      // the lock so the check-and-insert is atomic.
      await tx.execute(sql`select pg_advisory_xact_lock(4711, ${input.billingYear})`);
      const [dupe] = await tx
        .select({ id: feeRunsTable.id })
        .from(feeRunsTable)
        .where(
          and(
            eq(feeRunsTable.billingYear, input.billingYear),
            eq(feeRunsTable.status, "committed"),
          ),
        )
        .limit(1);
      if (dupe) {
        throw new ORPCError("CONFLICT", {
          message: `Für ${input.billingYear} existiert bereits ein abgeschlossener Beitragslauf. Stornieren Sie ihn, um einen neuen zu erzeugen.`,
        });
      }

      // 1. Insert fee run header.
      const [run] = await tx
        .insert(feeRunsTable)
        .values({
          billingYear: input.billingYear,
          falligkeitsdatum: input.falligkeitsdatum,
          status: "committed",
          itemCount: preview.totals.count,
          totalAmount: preview.totals.grandTotal,
          notes: input.notes ?? null,
          createdBy: context.session!.user.id,
          committedAt: new Date(),
          committedBy: context.session!.user.id,
        } as never)
        .returning({ id: feeRunsTable.id });
      if (!run) throw new Error("fee_runs insert returned no row");

      // 2. Bulk-upsert soll_stellungen — one statement instead of one per
      //    candidate. .returning() gives us back the ids in input order,
      //    so we can correlate them with the candidates below.
      const sollByContract = new Map<string, string>();
      if (preview.candidates.length > 0) {
        const sollValues = preview.candidates.map((c) => ({
          memberId: c.memberId,
          contractId: c.contractId,
          billingYear: input.billingYear,
          falligkeitsdatum: input.falligkeitsdatum,
          amount: c.amount,
          paidAmount: "0",
          openAmount: c.amount,
          status: "open" as const,
        }));
        const insertedSoll = await tx
          .insert(sollStellungenTable)
          .values(sollValues as never)
          .onConflictDoUpdate({
            target: [sollStellungenTable.contractId, sollStellungenTable.billingYear],
            set: {
              amount: sql`excluded.amount`,
              openAmount: sql`excluded.open_amount`,
              paidAmount: "0",
              status: "open",
              falligkeitsdatum: input.falligkeitsdatum,
              updatedAt: new Date(),
            },
          })
          .returning({
            id: sollStellungenTable.id,
            contractId: sollStellungenTable.contractId,
          });
        for (const s of insertedSoll) sollByContract.set(s.contractId, s.id);
      }

      // 3. Build fee_run_items in memory, then bulk-insert. Also collect
      //    pain.008 inputs and the set of mandates actually used so the
      //    XML body and the mandate-timestamp bump can happen outside the
      //    per-candidate loop.
      const pain008Items: Pain008Item[] = [];
      const itemValues: Array<Record<string, unknown>> = [];
      const usedMandateIdSet = new Set<string>();
      for (const c of preview.candidates) {
        const iban = ibanByMember.get(c.memberId);
        if (!iban) continue; // Already excluded in preview, defensive.
        const mandate = mandateById.get(c.chosenMandateId);
        if (!mandate) continue;

        const endToEndId = crypto.randomUUID().replace(/-/g, "").slice(0, 35);
        const signatureDate =
          mandate.unterschriftDatum?.toISOString().slice(0, 10) ?? input.falligkeitsdatum;

        itemValues.push({
          feeRunId: run.id,
          memberId: c.memberId,
          contractId: c.contractId,
          sepaMandateId: c.chosenMandateId,
          sollStellungId: sollByContract.get(c.contractId) ?? null,
          amount: c.amount,
          purpose: `Mitgliedsbeitrag ${input.billingYear}${c.includesAufnahmegebuhr ? " inkl. Aufnahmegebühr" : ""}`,
          includesAufnahmegebuhr: c.includesAufnahmegebuhr,
          endToEndId,
          sequenceType: c.sequenceType,
          mandateRef: mandate.mandatsNr,
          mandateSignatureDate: signatureDate,
          debtorName: c.debtorName,
          debtorIbanLast4: c.debtorIbanLast4,
          debtorBic: c.debtorBic,
        });

        pain008Items.push({
          endToEndId,
          amount: c.amount,
          mandateRef: mandate.mandatsNr,
          mandateSignatureDate: signatureDate,
          debtorName: c.debtorName,
          debtorIban: iban,
          debtorBic: c.debtorBic,
          purpose: `Mitgliedsbeitrag ${input.billingYear}${c.includesAufnahmegebuhr ? " inkl. Aufnahmegebuehr" : ""}`,
          sequenceType: c.sequenceType,
        });

        usedMandateIdSet.add(c.chosenMandateId);
      }

      if (itemValues.length > 0) {
        await tx.insert(feeRunItemsTable).values(itemValues as never);
      }

      // 4. Bump mandate timestamps in a single statement instead of one
      //    update per candidate. `letzteVerwendung` is set unconditionally;
      //    `ersteVerwendung` only fills if previously null — this is what
      //    flips the NEXT run from FRST to RCUR for the same mandate.
      if (usedMandateIdSet.size > 0) {
        await tx
          .update(sepaMandatesTable)
          .set({
            letzteVerwendung: falligkeitsdatum,
            ersteVerwendung: sql`coalesce(${sepaMandatesTable.ersteVerwendung}, ${falligkeitsdatum})`,
            updatedAt: new Date(),
          })
          .where(inArray(sepaMandatesTable.id, [...usedMandateIdSet]));
      }

      // 5. Generate XML, persist on the run.
      const msgId = buildMsgId(input.billingYear, run.id);
      const now = new Date();
      const filename = buildXmlFilename(now);
      const xml = buildPain008({
        creditor: {
          name: org.vereinsname,
          iban: orgIban,
          bic: org.vereinsBic,
          glaeubigerId: org.glaeubigerId,
        },
        falligkeitsdatum: input.falligkeitsdatum,
        msgId,
        pmtInfIdPrefix: msgId,
        createdAtIso: now.toISOString(),
        items: pain008Items,
      });

      await tx
        .update(feeRunsTable)
        .set({
          xmlMessageId: msgId,
          xmlPaymentInfoIdFrst: `${msgId}-FRST`,
          xmlPaymentInfoIdRcur: `${msgId}-RCUR`,
          xmlGeneratedAt: now,
          xmlFilename: filename,
          xmlContent: xml,
        })
        .where(eq(feeRunsTable.id, run.id));

      await appendAudit(tx, {
        entityType: "fee_run",
        entityId: run.id,
        action: "create",
        source: "ui",
        actorId: context.session!.user.id,
        actorEmail: context.session!.user.email,
        changes: {
          billingYear: { before: null, after: input.billingYear },
          itemCount: { before: null, after: preview.totals.count },
          totalAmount: { before: null, after: preview.totals.grandTotal },
          status: { before: null, after: "committed" },
        },
        requestId: context.requestId ?? null,
      });

      return {
        feeRunId: run.id,
        itemCount: preview.totals.count,
        totalAmount: preview.totals.grandTotal,
        xmlFilename: filename,
      };
    });

    return result;
  }),

  list: authedProc
    .input(
      v.optional(
        v.object({
          limit: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(200)), 50),
          offset: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0)), 0),
        }),
        { limit: 50, offset: 0 },
      ),
    )
    .handler(async ({ context, input }) => {
      const rows = await context.db
        .select({
          id: feeRunsTable.id,
          billingYear: feeRunsTable.billingYear,
          falligkeitsdatum: feeRunsTable.falligkeitsdatum,
          status: feeRunsTable.status,
          itemCount: feeRunsTable.itemCount,
          totalAmount: feeRunsTable.totalAmount,
          xmlFilename: feeRunsTable.xmlFilename,
          createdAt: feeRunsTable.createdAt,
          committedAt: feeRunsTable.committedAt,
          cancelledAt: feeRunsTable.cancelledAt,
          notes: feeRunsTable.notes,
        })
        .from(feeRunsTable)
        .orderBy(desc(feeRunsTable.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      const totalRows = await context.db.select({ total: count() }).from(feeRunsTable);
      const total = totalRows[0]?.total ?? 0;

      return { rows, total: Number(total) };
    }),

  get: authedProc.input(v.object({ id: v.string() })).handler(async ({ context, input }) => {
    const [run] = await context.db
      .select()
      .from(feeRunsTable)
      .where(eq(feeRunsTable.id, input.id))
      .limit(1);
    if (!run) throw new ORPCError("NOT_FOUND", { message: "Beitragslauf nicht gefunden." });

    const items = await context.db
      .select({
        id: feeRunItemsTable.id,
        memberId: feeRunItemsTable.memberId,
        contractId: feeRunItemsTable.contractId,
        amount: feeRunItemsTable.amount,
        purpose: feeRunItemsTable.purpose,
        includesAufnahmegebuhr: feeRunItemsTable.includesAufnahmegebuhr,
        sequenceType: feeRunItemsTable.sequenceType,
        mandateRef: feeRunItemsTable.mandateRef,
        debtorName: feeRunItemsTable.debtorName,
        debtorIbanLast4: feeRunItemsTable.debtorIbanLast4,
        debtorBic: feeRunItemsTable.debtorBic,
        returnedAt: feeRunItemsTable.returnedAt,
        returnReasonCode: feeRunItemsTable.returnReasonCode,
        memberName: sql<string>`coalesce(${membersTable.vorname} || ' ' || ${membersTable.nachname}, ${membersTable.kurzname}, ${membersTable.firma1}, 'AdrNr ' || ${membersTable.adrNr})`,
        mitglnr: membersTable.mitglnr,
        adrNr: membersTable.adrNr,
        artName: contractsTable.artName,
      })
      .from(feeRunItemsTable)
      .innerJoin(membersTable, eq(feeRunItemsTable.memberId, membersTable.id))
      .innerJoin(contractsTable, eq(feeRunItemsTable.contractId, contractsTable.id))
      .where(eq(feeRunItemsTable.feeRunId, input.id))
      .orderBy(membersTable.nachname, membersTable.vorname);

    // Strip XML body from list response -- only fetched via downloadXml.
    const { xmlContent: _, ...header } = run;
    return { ...header, hasXml: !!run.xmlContent, items };
  }),

  downloadXml: vorstandProc
    .input(v.object({ id: v.string() }))
    .handler(async ({ context, input }) => {
      const [run] = await context.db
        .select({
          xmlFilename: feeRunsTable.xmlFilename,
          xmlContent: feeRunsTable.xmlContent,
        })
        .from(feeRunsTable)
        .where(eq(feeRunsTable.id, input.id))
        .limit(1);
      if (!run?.xmlContent || !run.xmlFilename) {
        throw new ORPCError("NOT_FOUND", { message: "Keine XML-Datei für diesen Lauf vorhanden." });
      }

      await appendAudit(context.db, {
        entityType: "fee_run",
        entityId: input.id,
        action: "update",
        source: "ui",
        actorId: context.session!.user.id,
        actorEmail: context.session!.user.email,
        changes: { downloaded: { before: null, after: new Date().toISOString() } },
        requestId: context.requestId ?? null,
      });

      return { filename: run.xmlFilename, content: run.xmlContent };
    }),

  cancel: vorstandProc
    .input(v.object({ id: v.string(), reason: v.optional(v.nullable(v.string()), null) }))
    .handler(async ({ context, input }) => {
      const [run] = await context.db
        .select()
        .from(feeRunsTable)
        .where(eq(feeRunsTable.id, input.id))
        .limit(1);
      if (!run) throw new ORPCError("NOT_FOUND", { message: "Beitragslauf nicht gefunden." });
      if (run.status !== "committed") {
        throw new ORPCError("CONFLICT", {
          message: `Nur Läufe im Status 'committed' können storniert werden (aktuell: ${run.status}).`,
        });
      }

      await context.db.transaction(async (tx) => {
        await tx
          .update(feeRunsTable)
          .set({
            status: "cancelled",
            cancelledAt: new Date(),
            cancelledBy: context.session!.user.id,
            notes: input.reason
              ? `${run.notes ? `${run.notes}\n` : ""}Storniert: ${input.reason}`
              : run.notes,
          })
          .where(eq(feeRunsTable.id, input.id));

        // Mark all linked soll_stellungen as cancelled.
        const items = await tx
          .select({ sollStellungId: feeRunItemsTable.sollStellungId })
          .from(feeRunItemsTable)
          .where(eq(feeRunItemsTable.feeRunId, input.id));
        const sollIds = items.map((i) => i.sollStellungId).filter((id): id is string => id != null);
        if (sollIds.length > 0) {
          await tx
            .update(sollStellungenTable)
            .set({ status: "cancelled", updatedAt: new Date() })
            .where(inArray(sollStellungenTable.id, sollIds));
        }

        await appendAudit(tx, {
          entityType: "fee_run",
          entityId: input.id,
          action: "update",
          source: "ui",
          actorId: context.session!.user.id,
          actorEmail: context.session!.user.email,
          changes: {
            status: { before: "committed", after: "cancelled" },
            reason: { before: null, after: input.reason ?? null },
          },
          requestId: context.requestId ?? null,
        });
      });

      return { ok: true };
    }),
};

// Suppress unused-import warning for ne / isNull -- kept for future filters.
void ne;
void isNull;
