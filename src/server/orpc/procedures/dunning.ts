import { ORPCError } from "@orpc/server";
import { and, count, desc, eq, inArray, lte, sql } from "drizzle-orm";
import * as v from "valibot";
import { appendAudit } from "~/server/audit/log";
import type { DB } from "~/server/db/client";
import { allocateDocRef } from "~/server/db/doc-ref";
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
import { memberRef } from "~/server/domain/member";
import {
  loadGuardianConnections,
  loadOpenPostings,
  type MemberWithDebt,
  mahngebuhrFor,
  planNichtEingezogen,
  resolveRecipient,
  resolveRecipients,
  restrictToDunnable,
  sumDecimal,
} from "~/server/dunning/build-dunning";
import {
  buildDunningEmail,
  type DunningEmailContent,
  sendDunningEmail,
} from "~/server/dunning/send-dunning-email";
import { adminProc, authedProc, vorstandProc } from "~/server/orpc/base";
import { clubLogoDataUri } from "~/server/pdf/logo";
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

/**
 * Load everything needed to send (or preview) the dunning email for one item:
 * the item, its member, and the club name. Throws if the item is missing or
 * the club data is not yet set up.
 */
async function loadDunningEmailContext(db: DB, itemId: string) {
  const [row] = await db
    .select({
      itemId: dunningItemsTable.id,
      level: dunningItemsTable.level,
      totalDue: dunningItemsTable.totalDue,
      dueDate: dunningItemsTable.dueDate,
      sentChannel: dunningItemsTable.sentChannel,
      pdfBase64: dunningItemsTable.pdfBase64,
      pdfFilename: dunningItemsTable.pdfFilename,
      runDate: dunningRunsTable.runDate,
      memberId: membersTable.id,
      memberNo: membersTable.memberNo,
      kontaktNo: membersTable.kontaktNo,
      mitgliedsnummer: membersTable.mitgliedsnummer,
      adrNr: membersTable.adrNr,
      vorname: membersTable.vorname,
      nachname: membersTable.nachname,
      kurzname: membersTable.kurzname,
      firma1: membersTable.firma1,
      anrede: membersTable.anrede,
      strasse: membersTable.strasse,
      hausnummer: membersTable.hausnummer,
      plz: membersTable.plz,
      ort: membersTable.ort,
      email: membersTable.email,
      dunningBlocked: membersTable.dunningBlocked,
      geburtsdatum: membersTable.geburtsdatum,
      vertreterAnrede: membersTable.vertreterAnrede,
      vertreterName: membersTable.vertreterName,
      vertreterStrasse: membersTable.vertreterStrasse,
      vertreterHausnummer: membersTable.vertreterHausnummer,
      vertreterPlz: membersTable.vertreterPlz,
      vertreterOrt: membersTable.vertreterOrt,
    })
    .from(dunningItemsTable)
    .innerJoin(dunningRunsTable, eq(dunningItemsTable.dunningRunId, dunningRunsTable.id))
    .innerJoin(membersTable, eq(dunningItemsTable.memberId, membersTable.id))
    .where(eq(dunningItemsTable.id, itemId))
    .limit(1);
  if (!row) throw new ORPCError("NOT_FOUND", { message: "Mahnung nicht gefunden." });

  const [org] = await db
    .select({ vereinsname: organizationSettingsTable.vereinsname })
    .from(organizationSettingsTable)
    .limit(1);
  if (!org) throw new ORPCError("PRECONDITION_FAILED", { message: "Vereinsdaten fehlen." });

  // Resolve who the Mahnung is addressed to (member or guardian) as of the run
  // date, so a minor's mail goes to the guardian's address, mirroring the PDF.
  const member: MemberWithDebt = {
    memberId: row.memberId,
    memberNo: row.memberNo,
    kontaktNo: row.kontaktNo,
    mitgliedsnummer: row.mitgliedsnummer,
    adrNr: row.adrNr,
    vorname: row.vorname,
    nachname: row.nachname,
    kurzname: row.kurzname,
    firma1: row.firma1,
    anrede: row.anrede,
    strasse: row.strasse,
    hausnummer: row.hausnummer,
    plz: row.plz,
    ort: row.ort,
    email: row.email,
    dunningBlocked: row.dunningBlocked,
    geburtsdatum: row.geburtsdatum,
    vertreterAnrede: row.vertreterAnrede,
    vertreterName: row.vertreterName,
    vertreterStrasse: row.vertreterStrasse,
    vertreterHausnummer: row.vertreterHausnummer,
    vertreterPlz: row.vertreterPlz,
    vertreterOrt: row.vertreterOrt,
    currentMahnstufe: 0,
    postings: [],
    openSum: "0",
    daysOverdueMax: 0,
  };
  const asOf = row.runDate ? new Date(`${row.runDate}T00:00:00Z`) : new Date();
  const guardians = await loadGuardianConnections(db, [row.memberId]);
  const resolved = resolveRecipient(member, guardians.get(row.memberId) ?? null, asOf);

  const mitgliedsnummer = memberRef(row);
  const to = resolved.recipientEmail ?? "";

  const content: DunningEmailContent | null = to
    ? buildDunningEmail({
        level: row.level as 1 | 2 | 3,
        to,
        recipientName: resolved.recipient.name,
        vereinsname: org.vereinsname,
        mitgliedsnummer,
        totalDue: row.totalDue,
        dueDate: row.dueDate,
        attachmentName: row.pdfFilename ?? `Mahnung-${mitgliedsnummer}.pdf`,
      })
    : null;

  return { row, content, hasEmail: !!to, addressedToGuardian: resolved.guardianSource !== null };
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
      ).filter((m) => !m.dunningBlocked);

      const blocked = all.filter((m) => m.dunningBlocked);

      const gebuhr = mahngebuhrFor(input.level, org);
      const recipients = await resolveRecipients(context.db, eligible, runDate);

      const items = eligible.map((m) => {
        const totalDue = sumDecimal([m.openSum, gebuhr]);
        const resolved = recipients.get(m.memberId);
        return {
          memberId: m.memberId,
          memberNo: m.memberNo,
          kontaktNo: m.kontaktNo,
          mitgliedsnummer: m.mitgliedsnummer,
          adrNr: m.adrNr,
          name:
            [m.vorname, m.nachname].filter(Boolean).join(" ") ||
            m.kurzname ||
            m.firma1 ||
            `AdrNr ${m.adrNr}`,
          eMail: m.email,
          postings: m.postings,
          openSum: m.openSum,
          mahngebuhr: gebuhr,
          totalDue,
          hasAddress: !!(m.strasse && m.plz && m.ort),
          // Addressee + minor handling, so the preview can flag a minor that
          // would be dunned directly without a guardian.
          recipientName: resolved?.recipient.name ?? null,
          isMinor: resolved?.isMinor ?? false,
          guardianSource: resolved?.guardianSource ?? null,
          minorWithoutGuardian: resolved?.minorWithoutGuardian ?? false,
        };
      });

      return {
        runDate: toDateString(runDate),
        dueDate: toDateString(dueDate),
        level: input.level,
        items,
        blocked: blocked.map((m) => ({
          memberId: m.memberId,
          memberNo: m.memberNo,
          kontaktNo: m.kontaktNo,
          mitgliedsnummer: m.mitgliedsnummer,
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
          minorsWithoutGuardian: items.filter((i) => i.minorWithoutGuardian).length,
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
      const eligible = allEligible.filter((m) => !m.dunningBlocked);
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

      // Resolve the addressee (member or guardian) per member, and read the
      // club logo once for the whole run.
      const recipients = await resolveRecipients(context.db, eligible, runDate);
      const logoDataUri = clubLogoDataUri();

      const result = await context.db.transaction(async (tx) => {
        // Serialize commits at the same level. Eligibility (and the PDFs
        // below) were computed before this transaction; without the lock two
        // operators committing the same level at once would both render and
        // bump the same postings, producing duplicate Mahnungen and double
        // Mahngebühr. The advisory xact lock blocks the second commit until the
        // first finishes and releases at COMMIT/ROLLBACK.
        await tx.execute(sql`select pg_advisory_xact_lock(4712, ${input.level})`);

        // Re-verify inside the lock: keep only postings still at level-1. A run
        // that committed first has already bumped its postings, so they drop
        // out here and are not dunned a second time.
        const candidateSollIds = eligible.flatMap((m) => m.postings.map((p) => p.sollStellungId));
        const stillRows =
          candidateSollIds.length > 0
            ? await tx
                .select({ id: sollStellungenTable.id })
                .from(sollStellungenTable)
                .where(
                  and(
                    inArray(sollStellungenTable.id, candidateSollIds),
                    eq(sollStellungenTable.mahnstufe, input.level - 1),
                  ),
                )
            : [];
        const stillEligible = new Set(stillRows.map((r) => r.id));
        const verified = restrictToDunnable(eligible, stillEligible);
        if (verified.length === 0) {
          throw new ORPCError("CONFLICT", {
            message:
              "Diese Mahnungen wurden zwischenzeitlich bereits in einem anderen Lauf erzeugt. Bitte Liste neu laden.",
          });
        }

        // Header
        const [runRow] = await tx
          .insert(dunningRunsTable)
          .values({
            level: input.level,
            status: "committed",
            runDate: toDateString(runDate),
            dueDate: toDateString(dueDate),
            itemCount: verified.length,
            totalOpen: sumDecimal(verified.map((m) => m.openSum)),
            totalFees: sumDecimal(verified.map(() => gebuhr)),
            notes: input.notes,
            createdBy: context.session!.user.id,
          } satisfies NewDunningRun as never)
          .returning({ id: dunningRunsTable.id });
        if (!runRow) throw new Error("dunning_runs insert returned no row");

        // Render PDFs + collect item values.
        const itemValues: NewDunningItem[] = [];
        const touchedSollIds: string[] = [];
        const refYear = Number(toDateString(runDate).slice(0, 4));

        for (const m of verified) {
          const postings = m.postings.map((p) => ({
            billingYear: p.billingYear,
            falligkeitsdatum: p.falligkeitsdatum,
            description: descBySoll.get(p.sollStellungId) ?? `Mitgliedsbeitrag ${p.billingYear}`,
            openAmount: p.openAmount,
            rueckgebuhr: p.rueckgebuhr,
          }));
          const totalDue = sumDecimal([m.openSum, gebuhr]);
          const resolved = recipients.get(m.memberId);
          const recipient = resolved?.recipient ?? {
            anrede: m.anrede,
            name:
              [m.vorname, m.nachname].filter(Boolean).join(" ") ||
              m.kurzname ||
              m.firma1 ||
              `AdrNr ${m.adrNr}`,
            strasse: m.strasse,
            hausnummer: m.hausnummer,
            plz: m.plz,
            ort: m.ort,
          };

          const pdfInput: MahnungInput = {
            level: input.level as 1 | 2 | 3,
            runDate: toDateString(runDate),
            dueDate: toDateString(dueDate),
            organization: {
              vereinsname: org.vereinsname,
              anschriftStrasse: org.anschriftStrasse,
              anschriftPlz: org.anschriftPlz,
              anschriftOrt: org.anschriftOrt,
              vereinsIban: org.vereinsIban,
              vereinsBic: org.vereinsBic,
              vereinsBankname: org.vereinsBankname,
              glaeubigerId: org.glaeubigerId,
              logoDataUri,
            },
            member: {
              memberNo: m.memberNo,
              kontaktNo: m.kontaktNo,
              mitgliedsnummer: m.mitgliedsnummer,
              adrNr: m.adrNr,
              vorname: m.vorname,
              nachname: m.nachname,
              kurzname: m.kurzname,
              firma1: m.firma1,
            },
            recipient: {
              anrede: recipient.anrede,
              name: recipient.name,
              strasse: recipient.strasse,
              hausnummer: recipient.hausnummer,
              plz: recipient.plz,
              ort: recipient.ort,
              vertretungFor: resolved?.vertretungFor ?? null,
            },
            postings,
            openSum: m.openSum,
            mahngebuhr: gebuhr,
            totalDue,
          };

          const docRef = await allocateDocRef(tx, "MA", refYear);
          const { base64 } = await renderPdfBase64(MahnungDocument({ pkg: pdfInput, docRef }));
          const filename = `Mahnung-${docRef}-${memberRef(m)}.pdf`;

          itemValues.push({
            dunningRunId: runRow.id,
            memberId: m.memberId,
            level: input.level,
            docRef,
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
            itemCount: { before: null, after: verified.length },
            totalDue: {
              before: null,
              after: sumDecimal(itemValues.map((i) => i.totalDue as string)),
            },
          },
          requestId: context.requestId ?? null,
        });

        return { runId: runRow.id, itemCount: verified.length };
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

    const rows = await context.db
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
        memberNo: membersTable.memberNo,
        kontaktNo: membersTable.kontaktNo,
        mitgliedsnummer: membersTable.mitgliedsnummer,
        adrNr: membersTable.adrNr,
        eMail: membersTable.email,
        // Extra columns so we can resolve who the Mahnung is addressed to and
        // surface the effective email (guardian's, for minors) to the UI.
        vorname: membersTable.vorname,
        nachname: membersTable.nachname,
        kurzname: membersTable.kurzname,
        firma1: membersTable.firma1,
        anrede: membersTable.anrede,
        strasse: membersTable.strasse,
        hausnummer: membersTable.hausnummer,
        plz: membersTable.plz,
        ort: membersTable.ort,
        geburtsdatum: membersTable.geburtsdatum,
        vertreterAnrede: membersTable.vertreterAnrede,
        vertreterName: membersTable.vertreterName,
        vertreterStrasse: membersTable.vertreterStrasse,
        vertreterHausnummer: membersTable.vertreterHausnummer,
        vertreterPlz: membersTable.vertreterPlz,
        vertreterOrt: membersTable.vertreterOrt,
      })
      .from(dunningItemsTable)
      .innerJoin(membersTable, eq(dunningItemsTable.memberId, membersTable.id))
      .where(eq(dunningItemsTable.dunningRunId, input.id))
      .orderBy(membersTable.nachname, membersTable.vorname);

    const asOf = run.runDate ? new Date(`${run.runDate}T00:00:00Z`) : new Date();
    const guardians = await loadGuardianConnections(
      context.db,
      rows.map((r) => r.memberId),
    );
    const items = rows.map((r) => {
      const member: MemberWithDebt = {
        memberId: r.memberId,
        memberNo: r.memberNo,
        kontaktNo: r.kontaktNo,
        mitgliedsnummer: r.mitgliedsnummer,
        adrNr: r.adrNr,
        vorname: r.vorname,
        nachname: r.nachname,
        kurzname: r.kurzname,
        firma1: r.firma1,
        anrede: r.anrede,
        strasse: r.strasse,
        hausnummer: r.hausnummer,
        plz: r.plz,
        ort: r.ort,
        email: r.eMail,
        dunningBlocked: false,
        geburtsdatum: r.geburtsdatum,
        vertreterAnrede: r.vertreterAnrede,
        vertreterName: r.vertreterName,
        vertreterStrasse: r.vertreterStrasse,
        vertreterHausnummer: r.vertreterHausnummer,
        vertreterPlz: r.vertreterPlz,
        vertreterOrt: r.vertreterOrt,
        currentMahnstufe: 0,
        postings: [],
        openSum: "0",
        daysOverdueMax: 0,
      };
      const resolved = resolveRecipient(member, guardians.get(r.memberId) ?? null, asOf);
      return {
        id: r.id,
        memberId: r.memberId,
        level: r.level,
        openSum: r.openSum,
        mahngebuhr: r.mahngebuhr,
        totalDue: r.totalDue,
        dueDate: r.dueDate,
        sentChannel: r.sentChannel,
        sentTo: r.sentTo,
        sentAt: r.sentAt,
        pdfFilename: r.pdfFilename,
        memberName: r.memberName,
        memberNo: r.memberNo,
        kontaktNo: r.kontaktNo,
        mitgliedsnummer: r.mitgliedsnummer,
        adrNr: r.adrNr,
        eMail: r.eMail,
        recipientEmail: resolved.recipientEmail,
        addressedToGuardian: resolved.guardianSource !== null,
      };
    });
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
   * Preview the exact email that `sendEmail` would dispatch for one item,
   * without sending anything. Lets the Vorstand read the recipient, subject
   * and body before committing to the send.
   */
  emailPreview: vorstandProc
    .input(v.object({ itemId: v.string() }))
    .handler(async ({ context, input }) => {
      const { content, hasEmail, row, addressedToGuardian } = await loadDunningEmailContext(
        context.db,
        input.itemId,
      );
      return {
        hasEmail,
        addressedToGuardian,
        alreadySent: row.sentChannel !== "pending",
        to: content?.to ?? null,
        subject: content?.subject ?? null,
        body: content?.body ?? null,
        attachmentName: content?.attachmentName ?? row.pdfFilename ?? null,
      };
    }),

  /**
   * Send the dunning email for one item with the rendered PDF attached, then
   * mark the item as sent via email. Surfaces SMTP failures as an error so the
   * UI can show what went wrong instead of silently marking it sent.
   */
  sendEmail: vorstandProc
    .input(v.object({ itemId: v.string() }))
    .handler(async ({ context, input }) => {
      const { content, hasEmail, row } = await loadDunningEmailContext(context.db, input.itemId);
      if (!hasEmail || !content) {
        throw new ORPCError("PRECONDITION_FAILED", {
          message: "Für dieses Mitglied ist keine E-Mail-Adresse hinterlegt.",
        });
      }
      if (!row.pdfBase64) {
        throw new ORPCError("PRECONDITION_FAILED", { message: "Keine PDF-Datei hinterlegt." });
      }

      const sent = await sendDunningEmail({ content, pdfBase64: row.pdfBase64 });
      if (!sent.ok) {
        const message =
          sent.reason === "smtp_not_configured"
            ? "SMTP ist nicht konfiguriert. Bitte unter Einstellungen > E-Mail einrichten."
            : `E-Mail-Versand fehlgeschlagen: ${sent.reason}`;
        throw new ORPCError("INTERNAL_SERVER_ERROR", { message });
      }

      await context.db.transaction(async (tx) => {
        await tx
          .update(dunningItemsTable)
          .set({ sentChannel: "email", sentTo: content.to, sentAt: new Date() })
          .where(eq(dunningItemsTable.id, input.itemId));

        await appendAudit(tx, {
          entityType: "dunning_item",
          entityId: input.itemId,
          action: "update",
          source: "ui",
          actorId: context.session!.user.id,
          actorEmail: context.session!.user.email,
          changes: {
            sentChannel: { before: row.sentChannel, after: "email" },
            sentTo: { before: null, after: content.to },
          },
          requestId: context.requestId ?? null,
        });
      });

      return { ok: true, to: content.to };
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
          // A cancelled posting is void; flipping it to paid would resurrect a
          // settled debt as a booked payment. Only dunnable/already-collected
          // postings can be marked paid.
          if (row.status === "paid" || row.status === "cancelled") {
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

  /**
   * Manually flag Sollstellungen that were booked as `eingezogen` (SEPA
   * direct debit presumed collected) as *not* collected, so they reappear
   * in the Forderungen-/Mahnwesen. Reverses the eingezogen assumption when
   * the Vorstand knows a debit did not actually clear but no formal
   * Rücklastschrift (camt.054) is on hand: status -> open, paidAmount -> 0,
   * openAmount -> full amount, Mahnstufe reset to 0.
   *
   * Only touches `eingezogen` rows; anything already open/returned/paid/
   * cancelled is skipped so a settled or already-dunnable posting is never
   * resurrected or double-counted.
   */
  markNichtEingezogen: vorstandProc
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
        // Read current state first so the audit log records real
        // before-values and so we skip rows that are not `eingezogen`
        // instead of clobbering them.
        const existing = await tx
          .select({
            id: sollStellungenTable.id,
            status: sollStellungenTable.status,
            amount: sollStellungenTable.amount,
            paidAmount: sollStellungenTable.paidAmount,
            openAmount: sollStellungenTable.openAmount,
            mahnstufe: sollStellungenTable.mahnstufe,
            notes: sollStellungenTable.notes,
          })
          .from(sollStellungenTable)
          .where(inArray(sollStellungenTable.id, ids));

        let changed = 0;
        let skipped = 0;
        const now = new Date();

        for (const row of existing) {
          // Only an `eingezogen` posting can be turned back into an open
          // claim here. Everything else is already in a sane state.
          const plan = planNichtEingezogen(row);
          if (!plan) {
            skipped += 1;
            continue;
          }
          const nextNotes = input.notes ?? row.notes;
          await tx
            .update(sollStellungenTable)
            .set({
              status: plan.status,
              paidAmount: plan.paidAmount,
              openAmount: plan.openAmount,
              mahnstufe: plan.mahnstufe,
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
              status: { before: row.status, after: plan.status },
              paidAmount: { before: row.paidAmount, after: plan.paidAmount },
              openAmount: { before: row.openAmount, after: plan.openAmount },
              ...(row.mahnstufe !== plan.mahnstufe
                ? { mahnstufe: { before: String(row.mahnstufe), after: String(plan.mahnstufe) } }
                : {}),
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

  /**
   * One-off reconciliation for the legacy backlog: postings imported from
   * Linear (and any pre-fix app run) sit at `status = "open"` even though the
   * direct debit was collected years ago, so the Mahnwesen treats them as
   * debt. This previews how many `open` direct-debit postings up to and
   * including `throughYear` would be marked `eingezogen`.
   *
   * Only postings whose contract pays by direct debit are touched (the
   * `contracts.is_direct_debit` flag, normalized at import time from Linear's
   * blank-means-direct-debit `lastschrift`). Invoice payers stay `open`,
   * because for them a missing payment really is unknown.
   */
  settleHistoricalPreview: adminProc
    .input(
      v.object({
        throughYear: v.pipe(v.number(), v.integer(), v.minValue(2000), v.maxValue(2100)),
      }),
    )
    .handler(async ({ context, input }) => {
      const rows = await context.db
        .select({
          billingYear: sollStellungenTable.billingYear,
          openAmount: sollStellungenTable.openAmount,
        })
        .from(sollStellungenTable)
        .innerJoin(contractsTable, eq(sollStellungenTable.contractId, contractsTable.id))
        .where(
          and(
            eq(sollStellungenTable.status, "open"),
            lte(sollStellungenTable.billingYear, input.throughYear),
            sql`${sollStellungenTable.openAmount}::numeric > 0`,
            eq(contractsTable.isDirectDebit, true),
          ),
        );

      const byYear = new Map<number, { count: number; cents: number }>();
      let cents = 0;
      for (const r of rows) {
        const c = Math.round(Number.parseFloat(r.openAmount) * 100);
        cents += c;
        const e = byYear.get(r.billingYear) ?? { count: 0, cents: 0 };
        e.count += 1;
        e.cents += c;
        byYear.set(r.billingYear, e);
      }

      return {
        count: rows.length,
        openSum: (cents / 100).toFixed(2),
        byYear: [...byYear.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([year, v]) => ({ year, count: v.count, openSum: (v.cents / 100).toFixed(2) })),
      };
    }),

  /**
   * Commit the legacy reconciliation previewed by `settleHistoricalPreview`.
   * `expectedCount` guards against the set changing between preview and
   * commit. Writes a single summary audit entry rather than one per posting.
   */
  settleHistorical: adminProc
    .input(
      v.object({
        throughYear: v.pipe(v.number(), v.integer(), v.minValue(2000), v.maxValue(2100)),
        expectedCount: v.pipe(v.number(), v.integer(), v.minValue(0)),
      }),
    )
    .handler(async ({ context, input }) => {
      const result = await context.db.transaction(async (tx) => {
        const matching = await tx
          .select({ id: sollStellungenTable.id, amount: sollStellungenTable.amount })
          .from(sollStellungenTable)
          .innerJoin(contractsTable, eq(sollStellungenTable.contractId, contractsTable.id))
          .where(
            and(
              eq(sollStellungenTable.status, "open"),
              lte(sollStellungenTable.billingYear, input.throughYear),
              sql`${sollStellungenTable.openAmount}::numeric > 0`,
              eq(contractsTable.isDirectDebit, true),
            ),
          );

        if (matching.length !== input.expectedCount) {
          throw new ORPCError("CONFLICT", {
            message: `Daten haben sich geändert seit der Vorschau (jetzt ${matching.length} Posten). Bitte erneut prüfen.`,
          });
        }
        if (matching.length === 0) return { count: 0 };

        const ids = matching.map((m) => m.id);
        let centsSettled = 0;
        for (const m of matching) centsSettled += Math.round(Number.parseFloat(m.amount) * 100);

        await tx
          .update(sollStellungenTable)
          .set({
            status: "eingezogen",
            paidAmount: sql`${sollStellungenTable.amount}`,
            openAmount: "0",
            updatedAt: new Date(),
          })
          .where(inArray(sollStellungenTable.id, ids));

        await appendAudit(tx, {
          entityType: "soll_stellung",
          entityId: `historical-settle-through-${input.throughYear}`,
          action: "update",
          source: "ui",
          actorId: context.session!.user.id,
          actorEmail: context.session!.user.email,
          changes: {
            status: { before: "open", after: "eingezogen" },
            throughYear: { before: null, after: input.throughYear },
            count: { before: null, after: matching.length },
            settledSum: { before: null, after: (centsSettled / 100).toFixed(2) },
          },
          requestId: context.requestId ?? null,
        });

        return { count: matching.length };
      });

      return result;
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
