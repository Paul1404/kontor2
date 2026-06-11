import { ORPCError } from "@orpc/server";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import * as v from "valibot";
import { appendAudit } from "~/server/audit/log";
import type { DB } from "~/server/db/client";
import { familienMitgliederTable, familienTable } from "~/server/db/schema/familien";
import { membersTable } from "~/server/db/schema/members";
import { familienNameVorschlag, rolleVorschlag } from "~/server/domain/familie";
import { memberDisplayName, memberRef } from "~/server/domain/member";
import { authedProc, vorstandProc } from "~/server/orpc/base";

const RolleInput = v.picklist(["zahler", "partner", "kind"]);

type MemberLite = {
  id: string;
  memberNo: string | null;
  kontaktNo: string | null;
  mitgliedsnummer: string | null;
  vorname: string | null;
  nachname: string | null;
  geburtsdatum: Date | null;
};

function toRef(m: MemberLite) {
  return {
    id: m.id,
    reference: memberRef(m),
    name: memberDisplayName(m as never),
    geburtsdatum: m.geburtsdatum,
  };
}

const memberLiteColumns = {
  id: membersTable.id,
  memberNo: membersTable.memberNo,
  kontaktNo: membersTable.kontaktNo,
  mitgliedsnummer: membersTable.mitgliedsnummer,
  vorname: membersTable.vorname,
  nachname: membersTable.nachname,
  geburtsdatum: membersTable.geburtsdatum,
};

/** Load one family with its active members; null when the id is unknown. */
async function loadFamilie(db: DB, familieId: string) {
  const [fam] = await db
    .select()
    .from(familienTable)
    .where(eq(familienTable.id, familieId))
    .limit(1);
  if (!fam) return null;
  const rows = await db
    .select({
      mitgliedschaftId: familienMitgliederTable.id,
      rolle: familienMitgliederTable.rolle,
      von: familienMitgliederTable.von,
      bis: familienMitgliederTable.bis,
      ...memberLiteColumns,
    })
    .from(familienMitgliederTable)
    .innerJoin(membersTable, eq(membersTable.id, familienMitgliederTable.memberId))
    .where(eq(familienMitgliederTable.familieId, familieId))
    .orderBy(
      sql`case ${familienMitgliederTable.rolle} when 'zahler' then 0 when 'partner' then 1 else 2 end`,
    );
  return {
    id: fam.id,
    name: fam.name,
    notiz: fam.notiz,
    zahlerMemberId: fam.zahlerMemberId,
    mitglieder: rows.map((r) => ({
      mitgliedschaftId: r.mitgliedschaftId,
      rolle: r.rolle,
      von: r.von,
      bis: r.bis,
      aktiv: r.bis == null,
      ...toRef(r),
    })),
  };
}

