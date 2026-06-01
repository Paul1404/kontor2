import { ORPCError } from "@orpc/server";
import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import * as v from "valibot";
import { appendAudit } from "~/server/audit/log";
import { contractsTable } from "~/server/db/schema/contracts";
import {
  dunningItemsTable,
  dunningRunsTable,
  type NewDunningItem,
  type NewDunningRun,
} from "~/server/db/schema/dunning";
import { sollStellungenTable } from "~/server/db/schema/fee-runs";
import { membersTable } from "~/server/db/schema/members";
import { organizationSettingsTable } from "~/server/db/schema/organization-settings";
import {
  isDunningBlocked,
  loadOpenPostings,
  mahngebuhrFor,
  sumDecimal,
} from "~/server/dunning/build-dunning";
import { authedProc, vorstandProc } from "~/server/orpc/base";
import { renderPdfBase64 } from "~/server/pdf/renderer";
import { MahnungDocument, type MahnungInput } from "~/server/pdf/templates/mahnung";

const Level = v.picklist([1, 2, 3] as const);

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

export const dunningRouter = {
  /**
   * Aggregate dashboard for the Forderungen page: open postings grouped by
   * member with optional Mahnstufe filter, plus a coarse summary.
   */
  open: vorstandProc
    .input(
      v.optional(
        v.object({
          mahnstufe: v.optional(v.nullable(v.pipe(v.number(), v.integer())), null),
          minDaysOverdue: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0)), 0),
        }),
        {},
      ),
    )
    .handler(async ({ context, input }) => {
      const cutoff = todayUtc();
      const postings = await loadOpenPostings(context.db, {
        cutoffDate: cutoff,
        mahnstufe: input.mahnstufe ?? undefined,
      });
      const filtered = input.minDaysOverdue
        ? postings.filter((p) => p.daysOverdueMax >= input.minDaysOverdue)
        : postings;
      const totalOpen = sumDecimal(filtered.map((p) => p.openSum));
      const totalPostings = filtered.reduce((a, p) => a + p.postings.length, 0);
      const byStufe: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
      for (const p of filtered)
        byStufe[p.currentMahnstufe] = (byStufe[p.currentMahnstufe] ?? 0) + 1;
      return {
        members: filtered,
        totals: {
          members: filtered.length,
          postings: totalPostings,
          openSum: totalOpen,
          byStufe,
        },
      };
    }),

  /**
   * Preview a Mahnlauf at a given level. Targets members whose
   * current Mahnstufe is exactly `level - 1` (1 mahnt offene, 2 mahnt
   * Erinnerung-Empfänger, usw.). Optional override list via `memberIds`.
   */
  preview: vorstandProc
    .input(
      v.object({
        level: Level,
        memberIds: v.optional(v.array(v.string()), []),
        runDate: v.optional(v.nullable(v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/))), null),
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
      const dueDate = addDays(runDate, org.mahnFristTage);

      const all = await loadOpenPostings(context.db, {
        cutoffDate: runDate,
        mahnstufe: input.level - 1,
      });

      const eligible = (
        input.memberIds && input.memberIds.length > 0
          ? all.filter((m) => input.memberIds!.includes(m.memberId))
          : all
      ).filter((m) => !isDunningBlocked(m.mahnSperre));

      const blocked = all.filter((m) => isDunningBlocked(m.mahnSperre));

      const gebuhr = mahngebuhrFor(input.level, org);

      const items = eligible.map((m) => {
        const totalDue = sumDecimal([m.openSum, gebuhr]);
        return {
          memberId: m.memberId,
          mitglnr: m.mitglnr,
          adrNr: m.adrNr,
          name:
            [m.vorname, m.nachname].filter(Boolean).join(" ") ||
            m.kurzname ||
            m.firma1 ||
            `AdrNr ${m.adrNr}`,
          eMail: m.eMailName,
          postings: m.postings,
          openSum: m.openSum,
          mahngebuhr: gebuhr,
          totalDue,
          hasAddress: !!(m.strasse && m.plz && m.ort),
        };
      });

      return {
        runDate: toDateString(runDate),
        dueDate: toDateString(dueDate),
        level: input.level,
        items,
        blocked: blocked.map((m) => ({
          memberId: m.memberId,
          mitglnr: m.mitglnr,
          adrNr: m.adrNr,
          name:
            [m.vorname, m.nachname].filter(Boolean).join(" ") ||
            m.kurzname ||
            m.firma1 ||
            `AdrNr ${m.adrNr}`,
          openSum: m.openSum,
        })),
        totals: {
          itemCount: items.length,
          openSum: sumDecimal(items.map((i) => i.openSum)),
          totalFees: sumDecimal(items.map((i) => i.mahngebuhr)),
          totalDue: sumDecimal(items.map((i) => i.totalDue)),
        },
      };
    }),

  /**
   * Commit a Mahnlauf. Creates the run header + per-Mitglied items, renders
   * PDFs, and bumps `mahnstufe` on the touched Sollstellungen.
   */
  commit: vorstandProc
    .input(
      v.object({
        level: Level,
        memberIds: v.array(v.string()),
        runDate: v.optional(v.nullable(v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/))), null),
        notes: v.optional(v.nullable(v.string()), null),
      }),
    )
    .handler(async ({ context, input }) => {
      if (input.memberIds.length === 0) {
        throw new ORPCError("BAD_REQUEST", { message: "Keine Empfänger ausgewählt." });
      }
      const [org] = await context.db.select().from(organizationSettingsTable).limit(1);
      if (!org) {
        throw new ORPCError("PRECONDITION_FAILED", {
          message: "Vereinsdaten fehlen.",
        });
      }
      const runDate = input.runDate ? new Date(`${input.runDate}T00:00:00Z`) : todayUtc();
      const dueDate = addDays(runDate, org.mahnFristTage);

      // Load eligible members once -- one query, then we render PDFs.
      const allEligible = await loadOpenPostings(context.db, {
        cutoffDate: runDate,
        mahnstufe: input.level - 1,
        memberIds: input.memberIds,
      });
      const eligible = allEligible.filter((m) => !isDunningBlocked(m.mahnSperre));
      if (eligible.length === 0) {
        throw new ORPCError("PRECONDITION_FAILED", {
          message:
            "Keine versendbaren Mahnungen (alle Empfänger sind mahngesperrt oder ohne offene Beträge).",
        });
      }

      const gebuhr = mahngebuhrFor(input.level, org);

      // Pre-fetch contract descriptions so the PDF lists "Beitrag 2024
      // (Erwachsene Aktiv)" instead of bare years.
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

      const result = await context.db.transaction(async (tx) => {
        // Header
        const [runRow] = await tx
          .insert(dunningRunsTable)
          .values({
            level: input.level,
            status: "committed",
            runDate: toDateString(runDate),
            dueDate: toDateString(dueDate),
            itemCount: eligible.length,
            totalOpen: sumDecimal(eligible.map((m) => m.openSum)),
            totalFees: sumDecimal(eligible.map(() => gebuhr)),
            notes: input.notes,
            createdBy: context.session!.user.id,
          } satisfies NewDunningRun as never)
          .returning({ id: dunningRunsTable.id });
        if (!runRow) throw new Error("dunning_runs insert returned no row");

        // Render PDFs + collect item values.
        const itemValues: NewDunningItem[] = [];
        const touchedSollIds: string[] = [];

        for (const m of eligible) {
          const postings = m.postings.map((p) => ({
            billingYear: p.billingYear,
            falligkeitsdatum: p.falligkeitsdatum,
            description: descBySoll.get(p.sollStellungId) ?? `Mitgliedsbeitrag ${p.billingYear}`,
            openAmount: p.openAmount,
            rueckgebuhr: p.rueckgebuhr,
          }));
          const totalDue = sumDecimal([m.openSum, gebuhr]);

          const pdfInput: MahnungInput = {
            level: input.level as 1 | 2 | 3,
            runDate: toDateString(runDate),
            dueDate: toDateString(dueDate),
            organization: {
              vereinsname: org.vereinsname,
              anschriftStrasse: org.anschriftStrasse,
              anschriftPlz: org.anschriftPlz,
              anschriftOrt: org.anschriftOrt,
              vereinsIbanLast4: org.vereinsIbanLast4,
              vereinsBic: org.vereinsBic,
              vereinsBankname: org.vereinsBankname,
              glaeubigerId: org.glaeubigerId,
            },
            member: {
              mitglnr: m.mitglnr,
              adrNr: m.adrNr,
              vorname: m.vorname,
              nachname: m.nachname,
              kurzname: m.kurzname,
              firma1: m.firma1,
              strasse: m.strasse,
              hausnummer: m.hausnummer,
              plz: m.plz,
              ort: m.ort,
              anrede: null,
            },
            postings,
            openSum: m.openSum,
            mahngebuhr: gebuhr,
            totalDue,
          };

          const { base64 } = await renderPdfBase64(MahnungDocument({ pkg: pdfInput }));
          const filename = `Mahnung-${m.mitglnr ?? m.adrNr}-${toDateString(runDate)}.pdf`;

          itemValues.push({
            dunningRunId: runRow.id,
            memberId: m.memberId,
            level: input.level,
            sollIdsJson: JSON.stringify(m.postings.map((p) => p.sollStellungId)),
            itemsJson: JSON.stringify(postings),
            openSum: m.openSum,
            mahngebuhr: gebuhr,
            totalDue,
            dueDate: toDateString(dueDate),
            sentChannel: "pending",
            pdfFilename: filename,
            pdfBase64: base64,
          });

          for (const sid of m.postings.map((p) => p.sollStellungId)) touchedSollIds.push(sid);
        }

        if (itemValues.length > 0) {
          await tx.insert(dunningItemsTable).values(itemValues as never);
        }

        // Bump mahnstufe in one statement -- per Sollstellung, not per member,
        // so subsequent runs at the next level pick exactly these up.
        if (touchedSollIds.length > 0) {
          await tx
            .update(sollStellungenTable)
            .set({ mahnstufe: input.level, updatedAt: new Date() })
            .where(inArray(sollStellungenTable.id, touchedSollIds));
        }

        await appendAudit(tx, {
          entityType: "dunning_run",
          entityId: runRow.id,
          action: "create",
          source: "ui",
          actorId: context.session!.user.id,
          actorEmail: context.session!.user.email,
          changes: {
            level: { before: null, after: input.level },
            itemCount: { before: null, after: eligible.length },
            totalDue: {
              before: null,
              after: sumDecimal(itemValues.map((i) => i.totalDue as string)),
            },
          },
          requestId: context.requestId ?? null,
        });

        return { runId: runRow.id, itemCount: eligible.length };
      });

      return result;
    }),

  list: authedProc
    .input(
      v.optional(
        v.object({
          page: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1)), 1),
          pageSize: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(200)), 25),
        }),
        {},
      ),
    )
    .handler(async ({ context, input }) => {
      const offset = (input.page - 1) * input.pageSize;
      const [rows, totals] = await Promise.all([
        context.db
          .select({
            id: dunningRunsTable.id,
            level: dunningRunsTable.level,
            status: dunningRunsTable.status,
            runDate: dunningRunsTable.runDate,
            dueDate: dunningRunsTable.dueDate,
            itemCount: dunningRunsTable.itemCount,
            totalOpen: dunningRunsTable.totalOpen,
            totalFees: dunningRunsTable.totalFees,
            notes: dunningRunsTable.notes,
            createdAt: dunningRunsTable.createdAt,
          })
          .from(dunningRunsTable)
          .orderBy(desc(dunningRunsTable.createdAt))
          .limit(input.pageSize)
          .offset(offset),
        context.db.select({ c: count() }).from(dunningRunsTable),
      ]);
      return { rows, total: totals[0]?.c ?? 0 };
    }),

  get: authedProc.input(v.object({ id: v.string() })).handler(async ({ context, input }) => {
    const [run] = await context.db
      .select()
      .from(dunningRunsTable)
      .where(eq(dunningRunsTable.id, input.id))
      .limit(1);
    if (!run) throw new ORPCError("NOT_FOUND", { message: "Mahnlauf nicht gefunden." });

    const items = await context.db
      .select({
        id: dunningItemsTable.id,
        memberId: dunningItemsTable.memberId,
        level: dunningItemsTable.level,
        openSum: dunningItemsTable.openSum,
        mahngebuhr: dunningItemsTable.mahngebuhr,
        totalDue: dunningItemsTable.totalDue,
        dueDate: dunningItemsTable.dueDate,
        sentChannel: dunningItemsTable.sentChannel,
        sentTo: dunningItemsTable.sentTo,
        sentAt: dunningItemsTable.sentAt,
        pdfFilename: dunningItemsTable.pdfFilename,
        memberName: sql<string>`coalesce(${membersTable.vorname} || ' ' || ${membersTable.nachname}, ${membersTable.kurzname}, ${membersTable.firma1}, 'AdrNr ' || ${membersTable.adrNr})`,
        mitglnr: membersTable.mitglnr,
        adrNr: membersTable.adrNr,
        eMail: membersTable.eMailName,
      })
      .from(dunningItemsTable)
      .innerJoin(membersTable, eq(dunningItemsTable.memberId, membersTable.id))
      .where(eq(dunningItemsTable.dunningRunId, input.id))
      .orderBy(membersTable.nachname, membersTable.vorname);
    return { run, items };
  }),

  downloadPdf: vorstandProc
    .input(v.object({ itemId: v.string() }))
    .handler(async ({ context, input }) => {
      const [row] = await context.db
        .select({
          filename: dunningItemsTable.pdfFilename,
          base64: dunningItemsTable.pdfBase64,
        })
        .from(dunningItemsTable)
        .where(eq(dunningItemsTable.id, input.itemId))
        .limit(1);
      if (!row?.base64 || !row.filename) {
        throw new ORPCError("NOT_FOUND", { message: "Keine PDF-Datei hinterlegt." });
      }
      return { filename: row.filename, base64: row.base64 };
    }),

  markSent: vorstandProc
    .input(
      v.object({
        itemId: v.string(),
        channel: v.picklist(["email", "letter"] as const),
        sentTo: v.optional(v.nullable(v.string()), null),
      }),
    )
    .handler(async ({ context, input }) => {
      await context.db.transaction(async (tx) => {
        const [updated] = await tx
          .update(dunningItemsTable)
          .set({
            sentChannel: input.channel,
            sentTo: input.sentTo,
            sentAt: new Date(),
          })
          .where(eq(dunningItemsTable.id, input.itemId))
          .returning({ id: dunningItemsTable.id, memberId: dunningItemsTable.memberId });
        if (!updated) throw new ORPCError("NOT_FOUND", { message: "Mahnung nicht gefunden." });

        await appendAudit(tx, {
          entityType: "dunning_item",
          entityId: updated.id,
          action: "update",
          source: "ui",
          actorId: context.session!.user.id,
          actorEmail: context.session!.user.email,
          changes: {
            sentChannel: { before: "pending", after: input.channel },
            sentTo: { before: null, after: input.sentTo },
          },
          requestId: context.requestId ?? null,
        });
      });

      return { ok: true };
    }),

  /**
   * Manually mark one or more Sollstellungen as paid. Used by the
   * Forderungen-Dashboard when a member pays by Überweisung or bar.
   */
  markPaid: vorstandProc
    .input(
      v.object({
        sollStellungIds: v.pipe(v.array(v.string()), v.minLength(1)),
        notes: v.optional(v.nullable(v.string()), null),
      }),
    )
    .handler(async ({ context, input }) => {
      const ids = [...new Set(input.sollStellungIds)];
      const actorId = context.session!.user.id;
      const actorEmail = context.session!.user.email;
      const requestId = context.requestId ?? null;

      const result = await context.db.transaction(async (tx) => {
        // Read the current state first so the audit log records the real
        // before-values (not a hard-coded "open") and so we skip rows that
        // are already paid instead of re-stamping them.
        const existing = await tx
          .select({
            id: sollStellungenTable.id,
            status: sollStellungenTable.status,
            amount: sollStellungenTable.amount,
            paidAmount: sollStellungenTable.paidAmount,
            openAmount: sollStellungenTable.openAmount,
            notes: sollStellungenTable.notes,
          })
          .from(sollStellungenTable)
          .where(inArray(sollStellungenTable.id, ids));

        let changed = 0;
        let skipped = 0;
        const now = new Date();

        for (const row of existing) {
          if (row.status === "paid") {
            skipped += 1;
            continue;
          }
          const nextNotes = input.notes ?? row.notes;
          await tx
            .update(sollStellungenTable)
            .set({
              status: "paid",
              paidAmount: row.amount,
              openAmount: "0",
              notes: nextNotes,
              updatedAt: now,
            })
            .where(eq(sollStellungenTable.id, row.id));

          await appendAudit(tx, {
            entityType: "soll_stellung",
            entityId: row.id,
            action: "update",
            source: "ui",
            actorId,
            actorEmail,
            changes: {
              status: { before: row.status, after: "paid" },
              paidAmount: { before: row.paidAmount, after: row.amount },
              openAmount: { before: row.openAmount, after: "0" },
              ...(input.notes != null && input.notes !== row.notes
                ? { notes: { before: row.notes, after: input.notes } }
                : {}),
            },
            requestId,
          });
          changed += 1;
        }

        return { changed, skipped };
      });

      return { count: result.changed, skipped: result.skipped };
    }),

  cancel: vorstandProc
    .input(v.object({ id: v.string(), reason: v.optional(v.nullable(v.string()), null) }))
    .handler(async ({ context, input }) => {
      const [run] = await context.db
        .select()
        .from(dunningRunsTable)
        .where(eq(dunningRunsTable.id, input.id))
        .limit(1);
      if (!run) throw new ORPCError("NOT_FOUND", { message: "Mahnlauf nicht gefunden." });
      if (run.status !== "committed") {
        throw new ORPCError("CONFLICT", {
          message: `Nur bestätigte Mahnläufe können storniert werden (aktuell: ${run.status}).`,
        });
      }

      await context.db.transaction(async (tx) => {
        await tx
          .update(dunningRunsTable)
          .set({
            status: "cancelled",
            cancelledAt: new Date(),
            cancelledBy: context.session!.user.id,
            notes: input.reason
              ? `${run.notes ? `${run.notes}\n` : ""}Storniert: ${input.reason}`
              : run.notes,
          })
          .where(eq(dunningRunsTable.id, input.id));

        // Roll the Mahnstufe back to (level - 1) on the touched Sollstellungen
        // -- but only where the current Mahnstufe is exactly `level`, so we
        // don't clobber a later run that already escalated them again.
        const items = await tx
          .select({ sollIdsJson: dunningItemsTable.sollIdsJson })
          .from(dunningItemsTable)
          .where(eq(dunningItemsTable.dunningRunId, input.id));
        const allSollIds: string[] = [];
        for (const it of items) {
          try {
            const parsed = JSON.parse(it.sollIdsJson) as string[];
            for (const s of parsed) allSollIds.push(s);
          } catch {
            // ignore — corrupted item, leave Mahnstufe untouched
          }
        }
        if (allSollIds.length > 0) {
          await tx
            .update(sollStellungenTable)
            .set({ mahnstufe: run.level - 1, updatedAt: new Date() })
            .where(
              and(
                inArray(sollStellungenTable.id, allSollIds),
                eq(sollStellungenTable.mahnstufe, run.level),
              ),
            );
        }

        await appendAudit(tx, {
          entityType: "dunning_run",
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
