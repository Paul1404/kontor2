import { ORPCError } from "@orpc/server";
import { and, count, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import * as v from "valibot";
import { appendAudit } from "~/server/audit/log";
import { getMailer } from "~/server/auth/send-invite";
import { escapeLike } from "~/server/db/like";
import { memberNotDeleted } from "~/server/db/member-filters";
import { contractsTable } from "~/server/db/schema/contracts";
import { feeRunItemsTable, feeRunsTable, sollStellungenTable } from "~/server/db/schema/fee-runs";
import { membersTable } from "~/server/db/schema/members";
import { organizationSettingsTable } from "~/server/db/schema/organization-settings";
import { type SepaMandate, sepaMandatesTable } from "~/server/db/schema/sepa";
import { memberDisplayName } from "~/server/domain/member";
import { authedProc, vorstandProc } from "~/server/orpc/base";
import { amountStrToCents, buildFeeRunPreview, centsToAmount } from "~/server/sepa/build-fee-run";
import { recollectionBlockReason } from "~/server/sepa/build-recollection";
import { buildPain008, type Pain008Item } from "~/server/sepa/pain008";
import { buildPrenotificationEmail } from "~/server/sepa/prenotification";
import { selectMandate, sequenceTypeFor } from "~/server/sepa/select-mandate";

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

  /**
   * Compare what this year's run would produce against last year's postings,
   * per contract: who is new, who fell away, and whose amount changed. Lets the
   * Vorstand sanity-check a Beitragslauf before committing.
   */
  simulate: vorstandProc.input(PreviewInput).handler(async ({ context, input }) => {
    const preview = await buildFeeRunPreview(context.db, {
      billingYear: input.billingYear,
      falligkeitsdatum: parseFalligkeit(input.falligkeitsdatum),
      mandateOverrides: input.mandateOverrides,
    });

    const prevRows = await context.db
      .select({
        contractId: sollStellungenTable.contractId,
        amount: sollStellungenTable.amount,
        name: sql<string>`coalesce(${membersTable.vorname} || ' ' || ${membersTable.nachname}, ${membersTable.kurzname}, ${membersTable.firma1}, 'AdrNr ' || ${membersTable.adrNr})`,
      })
      .from(sollStellungenTable)
      .innerJoin(membersTable, eq(membersTable.id, sollStellungenTable.memberId))
      .where(
        and(
          eq(sollStellungenTable.billingYear, input.billingYear - 1),
          ne(sollStellungenTable.status, "cancelled"),
        ),
      );

    const cents = (s: string) => Math.round(Number.parseFloat(s) * 100);
    const prevByContract = new Map(prevRows.map((p) => [p.contractId, p]));
    const thisByContract = new Map(preview.candidates.map((c) => [c.contractId, c]));

    const added: Array<{ name: string; amount: string }> = [];
    const changed: Array<{ name: string; from: string; to: string }> = [];
    let unchangedCount = 0;
    for (const c of preview.candidates) {
      const prev = prevByContract.get(c.contractId);
      if (!prev) {
        added.push({ name: c.debtorName, amount: c.amount });
      } else if (cents(prev.amount) !== cents(c.amount)) {
        changed.push({ name: c.debtorName, from: prev.amount, to: c.amount });
      } else {
        unchangedCount += 1;
      }
    }
    const removed = prevRows
      .filter((p) => !thisByContract.has(p.contractId))
      .map((p) => ({ name: p.name, amount: p.amount }));

    const prevTotalCents = prevRows.reduce((s, p) => s + cents(p.amount), 0);
    return {
      thisYear: { count: preview.totals.count, total: preview.totals.grandTotal },
      lastYear: {
        year: input.billingYear - 1,
        count: prevRows.length,
        total: (prevTotalCents / 100).toFixed(2),
      },
      added: added.sort((a, b) => a.name.localeCompare(b.name)),
      removed: removed.sort((a, b) => a.name.localeCompare(b.name)),
      changed: changed.sort((a, b) => a.name.localeCompare(b.name)),
      unchangedCount,
    };
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

    // Runs are incremental: a contract already carrying a live Sollstellung for
    // the year is excluded by buildFeeRunPreview, so a second run for the same
    // year only collects members added or unblocked since the last run. No
    // hard block on a second committed run -- the catch-up run is the point.
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
        message: "Keine berechtigten Posten. Es gibt nichts zu erzeugen.",
      });
    }

    // Re-fetch payer rows once to decrypt IBANs for XML generation. The debit
    // hits the Zahler's account (family payer / guardian / the member itself),
    // so the lookup is keyed by zahlerMemberId, not the billed member.
    const zahlerIds = Array.from(new Set(preview.candidates.map((c) => c.zahlerMemberId)));
    const zahlerRows = await context.db
      .select({
        id: membersTable.id,
        iban1: membersTable.iban1,
        bic1: membersTable.bic1,
      })
      .from(membersTable)
      .where(inArray(membersTable.id, zahlerIds));
    // `iban1` is transparently decrypted by the `encryptedText` Drizzle
    // custom type — it arrives here as a plain string already.
    const ibanByZahler = new Map<string, string>();
    for (const m of zahlerRows) {
      if (m.iban1) ibanByZahler.set(m.id, m.iban1);
    }

    const orgIban = org.vereinsIban;
    if (!orgIban) {
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: "Vereins-IBAN ist nicht hinterlegt.",
      });
    }
    // A blank creditor BIC produces `<BIC></BIC>` in the pain.008 and the bank
    // rejects the whole file on upload, after the run is already committed.
    // Fail before booking anything.
    if (!org.vereinsBic?.trim()) {
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: "Vereins-BIC ist nicht hinterlegt.",
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

      // Re-check inside the lock which candidates already have a live posting
      // for the year. The preview was built before the lock, so a concurrent
      // (or just-finished) run for the same year may have billed some of them
      // since; re-billing would double-collect. Drop those defensively.
      const previewContractIds = [
        ...preview.candidates.map((c) => c.contractId),
        ...preview.invoices.map((i) => i.contractId),
      ];
      const liveSoll =
        previewContractIds.length === 0
          ? []
          : await tx
              .select({ contractId: sollStellungenTable.contractId })
              .from(sollStellungenTable)
              .where(
                and(
                  inArray(sollStellungenTable.contractId, previewContractIds),
                  eq(sollStellungenTable.billingYear, input.billingYear),
                  ne(sollStellungenTable.status, "cancelled"),
                ),
              );
      const liveSet = new Set(liveSoll.map((s) => s.contractId));
      const candidates = preview.candidates.filter((c) => !liveSet.has(c.contractId));
      const invoiceItems = preview.invoices.filter((i) => !liveSet.has(i.contractId));
      if (candidates.length === 0 && invoiceItems.length === 0) {
        throw new ORPCError("CONFLICT", {
          message: `Alle Posten für ${input.billingYear} wurden zwischenzeitlich bereits abgerechnet.`,
        });
      }
      let runCents = 0n;
      for (const c of candidates) runCents += amountStrToCents(c.amount);
      const runItemCount = candidates.length;
      const runTotalAmount = centsToAmount(runCents);

      // 1. Insert fee run header.
      const [run] = await tx
        .insert(feeRunsTable)
        .values({
          billingYear: input.billingYear,
          falligkeitsdatum: input.falligkeitsdatum,
          status: "committed",
          itemCount: runItemCount,
          totalAmount: runTotalAmount,
          notes: input.notes ?? null,
          createdBy: context.session!.user.id,
          committedAt: new Date(),
          committedBy: context.session!.user.id,
        } as never)
        .returning({ id: feeRunsTable.id });
      if (!run)
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "Beitragslauf konnte nicht angelegt werden.",
        });

      // 2. Bulk-upsert soll_stellungen — one statement instead of one per
      //    candidate. .returning() gives us back the ids in input order,
      //    so we can correlate them with the candidates below.
      //
      //    Every candidate here is a SEPA direct-debit payer (build-fee-run
      //    excludes anyone without `lastschrift = 'J'` and an active mandate).
      //    A direct debit is collected unless the bank reports a return, so we
      //    book the posting as `eingezogen` (presumed collected) right away
      //    instead of `open`. Recording a Rücklastschrift reopens it. This is
      //    what keeps the Mahnwesen from chasing money that was already pulled.
      const sollByContract = new Map<string, string>();
      if (candidates.length > 0) {
        const sollValues = candidates.map((c) => ({
          memberId: c.memberId,
          contractId: c.contractId,
          billingYear: input.billingYear,
          falligkeitsdatum: input.falligkeitsdatum,
          amount: c.amount,
          paidAmount: c.amount,
          openAmount: "0",
          status: "eingezogen" as const,
          feeRunId: run.id,
        }));
        const insertedSoll = await tx
          .insert(sollStellungenTable)
          .values(sollValues as never)
          .onConflictDoUpdate({
            target: [sollStellungenTable.contractId, sollStellungenTable.billingYear],
            set: {
              amount: sql`excluded.amount`,
              openAmount: "0",
              paidAmount: sql`excluded.amount`,
              status: "eingezogen",
              falligkeitsdatum: input.falligkeitsdatum,
              feeRunId: run.id,
              updatedAt: new Date(),
            },
          })
          .returning({
            id: sollStellungenTable.id,
            contractId: sollStellungenTable.contractId,
          });
        for (const s of insertedSoll) sollByContract.set(s.contractId, s.id);
      }

      // 2b. Rechnungszahler: offene Sollstellung (status "open"), keine
      //     pain.008-Zeile, kein Mandat. Sie erscheint sofort in Offenen Posten
      //     und ist mahnbar, sobald sie überfällig ist. Idempotent über den
      //     (contract, year)-Unique-Index.
      if (invoiceItems.length > 0) {
        await tx
          .insert(sollStellungenTable)
          .values(
            invoiceItems.map((i) => ({
              memberId: i.memberId,
              contractId: i.contractId,
              billingYear: input.billingYear,
              falligkeitsdatum: input.falligkeitsdatum,
              amount: i.amount,
              paidAmount: "0",
              openAmount: i.amount,
              status: "open" as const,
              feeRunId: run.id,
            })) as never,
          )
          .onConflictDoUpdate({
            target: [sollStellungenTable.contractId, sollStellungenTable.billingYear],
            set: {
              amount: sql`excluded.amount`,
              openAmount: sql`excluded.amount`,
              paidAmount: "0",
              status: "open",
              falligkeitsdatum: input.falligkeitsdatum,
              feeRunId: run.id,
              updatedAt: new Date(),
            },
          });
      }

      // 3. Build fee_run_items in memory, then bulk-insert. Also collect
      //    pain.008 inputs and the set of mandates actually used so the
      //    XML body and the mandate-timestamp bump can happen outside the
      //    per-candidate loop.
      const pain008Items: Pain008Item[] = [];
      const itemValues: Array<Record<string, unknown>> = [];
      const usedMandateIdSet = new Set<string>();
      for (const c of candidates) {
        const iban = ibanByZahler.get(c.zahlerMemberId);
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
          zahlerMemberId: c.zahlerMemberId,
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

      // 5. Generate the pain.008 XML and persist it on the run -- only when
      //    there are direct-debit items. An invoice-only run (alle Zahler auf
      //    Rechnung) hat keine SEPA-Datei.
      let xmlFilename: string | null = null;
      if (pain008Items.length > 0) {
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
        xmlFilename = filename;
      }

      await appendAudit(tx, {
        entityType: "fee_run",
        entityId: run.id,
        action: "create",
        source: "ui",
        actorId: context.session!.user.id,
        actorEmail: context.session!.user.email,
        changes: {
          billingYear: { before: null, after: input.billingYear },
          itemCount: { before: null, after: runItemCount },
          totalAmount: { before: null, after: runTotalAmount },
          status: { before: null, after: "committed" },
        },
        requestId: context.requestId ?? null,
      });

      return {
        feeRunId: run.id,
        itemCount: runItemCount,
        totalAmount: runTotalAmount,
        xmlFilename,
        invoiceCount: invoiceItems.length,
      };
    });

    return result;
  }),

  /**
   * Returned postings (Rücklastschriften) that could be re-collected, with the
   * reason blocking each one that cannot. Drives the Wiedereinzug picker: a row
   * is selectable only when it carries an active mandate, an IBAN, an active
   * direct-debit contract, and no Einzug-Sperre.
   */
  recollectCandidates: vorstandProc
    .input(
      v.optional(
        v.object({
          query: v.optional(v.nullable(v.string()), null),
          limit: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(200)), 100),
        }),
        {},
      ),
    )
    .handler(async ({ context, input }) => {
      const q = (input.query ?? "").trim();
      const like = `%${escapeLike(q)}%`;
      const rows = await context.db
        .select({
          sollStellungId: sollStellungenTable.id,
          memberId: sollStellungenTable.memberId,
          contractId: sollStellungenTable.contractId,
          billingYear: sollStellungenTable.billingYear,
          amount: sollStellungenTable.amount,
          openAmount: sollStellungenTable.openAmount,
          artName: contractsTable.artName,
          isDirectDebit: contractsTable.isDirectDebit,
          directDebitBlocked: membersTable.directDebitBlocked,
          hasIban: sql<boolean>`${membersTable.iban1} is not null`,
          iban1Last4: membersTable.iban1Last4,
          memberName: sql<string>`coalesce(${membersTable.vorname} || ' ' || ${membersTable.nachname}, ${membersTable.kurzname}, ${membersTable.firma1}, 'AdrNr ' || ${membersTable.adrNr})`,
          memberNo: membersTable.memberNo,
          kontaktNo: membersTable.kontaktNo,
          mitgliedsnummer: membersTable.mitgliedsnummer,
          adrNr: membersTable.adrNr,
        })
        .from(sollStellungenTable)
        .innerJoin(membersTable, eq(membersTable.id, sollStellungenTable.memberId))
        .innerJoin(contractsTable, eq(contractsTable.id, sollStellungenTable.contractId))
        .where(
          and(
            eq(sollStellungenTable.status, "returned"),
            memberNotDeleted(),
            q
              ? sql`(
                  ${membersTable.mitgliedsnummer} ilike ${like} or
                  ${membersTable.nachname} ilike ${like} or
                  ${membersTable.vorname} ilike ${like} or
                  ${membersTable.firma1} ilike ${like}
                )`
              : sql`true`,
          ),
        )
        .orderBy(desc(sollStellungenTable.billingYear), membersTable.nachname)
        .limit(input.limit);

      // Bulk-load mandates and decide which one each member would use, so the
      // picker can show the mandate reference and flag the missing-mandate case.
      const memberIds = Array.from(new Set(rows.map((r) => r.memberId)));
      const mandates =
        memberIds.length === 0
          ? []
          : await context.db
              .select()
              .from(sepaMandatesTable)
              .where(inArray(sepaMandatesTable.memberId, memberIds));
      const byMember = new Map<string, SepaMandate[]>();
      for (const m of mandates) {
        const list = byMember.get(m.memberId) ?? [];
        list.push(m);
        byMember.set(m.memberId, list);
      }

      return rows.map((r) => {
        const chosen = selectMandate(byMember.get(r.memberId) ?? []).chosen;
        const blockReason = recollectionBlockReason({
          directDebitBlocked: r.directDebitBlocked,
          isDirectDebit: r.isDirectDebit,
          hasMandate: chosen != null,
          hasIban: r.hasIban,
        });
        return {
          sollStellungId: r.sollStellungId,
          memberId: r.memberId,
          memberName: r.memberName,
          memberNo: r.memberNo,
          kontaktNo: r.kontaktNo,
          mitgliedsnummer: r.mitgliedsnummer,
          adrNr: r.adrNr,
          billingYear: r.billingYear,
          artName: r.artName,
          amount: centsToAmount(amountStrToCents(r.openAmount)),
          mandateRef: chosen?.mandatsNr ?? null,
          iban1Last4: r.iban1Last4,
          eligible: blockReason === null,
          blockReason,
        };
      });
    }),

  /**
   * Wiedereinzug: re-debit selected returned postings in a fresh pain.008
   * without ever deleting the original Sollstellung. Each selected posting
   * flips back from `returned` to `eingezogen`, gets a new fee_run_item (so a
   * second Rücklastschrift can be recorded against it), and the run is marked
   * `kind = 'recollection'` so it reads apart from the yearly Beitragslauf.
   */
  recollect: vorstandProc
    .input(
      v.object({
        sollStellungIds: v.pipe(v.array(v.string()), v.minLength(1)),
        falligkeitsdatum: v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/)),
      }),
    )
    .handler(async ({ context, input }) => {
      const [org] = await context.db.select().from(organizationSettingsTable).limit(1);
      if (!org?.vereinsIban) {
        throw new ORPCError("PRECONDITION_FAILED", {
          message:
            "Vereinsdaten fehlen. Bitte unter Einstellungen > Vereinsdaten Gläubiger-ID, IBAN und BIC pflegen.",
        });
      }
      if (!org.vereinsBic?.trim()) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "Vereins-BIC ist nicht hinterlegt.",
        });
      }

      const falligkeitsdatum = parseFalligkeit(input.falligkeitsdatum);
      const ids = Array.from(new Set(input.sollStellungIds));

      // Load the postings with their member (IBAN decrypts transparently) and
      // contract. Only returned postings of non-deleted members qualify.
      const postings = await context.db
        .select({
          sollStellungId: sollStellungenTable.id,
          memberId: sollStellungenTable.memberId,
          contractId: sollStellungenTable.contractId,
          billingYear: sollStellungenTable.billingYear,
          amount: sollStellungenTable.amount,
          isDirectDebit: contractsTable.isDirectDebit,
          abwKontoInh: contractsTable.abwKontoInh,
          directDebitBlocked: membersTable.directDebitBlocked,
          iban1: membersTable.iban1,
          iban1Last4: membersTable.iban1Last4,
          bic1: membersTable.bic1,
          vorname: membersTable.vorname,
          nachname: membersTable.nachname,
          kurzname: membersTable.kurzname,
          firma1: membersTable.firma1,
          adrNr: membersTable.adrNr,
        })
        .from(sollStellungenTable)
        .innerJoin(membersTable, eq(membersTable.id, sollStellungenTable.memberId))
        .innerJoin(contractsTable, eq(contractsTable.id, sollStellungenTable.contractId))
        .where(
          and(
            inArray(sollStellungenTable.id, ids),
            eq(sollStellungenTable.status, "returned"),
            memberNotDeleted(),
          ),
        );
      if (postings.length === 0) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Keine einziehbaren Rückläufer ausgewählt.",
        });
      }

      const memberIds = Array.from(new Set(postings.map((p) => p.memberId)));
      const mandates = await context.db
        .select()
        .from(sepaMandatesTable)
        .where(inArray(sepaMandatesTable.memberId, memberIds));
      const mandatesByMember = new Map<string, SepaMandate[]>();
      for (const m of mandates) {
        const list = mandatesByMember.get(m.memberId) ?? [];
        list.push(m);
        mandatesByMember.set(m.memberId, list);
      }

      // Header billing year is just a label; items carry their own year in the
      // purpose. Use the newest among the selection.
      const runYear = Math.max(...postings.map((p) => p.billingYear));

      const result = await context.db.transaction(async (tx) => {
        // Serialize recollections against each other; the per-row status guard
        // below blocks any concurrent run that already re-collected a posting.
        await tx.execute(sql`select pg_advisory_xact_lock(4712)`);

        // Re-read which of the selected postings are still `returned` inside the
        // lock -- a concurrent recollection or a markPaid may have moved them.
        const stillReturned = await tx
          .select({ id: sollStellungenTable.id })
          .from(sollStellungenTable)
          .where(
            and(inArray(sollStellungenTable.id, ids), eq(sollStellungenTable.status, "returned")),
          );
        const liveSet = new Set(stillReturned.map((r) => r.id));

        const run = (
          await tx
            .insert(feeRunsTable)
            .values({
              billingYear: runYear,
              falligkeitsdatum: input.falligkeitsdatum,
              status: "committed",
              kind: "recollection",
              itemCount: 0,
              totalAmount: "0",
              createdBy: context.session!.user.id,
              committedAt: new Date(),
              committedBy: context.session!.user.id,
            } as never)
            .returning({ id: feeRunsTable.id })
        )[0];
        if (!run)
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: "Beitragslauf konnte nicht angelegt werden.",
          });

        const pain008Items: Pain008Item[] = [];
        const usedMandateIds = new Set<string>();
        const skipped: string[] = [];
        let runCents = 0n;

        for (const p of postings) {
          if (!liveSet.has(p.sollStellungId)) continue; // claimed elsewhere
          const chosen = selectMandate(mandatesByMember.get(p.memberId) ?? []).chosen;
          const iban = p.iban1;
          const debtorName =
            p.abwKontoInh?.trim() ||
            memberDisplayName({
              vorname: p.vorname,
              nachname: p.nachname,
              kurzname: p.kurzname,
              firma1: p.firma1,
              adrNr: p.adrNr,
            });
          const blockReason = recollectionBlockReason({
            directDebitBlocked: p.directDebitBlocked,
            isDirectDebit: p.isDirectDebit,
            hasMandate: chosen != null,
            hasIban: !!iban,
          });
          if (blockReason || !chosen || !iban) {
            skipped.push(`${debtorName}: ${blockReason ?? "nicht einziehbar"}`);
            continue;
          }

          const amount = centsToAmount(amountStrToCents(p.amount));
          const endToEndId = crypto.randomUUID().replace(/-/g, "").slice(0, 35);
          const sequenceType = sequenceTypeFor(chosen);
          const signatureDate =
            chosen.unterschriftDatum?.toISOString().slice(0, 10) ?? input.falligkeitsdatum;
          const purpose = `Mitgliedsbeitrag ${p.billingYear} (Wiedereinzug)`;

          const item = (
            await tx
              .insert(feeRunItemsTable)
              .values({
                feeRunId: run.id,
                memberId: p.memberId,
                contractId: p.contractId,
                sepaMandateId: chosen.id,
                sollStellungId: p.sollStellungId,
                amount,
                purpose,
                includesAufnahmegebuhr: false,
                endToEndId,
                sequenceType,
                mandateRef: chosen.mandatsNr,
                mandateSignatureDate: signatureDate,
                debtorName,
                debtorIbanLast4: p.iban1Last4 ?? iban.slice(-4),
                debtorBic: p.bic1 ?? null,
              } as never)
              .returning({ id: feeRunItemsTable.id })
          )[0];

          // Re-collected: presumed pulled again, so back to eingezogen / paid.
          await tx
            .update(sollStellungenTable)
            .set({
              status: "eingezogen",
              paidAmount: sql`${sollStellungenTable.amount}`,
              openAmount: "0",
              lastFeeRunItemId: item?.id ?? null,
              updatedAt: new Date(),
            })
            .where(eq(sollStellungenTable.id, p.sollStellungId));

          pain008Items.push({
            endToEndId,
            amount,
            mandateRef: chosen.mandatsNr,
            mandateSignatureDate: signatureDate,
            debtorName,
            debtorIban: iban,
            debtorBic: p.bic1 ?? null,
            purpose: `Mitgliedsbeitrag ${p.billingYear} (Wiedereinzug)`,
            sequenceType,
          });
          usedMandateIds.add(chosen.id);
          runCents += amountStrToCents(amount);
        }

        if (pain008Items.length === 0) {
          throw new ORPCError("CONFLICT", {
            message:
              skipped.length > 0
                ? `Kein Posten einziehbar. ${skipped.join("; ")}`
                : "Die ausgewählten Rückläufer wurden zwischenzeitlich bereits bearbeitet.",
          });
        }

        if (usedMandateIds.size > 0) {
          await tx
            .update(sepaMandatesTable)
            .set({
              letzteVerwendung: falligkeitsdatum,
              ersteVerwendung: sql`coalesce(${sepaMandatesTable.ersteVerwendung}, ${falligkeitsdatum})`,
              updatedAt: new Date(),
            })
            .where(inArray(sepaMandatesTable.id, [...usedMandateIds]));
        }

        const runTotalAmount = centsToAmount(runCents);
        const msgId = buildMsgId(runYear, run.id);
        const now = new Date();
        const filename = buildXmlFilename(now);
        const xml = buildPain008({
          creditor: {
            name: org.vereinsname,
            iban: org.vereinsIban,
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
            itemCount: pain008Items.length,
            totalAmount: runTotalAmount,
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
            kind: { before: null, after: "recollection" },
            itemCount: { before: null, after: pain008Items.length },
            totalAmount: { before: null, after: runTotalAmount },
            status: { before: null, after: "committed" },
          },
          requestId: context.requestId ?? null,
        });

        return {
          feeRunId: run.id,
          itemCount: pain008Items.length,
          totalAmount: runTotalAmount,
          xmlFilename: filename,
          skipped,
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
          kind: feeRunsTable.kind,
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
        memberNo: membersTable.memberNo,
        kontaktNo: membersTable.kontaktNo,
        mitgliedsnummer: membersTable.mitgliedsnummer,
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

  /**
   * Storniert eine einzelne Sollstellung (Status -> cancelled). Gedacht für
   * importierte Posten, die Linear fälschlich als eingezogen führte (z. B.
   * geplatzte Lastschrift, die nie als Rückläufer erfasst wurde): nach dem
   * Storno gilt der Vertrag für das Jahr als unabgerechnet und der nächste
   * Beitragslauf zieht ihn wieder ein.
   *
   * Bewusst NUR für Posten, die nie durch einen App-Lauf gelaufen sind
   * (keine fee_run_items): bei App-eingezogenen Posten ist der richtige Weg
   * der Rückläufer (sepa_returns) plus Wiedereinzug, damit die Historie
   * stimmt. Rückläufer-Posten (returned) sind ebenfalls gesperrt, die gehören
   * in den Wiedereinzug.
   */
  stornoSollstellung: vorstandProc
    .input(
      v.object({
        sollStellungId: v.string(),
        notes: v.optional(v.nullable(v.string()), null),
      }),
    )
    .handler(async ({ context, input }) => {
      await context.db.transaction(async (tx) => {
        const [row] = await tx
          .select({
            id: sollStellungenTable.id,
            status: sollStellungenTable.status,
            paidAmount: sollStellungenTable.paidAmount,
            openAmount: sollStellungenTable.openAmount,
            notes: sollStellungenTable.notes,
          })
          .from(sollStellungenTable)
          .where(eq(sollStellungenTable.id, input.sollStellungId))
          .limit(1);
        if (!row) {
          throw new ORPCError("NOT_FOUND", { message: "Sollstellung nicht gefunden." });
        }
        if (row.status === "cancelled") return;
        if (row.status === "returned") {
          throw new ORPCError("VALIDATION_FAILED", {
            message:
              "Rückläufer werden nicht storniert. Diesen Posten über den Wiedereinzug erneut einziehen.",
          });
        }
        if (row.status === "paid") {
          throw new ORPCError("VALIDATION_FAILED", {
            message: "Ein bezahlter Posten wird nicht storniert. Erst die Zahlung klären.",
          });
        }
        const [item] = await tx
          .select({ id: feeRunItemsTable.id })
          .from(feeRunItemsTable)
          .where(eq(feeRunItemsTable.sollStellungId, input.sollStellungId))
          .limit(1);
        if (item) {
          throw new ORPCError("VALIDATION_FAILED", {
            message:
              "Dieser Posten wurde über einen Beitragslauf eingezogen. Geplatzte Lastschriften als Rückläufer erfassen und über den Wiedereinzug erneut einziehen.",
          });
        }

        await tx
          .update(sollStellungenTable)
          .set({
            status: "cancelled",
            paidAmount: "0",
            openAmount: "0",
            notes: input.notes ?? row.notes,
            updatedAt: new Date(),
          })
          .where(eq(sollStellungenTable.id, input.sollStellungId));

        await appendAudit(tx, {
          entityType: "soll_stellung",
          entityId: row.id,
          action: "update",
          source: "ui",
          actorId: context.session!.user.id,
          actorEmail: context.session!.user.email,
          changes: {
            status: { before: row.status, after: "cancelled" },
            paidAmount: { before: row.paidAmount, after: "0" },
            openAmount: { before: row.openAmount, after: "0" },
            ...(input.notes ? { notes: { before: row.notes, after: input.notes } } : {}),
          },
          requestId: context.requestId ?? null,
        });
      });
      return { ok: true };
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
          // Only revert postings still in the `eingezogen` state this run put
          // them in. A posting that has since been returned (Rücklastschrift ->
          // `returned`), paid, or otherwise touched must not be clobbered back
          // to `cancelled`, or a real open debt silently leaves the Mahnwesen.
          await tx
            .update(sollStellungenTable)
            .set({ status: "cancelled", updatedAt: new Date() })
            .where(
              and(
                inArray(sollStellungenTable.id, sollIds),
                eq(sollStellungenTable.status, "eingezogen"),
              ),
            );
        }

        // Invoice-payer postings this run created have status "open" and no
        // fee_run_item to revert through, so the loop above misses them and they
        // stay open and dunnable after a Storno. Cancel them via the run link,
        // but only while still fully open (untouched): a partially paid posting
        // must keep its real open balance.
        await tx
          .update(sollStellungenTable)
          .set({ status: "cancelled", updatedAt: new Date() })
          .where(
            and(
              eq(sollStellungenTable.feeRunId, input.id),
              eq(sollStellungenTable.status, "open"),
              sql`${sollStellungenTable.paidAmount} = 0`,
            ),
          );

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

  /** Counts for the pre-notification UI: how many debtors are reachable by email. */
  prenotifyInfo: vorstandProc
    .input(v.object({ id: v.string() }))
    .handler(async ({ context, input }) => {
      const [run] = await context.db
        .select({
          status: feeRunsTable.status,
          falligkeitsdatum: feeRunsTable.falligkeitsdatum,
          prenotifiedAt: feeRunsTable.prenotifiedAt,
        })
        .from(feeRunsTable)
        .where(eq(feeRunsTable.id, input.id))
        .limit(1);
      if (!run) throw new ORPCError("NOT_FOUND", { message: "Beitragslauf nicht gefunden." });
      const rows = await context.db
        .select({ email: membersTable.email })
        .from(feeRunItemsTable)
        // The SEPA debit hits the Zahler's account, so the pre-notification must
        // go to the Zahler (family payer / guardian), not the billed member.
        // Fall back to the billed member for rows written before zahlerMemberId.
        .innerJoin(
          membersTable,
          eq(
            membersTable.id,
            sql`coalesce(${feeRunItemsTable.zahlerMemberId}, ${feeRunItemsTable.memberId})`,
          ),
        )
        .where(eq(feeRunItemsTable.feeRunId, input.id));
      const withEmail = rows.filter((r) => !!r.email?.trim() && r.email.includes("@")).length;
      return {
        status: run.status,
        falligkeitsdatum: run.falligkeitsdatum,
        prenotifiedAt: run.prenotifiedAt,
        total: rows.length,
        withEmail,
        withoutEmail: rows.length - withEmail,
      };
    }),

  /** Send the SEPA pre-notification (Vorabankündigung) to every debtor with an email. */
  sendPrenotifications: vorstandProc
    .input(v.object({ id: v.string() }))
    .handler(async ({ context, input }) => {
      const [run] = await context.db
        .select()
        .from(feeRunsTable)
        .where(eq(feeRunsTable.id, input.id))
        .limit(1);
      if (!run) throw new ORPCError("NOT_FOUND", { message: "Beitragslauf nicht gefunden." });
      if (run.status !== "committed") {
        throw new ORPCError("CONFLICT", {
          message: "Vorabankündigungen nur für abgeschlossene Läufe möglich.",
        });
      }
      const [org] = await context.db.select().from(organizationSettingsTable).limit(1);
      const mailer = await getMailer(context.db);
      if (!mailer) {
        throw new ORPCError("PRECONDITION_FAILED", {
          message: "SMTP ist nicht konfiguriert. Bitte unter Einstellungen > SMTP einrichten.",
        });
      }

      const items = await context.db
        .select({
          amount: feeRunItemsTable.amount,
          mandateRef: feeRunItemsTable.mandateRef,
          email: membersTable.email,
          vorname: membersTable.vorname,
          nachname: membersTable.nachname,
          kurzname: membersTable.kurzname,
          firma1: membersTable.firma1,
          memberNo: membersTable.memberNo,
          kontaktNo: membersTable.kontaktNo,
          mitgliedsnummer: membersTable.mitgliedsnummer,
          adrNr: membersTable.adrNr,
        })
        .from(feeRunItemsTable)
        // The SEPA debit hits the Zahler's account, so the pre-notification must
        // go to the Zahler (family payer / guardian), not the billed member.
        // Fall back to the billed member for rows written before zahlerMemberId.
        .innerJoin(
          membersTable,
          eq(
            membersTable.id,
            sql`coalesce(${feeRunItemsTable.zahlerMemberId}, ${feeRunItemsTable.memberId})`,
          ),
        )
        .where(eq(feeRunItemsTable.feeRunId, input.id));

      let sent = 0;
      let failed = 0;
      let skipped = 0;
      let firstError: string | null = null;
      for (const it of items) {
        const to = it.email?.trim();
        if (!to?.includes("@")) {
          skipped += 1;
          continue;
        }
        const { subject, text } = buildPrenotificationEmail({
          recipientName: memberDisplayName(it),
          vereinsname: org?.vereinsname ?? "Ihr Verein",
          glaeubigerId: org?.glaeubigerId ?? null,
          mandateRef: it.mandateRef,
          amount: it.amount,
          falligkeitsdatum: run.falligkeitsdatum,
          billingYear: run.billingYear,
        });
        try {
          await mailer.send({ to, subject, text });
          sent += 1;
        } catch (e) {
          failed += 1;
          if (!firstError) firstError = e instanceof Error ? e.message : String(e);
        }
      }

      // Only mark the run as pre-notified when at least one mail actually went
      // out. Marking it on a total failure would claim a Vorabankündigung was
      // sent when none was, and the SEPA debit must not run without it.
      if (sent > 0) {
        await context.db
          .update(feeRunsTable)
          .set({ prenotifiedAt: new Date() })
          .where(eq(feeRunsTable.id, input.id));
      }
      await appendAudit(context.db, {
        entityType: "fee_run",
        entityId: input.id,
        action: "update",
        source: "ui",
        actorId: context.session!.user.id,
        actorEmail: context.session!.user.email,
        changes: {
          prenotificationsSent: { before: null, after: sent },
          prenotificationsFailed: { before: null, after: failed },
          ...(firstError ? { prenotificationError: { before: null, after: firstError } } : {}),
        },
        requestId: context.requestId ?? null,
      });

      return { sent, failed, skipped, total: items.length, firstError };
    }),
};

// Suppress unused-import warning for ne / isNull -- kept for future filters.
void ne;
void isNull;