export const familienRouter = {
  /** Die aktive Familie eines Mitglieds für die Karte auf der Detailseite. */
  forMember: authedProc
    .input(v.object({ memberId: v.string() }))
    .handler(async ({ context, input }) => {
      const [link] = await context.db
        .select({ familieId: familienMitgliederTable.familieId })
        .from(familienMitgliederTable)
        .where(
          and(
            eq(familienMitgliederTable.memberId, input.memberId),
            isNull(familienMitgliederTable.bis),
          ),
        )
        .limit(1);
      if (!link) return null;
      return await loadFamilie(context.db, link.familieId);
    }),

  /** Alle Familien mit Zahler und Mitgliederzahl für die Übersichtsseite. */
  list: vorstandProc.input(v.void()).handler(async ({ context }) => {
    const rows = (await context.db.execute(sql`
      select f.id, f.name, f.notiz, f.zahler_member_id,
             z.nachname as zahler_nachname, z.vorname as zahler_vorname,
             z.member_no as zahler_member_no, z.kontakt_no as zahler_kontakt_no,
             z.mitgliedsnummer as zahler_mitgliedsnummer,
             count(fm.id) filter (where fm.bis is null) as aktive_mitglieder
      from familien f
      left join members z on z.id = f.zahler_member_id
      left join familien_mitglieder fm on fm.familie_id = f.id
      group by f.id, f.name, f.notiz, f.zahler_member_id, z.nachname, z.vorname,
               z.member_no, z.kontakt_no, z.mitgliedsnummer
      order by f.name
    `)) as unknown as Array<{
      id: string;
      name: string;
      notiz: string | null;
      zahler_member_id: string | null;
      zahler_nachname: string | null;
      zahler_vorname: string | null;
      zahler_member_no: string | null;
      zahler_kontakt_no: string | null;
      zahler_mitgliedsnummer: string | null;
      aktive_mitglieder: number;
    }>;
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      notiz: r.notiz,
      zahler:
        r.zahler_member_id == null
          ? null
          : {
              id: r.zahler_member_id,
              name: [r.zahler_nachname, r.zahler_vorname].filter(Boolean).join(", "),
              reference:
                r.zahler_member_no ?? r.zahler_kontakt_no ?? r.zahler_mitgliedsnummer ?? "",
            },
      aktiveMitglieder: Number(r.aktive_mitglieder),
    }));
  }),

  get: vorstandProc.input(v.object({ id: v.string() })).handler(async ({ context, input }) => {
    const fam = await loadFamilie(context.db, input.id);
    if (!fam) throw new ORPCError("NOT_FOUND", { message: "Familie nicht gefunden." });
    return fam;
  }),

  /**
   * Seed-Assistent: schlägt Familien aus den Bestandsdaten vor. Anker ist
   * jedes lebende Mitglied mit laufendem Familienbeitrag (Beitragsart per
   * Bezeichnung erkannt), das noch keiner aktiven Familie angehört.
   * Kandidaten sind lebende, familienlose Mitglieder, die per Verknüpfung
   * verbunden sind oder an derselben Adresse wohnen. Nichts wird automatisch
   * übernommen; der Vorstand bestätigt jede Gruppe einzeln.
   */
  proposals: vorstandProc.input(v.void()).handler(async ({ context }) => {
    const rows = (await context.db.execute(sql`
      with familien_arten as (
        select art from fee_types where bezeichnung ilike '%famil%'
      ),
      in_familie as (
        select member_id from familien_mitglieder where bis is null
      ),
      lebend as (
        select m.* from members m
        where m.deleted_at is null
          and (m.austritt is null or m.austritt::date > current_date)
          and (m.verstorben_am is null or m.verstorben_am::date > current_date)
      ),
      anker as (
        select distinct l.*
        from lebend l
        join contracts c on c.member_id = l.id
          and c.art in (select art from familien_arten)
          and (c.vertrag_ende is null or c.vertrag_ende > now())
        where l.id not in (select member_id from in_familie)
      )
      select a.id as anker_id, a.nachname as anker_nachname, a.vorname as anker_vorname,
             a.member_no as anker_member_no, a.kontakt_no as anker_kontakt_no,
             a.mitgliedsnummer as anker_mitgliedsnummer, a.geburtsdatum as anker_geburtsdatum,
             k.id, k.nachname, k.vorname, k.member_no, k.kontakt_no, k.mitgliedsnummer,
             k.geburtsdatum,
             (k.strasse is not null and btrim(k.strasse) <> ''
              and k.strasse = a.strasse and k.plz = a.plz) as gleiche_adresse,
             exists (
               select 1 from relationships r
               where (r.from_member_id = a.id and r.to_member_id = k.id)
                  or (r.from_member_id = k.id and r.to_member_id = a.id)
             ) as verknuepft
      from anker a
      join lebend k on k.id <> a.id
        and k.id not in (select member_id from in_familie)
        and (
          (k.strasse is not null and btrim(k.strasse) <> ''
           and k.strasse = a.strasse and k.plz = a.plz)
          or exists (
            select 1 from relationships r
            where (r.from_member_id = a.id and r.to_member_id = k.id)
               or (r.from_member_id = k.id and r.to_member_id = a.id)
          )
        )
      order by a.nachname, a.vorname, k.geburtsdatum nulls last
    `)) as unknown as Array<{
      anker_id: string;
      anker_nachname: string | null;
      anker_vorname: string | null;
      anker_member_no: string | null;
      anker_kontakt_no: string | null;
      anker_mitgliedsnummer: string | null;
      anker_geburtsdatum: Date | null;
      id: string;
      nachname: string | null;
      vorname: string | null;
      member_no: string | null;
      kontakt_no: string | null;
      mitgliedsnummer: string | null;
      geburtsdatum: Date | null;
      gleiche_adresse: boolean;
      verknuepft: boolean;
    }>;

    type Proposal = {
      zahler: ReturnType<typeof toRef>;
      suggestedName: string;
      kandidaten: Array<
        ReturnType<typeof toRef> & {
          rolle: "partner" | "kind";
          gleicheAdresse: boolean;
          verknuepft: boolean;
        }
      >;
    };
    const map = new Map<string, Proposal>();
    for (const r of rows) {
      let entry = map.get(r.anker_id);
      if (!entry) {
        entry = {
          zahler: toRef({
            id: r.anker_id,
            memberNo: r.anker_member_no,
            kontaktNo: r.anker_kontakt_no,
            mitgliedsnummer: r.anker_mitgliedsnummer,
            vorname: r.anker_vorname,
            nachname: r.anker_nachname,
            geburtsdatum: r.anker_geburtsdatum,
          }),
          suggestedName: familienNameVorschlag(r.anker_nachname),
          kandidaten: [],
        };
        map.set(r.anker_id, entry);
      }
      entry.kandidaten.push({
        ...toRef({
          id: r.id,
          memberNo: r.member_no,
          kontaktNo: r.kontakt_no,
          mitgliedsnummer: r.mitgliedsnummer,
          vorname: r.vorname,
          nachname: r.nachname,
          geburtsdatum: r.geburtsdatum,
        }),
        rolle: rolleVorschlag(r.geburtsdatum),
        gleicheAdresse: r.gleiche_adresse,
        verknuepft: r.verknuepft,
      });
    }
    return [...map.values()];
  }),

  create: vorstandProc
    .input(
      v.object({
        name: v.pipe(v.string(), v.minLength(1)),
        zahlerMemberId: v.string(),
        notiz: v.optional(v.nullable(v.string())),
        mitglieder: v.pipe(
          v.array(v.object({ memberId: v.string(), rolle: RolleInput })),
          v.minLength(1),
        ),
      }),
    )
    .handler(async ({ context, input }) => {
      const memberIds = input.mitglieder.map((m) => m.memberId);
      if (new Set(memberIds).size !== memberIds.length) {
        throw new ORPCError("VALIDATION_FAILED", {
          message: "Ein Mitglied kann nur einmal in der Familie stehen.",
        });
      }
      if (!memberIds.includes(input.zahlerMemberId)) {
        throw new ORPCError("VALIDATION_FAILED", {
          message: "Der Zahler muss selbst Teil der Familie sein.",
        });
      }
      const zahlerRollen = input.mitglieder.filter((m) => m.rolle === "zahler");
      if (zahlerRollen.length !== 1 || zahlerRollen[0]!.memberId !== input.zahlerMemberId) {
        throw new ORPCError("VALIDATION_FAILED", {
          message: "Genau ein Mitglied muss die Rolle Zahler haben, und zwar der Zahler selbst.",
        });
      }

      // Sprechende Fehlermeldung statt nacktem Unique-Verstoß, wenn jemand
      // schon einer aktiven Familie angehört.
      const belegt = await context.db
        .select({
          memberId: familienMitgliederTable.memberId,
          familieId: familienMitgliederTable.familieId,
        })
        .from(familienMitgliederTable)
        .where(
          and(
            inArray(familienMitgliederTable.memberId, memberIds),
            isNull(familienMitgliederTable.bis),
          ),
        );
      if (belegt.length > 0) {
        const namen = await context.db
          .select(memberLiteColumns)
          .from(membersTable)
          .where(
            inArray(
              membersTable.id,
              belegt.map((b) => b.memberId),
            ),
          );
        throw new ORPCError("CONFLICT", {
          message: `Bereits in einer Familie: ${namen.map((n) => memberDisplayName(n as never)).join(", ")}. Erst dort austragen.`,
        });
      }

      return await context.db.transaction(async (tx) => {
        const [fam] = await tx
          .insert(familienTable)
          .values({
            name: input.name.trim(),
            zahlerMemberId: input.zahlerMemberId,
            notiz: input.notiz ?? null,
          })
          .returning({ id: familienTable.id });
        await tx.insert(familienMitgliederTable).values(
          input.mitglieder.map((m) => ({
            familieId: fam!.id,
            memberId: m.memberId,
            rolle: m.rolle,
          })),
        );
        await appendAudit(tx, {
          entityType: "familie",
          entityId: fam!.id,
          action: "create",
          source: "ui",
          actorId: context.session!.user.id,
          actorEmail: context.session!.user.email,
          changes: {
            name: { before: null, after: input.name.trim() },
            mitglieder: { before: null, after: String(input.mitglieder.length) },
          },
          requestId: context.requestId ?? null,
        });
        return { id: fam!.id };
      });
    }),

  update: vorstandProc
    .input(
      v.object({
        id: v.string(),
        patch: v.object({
          name: v.optional(v.pipe(v.string(), v.minLength(1))),
          notiz: v.optional(v.nullable(v.string())),
          zahlerMemberId: v.optional(v.string()),
        }),
      }),
    )
    .handler(async ({ context, input }) => {
      await context.db.transaction(async (tx) => {
        const [fam] = await tx
          .select()
          .from(familienTable)
          .where(eq(familienTable.id, input.id))
          .limit(1);
        if (!fam) throw new ORPCError("NOT_FOUND", { message: "Familie nicht gefunden." });

        if (input.patch.zahlerMemberId) {
          // Der neue Zahler muss aktives Familienmitglied sein; seine Rolle
          // wird mitgezogen, der bisherige Zahler wird Partner.
          const [neu] = await tx
            .select({ id: familienMitgliederTable.id })
            .from(familienMitgliederTable)
            .where(
              and(
                eq(familienMitgliederTable.familieId, input.id),
                eq(familienMitgliederTable.memberId, input.patch.zahlerMemberId),
                isNull(familienMitgliederTable.bis),
              ),
            )
            .limit(1);
          if (!neu) {
            throw new ORPCError("VALIDATION_FAILED", {
              message: "Der neue Zahler muss aktives Mitglied der Familie sein.",
            });
          }
          await tx
            .update(familienMitgliederTable)
            .set({ rolle: "partner" })
            .where(
              and(
                eq(familienMitgliederTable.familieId, input.id),
                eq(familienMitgliederTable.rolle, "zahler"),
                isNull(familienMitgliederTable.bis),
              ),
            );
          await tx
            .update(familienMitgliederTable)
            .set({ rolle: "zahler" })
            .where(eq(familienMitgliederTable.id, neu.id));
        }

        const patch: Record<string, unknown> = { updatedAt: new Date() };
        if (input.patch.name !== undefined) patch.name = input.patch.name.trim();
        if ("notiz" in input.patch) patch.notiz = input.patch.notiz ?? null;
        if (input.patch.zahlerMemberId !== undefined)
          patch.zahlerMemberId = input.patch.zahlerMemberId;
        await tx
          .update(familienTable)
          .set(patch as never)
          .where(eq(familienTable.id, input.id));

        await appendAudit(tx, {
          entityType: "familie",
          entityId: input.id,
          action: "update",
          source: "ui",
          actorId: context.session!.user.id,
          actorEmail: context.session!.user.email,
          changes: {
            name: { before: fam.name, after: input.patch.name ?? fam.name },
            zahlerMemberId: {
              before: fam.zahlerMemberId,
              after: input.patch.zahlerMemberId ?? fam.zahlerMemberId,
            },
          },
          requestId: context.requestId ?? null,
        });
      });
      return { ok: true };
    }),

  addMember: vorstandProc
    .input(v.object({ familieId: v.string(), memberId: v.string(), rolle: RolleInput }))
    .handler(async ({ context, input }) => {
      if (input.rolle === "zahler") {
        throw new ORPCError("VALIDATION_FAILED", {
          message: "Der Zahler wird über Zahler ändern gesetzt, nicht beim Hinzufügen.",
        });
      }
      await context.db.transaction(async (tx) => {
        const [fam] = await tx
          .select({ id: familienTable.id })
          .from(familienTable)
          .where(eq(familienTable.id, input.familieId))
          .limit(1);
        if (!fam) throw new ORPCError("NOT_FOUND", { message: "Familie nicht gefunden." });
        const [aktiv] = await tx
          .select({ familieId: familienMitgliederTable.familieId })
          .from(familienMitgliederTable)
          .where(
            and(
              eq(familienMitgliederTable.memberId, input.memberId),
              isNull(familienMitgliederTable.bis),
            ),
          )
          .limit(1);
        if (aktiv) {
          throw new ORPCError("CONFLICT", {
            message: "Dieses Mitglied gehört bereits einer aktiven Familie an.",
          });
        }
        await tx.insert(familienMitgliederTable).values({
          familieId: input.familieId,
          memberId: input.memberId,
          rolle: input.rolle,
        });
        await appendAudit(tx, {
          entityType: "familie",
          entityId: input.familieId,
          action: "update",
          source: "ui",
          actorId: context.session!.user.id,
          actorEmail: context.session!.user.email,
          changes: { mitgliedHinzu: { before: null, after: input.memberId } },
          requestId: context.requestId ?? null,
        });
      });
      return { ok: true };
    }),

  /** Aktive Zugehörigkeit beenden (bis = heute). Der Zahler kann nicht austreten. */
  endMember: vorstandProc
    .input(v.object({ mitgliedschaftId: v.string() }))
    .handler(async ({ context, input }) => {
      await context.db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(familienMitgliederTable)
          .where(eq(familienMitgliederTable.id, input.mitgliedschaftId))
          .limit(1);
        if (!row || row.bis != null) {
          throw new ORPCError("NOT_FOUND", { message: "Aktive Zugehörigkeit nicht gefunden." });
        }
        if (row.rolle === "zahler") {
          throw new ORPCError("VALIDATION_FAILED", {
            message: "Der Zahler kann nicht austreten. Erst den Zahler ändern.",
          });
        }
        await tx
          .update(familienMitgliederTable)
          .set({ bis: sql`current_date` })
          .where(eq(familienMitgliederTable.id, input.mitgliedschaftId));
        await appendAudit(tx, {
          entityType: "familie",
          entityId: row.familieId,
          action: "update",
          source: "ui",
          actorId: context.session!.user.id,
          actorEmail: context.session!.user.email,
          changes: { mitgliedBeendet: { before: row.memberId, after: null } },
          requestId: context.requestId ?? null,
        });
      });
      return { ok: true };
    }),

  remove: vorstandProc.input(v.object({ id: v.string() })).handler(async ({ context, input }) => {
    await context.db.transaction(async (tx) => {
      const [fam] = await tx
        .select()
        .from(familienTable)
        .where(eq(familienTable.id, input.id))
        .limit(1);
      if (!fam) throw new ORPCError("NOT_FOUND", { message: "Familie nicht gefunden." });
      // FK auf zahler_member_id ist restrict: erst lösen, dann löschen.
      await tx
        .update(familienTable)
        .set({ zahlerMemberId: null })
        .where(eq(familienTable.id, input.id));
      await tx.delete(familienTable).where(eq(familienTable.id, input.id));
      await appendAudit(tx, {
        entityType: "familie",
        entityId: input.id,
        action: "delete",
        source: "ui",
        actorId: context.session!.user.id,
        actorEmail: context.session!.user.email,
        changes: { name: { before: fam.name, after: null } },
        requestId: context.requestId ?? null,
      });
    });
    return { ok: true };
  }),
};
