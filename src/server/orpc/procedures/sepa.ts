import { ORPCError } from "@orpc/server";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import * as v from "valibot";
import { appendAudit, diff } from "~/server/audit/log";
import type { DB } from "~/server/db/client";
import { withUniqueRetry } from "~/server/db/retry";
import { membersTable } from "~/server/db/schema/members";
import { relationshipsTable } from "~/server/db/schema/relationships";
import { sepaMandatesTable } from "~/server/db/schema/sepa";
import { planMandatNachtrag } from "~/server/domain/mandat-nachtrag";
import { isMinorAt } from "~/server/domain/member";
import { resolveZahler } from "~/server/domain/zahler";
import { vorstandProc } from "~/server/orpc/base";
import { loadZahlerContext } from "~/server/sepa/zahler-context";
import { takeMemberSnapshot } from "~/server/snapshots/snapshot";

function toDateOrNull(value: string | null | undefined, field: string): Date | null {
  if (!value) return null;
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) {
    throw new ORPCError("VALIDATION_FAILED", {
      message: `Ungültiges Datum im Feld "${field}": ${value}`,
    });
  }
  return d;
}

const CreateInput = v.object({
  memberId: v.string(),
  mandatsNr: v.optional(v.nullable(v.string())),
  lastschriftart: v.optional(v.nullable(v.string())),
  typ: v.optional(v.nullable(v.string())),
  status: v.optional(v.nullable(v.string())),
  unterschriftDatum: v.optional(v.nullable(v.string())),
  gueltigAb: v.optional(v.nullable(v.string())),
  gultigBis: v.optional(v.nullable(v.string())),
});

type NachtragKandidat = {
  zahlerMemberId: string;
  reference: string;
  name: string;
  /** Unterschriftsdatum für einen Nachtrag: früheste Beitrittserklärung, die der Zahler unterschrieben hat. */
  unterschriftDatum: Date | null;
  hasIban: boolean;
  /** Wen dieser Zahler bezahlt (Namen; leer beim Selbstzahler). */
  zahltFuer: string[];
  plan: ReturnType<typeof planMandatNachtrag>;
  mandatsNr?: string | null;
  /**
   * Vorschlag, wer als Vertreter/Zahler übernommen werden kann, wenn ein
   * minderjähriges Mitglied keinen gepflegten Vertreter hat, aber eine
   * Beziehung zu einem Erwachsenen. `strong` = der Name passt zum hinterlegten
   * Kontoinhaber, also sehr wahrscheinlich der echte Zahler.
   */
  vertreterCandidate?: {
    relationshipId: string;
    toMemberId: string;
    name: string;
    reference: string;
    strong: boolean;
  };
};

/** Normalisiert Namen für den groben Kontoinhaber-Abgleich. */
function normalizeName(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Zahler-zentrierte Kandidaten fürs Mandate-Nachtragen. Gemeinsame Quelle für
 * Anzeige und Ausführung, damit beide identisch entscheiden: das Mandat muss
 * beim aufgelösten Zahler liegen (Familie -> Vertreter -> selbst), niemals
 * beim minderjährigen Mitglied. Minderjährige Selbstzahler sind ein
 * Datenqualitätsbefund (skip), keine Mandatsanlage.
 */
async function loadNachtragKandidaten(db: DB): Promise<NachtragKandidat[]> {
  const billedMembers = await db
    .select({
      id: membersTable.id,
      vorname: membersTable.vorname,
      nachname: membersTable.nachname,
      eintritt: membersTable.eintritt,
      geburtsdatum: membersTable.geburtsdatum,
      abwKontoInh: membersTable.abwKontoInh,
    })
    .from(membersTable)
    .where(
      sql`${membersTable.deletedAt} is null
        and (${membersTable.austritt} is null or ${membersTable.austritt}::date > current_date)
        and exists (
          select 1 from contracts c
          where c.member_id = ${membersTable.id} and c.is_direct_debit = true
            and (c.vertrag_ende is null or c.vertrag_ende > now()) and c.betrag > 0
        )`,
    );
  if (billedMembers.length === 0) return [];

  const ctx = await loadZahlerContext(
    db,
    billedMembers.map((m) => m.id),
  );
  const now = new Date();
  const byZahler = new Map<string, typeof billedMembers>();
  const minorSelf: typeof billedMembers = [];
  for (const m of billedMembers) {
    const z = resolveZahler({
      memberId: m.id,
      familieZahlerId: ctx.familieZahlerByMember.get(m.id) ?? null,
      vertreterId: ctx.vertreterByMember.get(m.id) ?? null,
      minderjaehrig: isMinorAt(m.geburtsdatum, now),
    });
    if (z.quelle === "selbst" && isMinorAt(m.geburtsdatum, now)) {
      minorSelf.push(m);
      continue;
    }
    const list = byZahler.get(z.zahlerId) ?? [];
    list.push(m);
    byZahler.set(z.zahlerId, list);
  }

  const zahlerIds = [...new Set([...byZahler.keys(), ...minorSelf.map((m) => m.id)])];
  if (zahlerIds.length === 0) return [];
  const zahlerRows = await db
    .select({
      id: membersTable.id,
      memberNo: membersTable.memberNo,
      kontaktNo: membersTable.kontaktNo,
      mitgliedsnummer: membersTable.mitgliedsnummer,
      vorname: membersTable.vorname,
      nachname: membersTable.nachname,
      eintritt: membersTable.eintritt,
      hasIban: sql<boolean>`${membersTable.iban1} is not null`,
    })
    .from(membersTable)
    .where(inArray(membersTable.id, zahlerIds));
  const zahlerById = new Map(zahlerRows.map((r) => [r.id, r]));

  const mandateRows = await db
    .select({
      id: sepaMandatesTable.id,
      memberId: sepaMandatesTable.memberId,
      mandatsNr: sepaMandatesTable.mandatsNr,
      isDeleted: sepaMandatesTable.isDeleted,
      widerrufenAm: sepaMandatesTable.widerrufenAm,
      status: sepaMandatesTable.status,
      gultigBis: sepaMandatesTable.gultigBis,
      angelegtAm: sepaMandatesTable.angelegtAm,
    })
    .from(sepaMandatesTable)
    .where(inArray(sepaMandatesTable.memberId, zahlerIds));

  const result: NachtragKandidat[] = [];
  const name = (r: { nachname: string | null; vorname: string | null }) =>
    [r.nachname, r.vorname].filter(Boolean).join(", ");
  const ref = (r: {
    memberNo: string | null;
    kontaktNo: string | null;
    mitgliedsnummer: string | null;
  }) => r.memberNo ?? r.kontaktNo ?? r.mitgliedsnummer ?? "";

  for (const [zahlerId, covered] of byZahler) {
    const zahler = zahlerById.get(zahlerId);
    if (!zahler) continue;
    const mandate = mandateRows
      .filter((r) => r.memberId === zahlerId)
      .map((r) => ({ ...r, isDeleted: r.isDeleted ?? false }));
    // Unterschrift = früheste Beitrittserklärung, die dieser Zahler trägt:
    // eigener Eintritt (falls Mitglied) oder der des ältesten bezahlten Kindes.
    const eintritte = [zahler.eintritt, ...covered.map((c) => c.eintritt)]
      .filter((d): d is Date => d != null)
      .sort((a, b) => a.getTime() - b.getTime());
    const unterschriftDatum = eintritte[0] ?? null;
    const plan = planMandatNachtrag({ eintritt: unterschriftDatum, mandate });
    if (plan.kind === "skip" && plan.reason === "Aktives Mandat vorhanden") continue;
    result.push({
      zahlerMemberId: zahlerId,
      reference: ref(zahler),
      name: name(zahler),
      unterschriftDatum,
      hasIban: zahler.hasIban,
      zahltFuer: covered.filter((c) => c.id !== zahlerId).map(name),
      plan,
      ...(plan.kind === "reactivate"
        ? { mandatsNr: mandate.find((r) => r.id === plan.mandateId)?.mandatsNr ?? null }
        : {}),
    });
  }

  // Für die minderjährigen Selbstzahler: vorhandene Beziehung zu einem
  // Erwachsenen als Vertreter-Vorschlag laden. Genau dieses Signal verschenkt
  // die Logik sonst (Linear hat das Vertreter-Flag nie gesetzt). Ein Klick in
  // der UI macht daraus den gepflegten Vertreter.
  const candidatesByMinor = new Map<
    string,
    Array<{
      relationshipId: string;
      toMemberId: string;
      nachname: string | null;
      vorname: string | null;
      reference: string;
    }>
  >();
  const minorIds = minorSelf.map((m) => m.id);
  if (minorIds.length > 0) {
    const target = alias(membersTable, "vertreter_target");
    const candRows = await db
      .select({
        relationshipId: relationshipsTable.id,
        fromMemberId: relationshipsTable.fromMemberId,
        toMemberId: relationshipsTable.toMemberId,
        nachname: target.nachname,
        vorname: target.vorname,
        memberNo: target.memberNo,
        kontaktNo: target.kontaktNo,
        mitgliedsnummer: target.mitgliedsnummer,
      })
      .from(relationshipsTable)
      .innerJoin(target, eq(target.id, relationshipsTable.toMemberId))
      .where(
        and(
          inArray(relationshipsTable.fromMemberId, minorIds),
          sql`${target.deletedAt} is null`,
          // Erwachsene Gegenseite (oder Kontakt ohne Geburtsdatum, typisch für Eltern).
          sql`(${target.geburtsdatum} is null or ${target.geburtsdatum} <= now() - interval '18 years')`,
          // Nur aktive Verknüpfungen.
          or(sql`${relationshipsTable.datBis} is null`, sql`${relationshipsTable.datBis} > now()`),
        ),
      );
    for (const r of candRows) {
      if (!r.toMemberId) continue;
      const list = candidatesByMinor.get(r.fromMemberId) ?? [];
      list.push({
        relationshipId: r.relationshipId,
        toMemberId: r.toMemberId,
        nachname: r.nachname,
        vorname: r.vorname,
        reference: ref(r),
      });
      candidatesByMinor.set(r.fromMemberId, list);
    }
  }

  for (const m of minorSelf) {
    const z = zahlerById.get(m.id);
    if (!z) continue;
    const mandate = mandateRows
      .filter((r) => r.memberId === m.id)
      .map((r) => ({ ...r, isDeleted: r.isDeleted ?? false }));
    const usable = planMandatNachtrag({ eintritt: m.eintritt, mandate });
    // Minderjährige mit (Linear-)Altmandat funktionieren weiter; nur die ohne
    // jede Einzugsgrundlage erscheinen als Datenqualitätsfall.
    if (usable.kind === "skip" && usable.reason === "Aktives Mandat vorhanden") continue;

    // Besten Vertreter-Vorschlag wählen: ein Treffer auf den Kontoinhaber-Namen
    // gewinnt (sehr wahrscheinlich der echte Zahler), sonst die erste Beziehung.
    const konto = normalizeName(m.abwKontoInh);
    const candidates = candidatesByMinor.get(m.id) ?? [];
    const scored = candidates.map((c) => {
      const nn = normalizeName(c.nachname);
      const vn = normalizeName(c.vorname);
      const strong = !!konto && !!nn && konto.includes(nn) && (vn ? konto.includes(vn) : true);
      return { c, strong };
    });
    scored.sort((a, b) => (a.strong === b.strong ? 0 : a.strong ? -1 : 1));
    const best = scored[0];

    result.push({
      zahlerMemberId: m.id,
      reference: ref(z),
      name: name(z),
      unterschriftDatum: null,
      hasIban: z.hasIban,
      zahltFuer: [],
      plan: {
        kind: "skip",
        reason: "Minderjährig ohne Vertreter oder Familie. Erst Beziehung oder Familie pflegen.",
      },
      ...(best
        ? {
            vertreterCandidate: {
              relationshipId: best.c.relationshipId,
              toMemberId: best.c.toMemberId,
              name: [best.c.nachname, best.c.vorname].filter(Boolean).join(", "),
              reference: best.c.reference,
              strong: best.strong,
            },
          }
        : {}),
    });
  }

  return result.sort((a, b) => a.name.localeCompare(b.name, "de"));
}

const UpdateInput = v.object({
  status: v.optional(v.nullable(v.string())),
  lastschriftart: v.optional(v.nullable(v.string())),
  typ: v.optional(v.nullable(v.string())),
  unterschriftDatum: v.optional(v.nullable(v.string())),
  gueltigAb: v.optional(v.nullable(v.string())),
  gultigBis: v.optional(v.nullable(v.string())),
  widerrufenAm: v.optional(v.nullable(v.string())),
});

export const sepaRouter = {
  create: vorstandProc.input(CreateInput).handler(async ({ context, input }) => {
    // Auto-generated `M{seq}` mandate refs race under concurrency: two
    // creates for the same member can read the same max and collide on the
    // (adrNr, mandatsNr) unique index. Retry re-reads the max and picks the
    // next free suffix. A user-supplied duplicate is caught explicitly below
    // and surfaces as a friendly CONFLICT instead of being retried.
    return await withUniqueRetry(() =>
      context.db.transaction(async (tx) => {
        const [member] = await tx
          .select({ id: membersTable.id, adrNr: membersTable.adrNr })
          .from(membersTable)
          .where(eq(membersTable.id, input.memberId))
          .limit(1);
        if (!member) {
          throw new ORPCError("NOT_FOUND", { message: "Mitglied nicht gefunden." });
        }

        let mandatsNr = input.mandatsNr?.trim();
        if (mandatsNr) {
          const [dupe] = await tx
            .select({ id: sepaMandatesTable.id })
            .from(sepaMandatesTable)
            .where(
              and(
                eq(sepaMandatesTable.adrNr, member.adrNr),
                eq(sepaMandatesTable.mandatsNr, mandatsNr),
              ),
            )
            .limit(1);
          if (dupe) {
            throw new ORPCError("CONFLICT", {
              message: `Mandatsreferenz ${mandatsNr} ist für dieses Mitglied bereits vergeben.`,
            });
          }
        } else {
          // Generate `M{seq}` where seq is the next integer suffix not yet
          // used for this member. Keeps the format short and predictable,
          // and avoids collisions with the Linear-imported numeric mandate
          // refs.
          const [maxRow] = await tx
            .select({
              maxSeq: sql<number>`coalesce(max(nullif(regexp_replace(${sepaMandatesTable.mandatsNr}, '\\D', '', 'g'), '')::int), 0)::int`,
            })
            .from(sepaMandatesTable)
            .where(eq(sepaMandatesTable.memberId, member.id));
          mandatsNr = `M${(maxRow?.maxSeq ?? 0) + 1}`;
        }

        const values = {
          memberId: member.id,
          adrNr: member.adrNr,
          mandatsNr,
          lastschriftart: input.lastschriftart ?? null,
          typ: input.typ ?? null,
          status: input.status ?? null,
          angelegtAm: new Date(),
          unterschriftDatum: toDateOrNull(input.unterschriftDatum, "Unterschriftsdatum"),
          gueltigAb: toDateOrNull(input.gueltigAb, "Gültig ab"),
          gultigBis: toDateOrNull(input.gultigBis, "Gültig bis"),
        };

        const [row] = await tx
          .insert(sepaMandatesTable)
          .values(values as never)
          .returning({ id: sepaMandatesTable.id });
        if (!row) {
          throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Anlage fehlgeschlagen." });
        }

        const auditId = await appendAudit(tx, {
          entityType: "sepa_mandate",
          entityId: row.id,
          action: "create",
          source: "ui",
          actorId: context.session!.user.id,
          actorEmail: context.session!.user.email,
          changes: diff(null, values as Record<string, unknown>),
          requestId: context.requestId ?? null,
        });
        await takeMemberSnapshot(tx, member.id, {
          trigger: "mutation",
          actorId: context.session!.user.id,
          actorEmail: context.session!.user.email,
          auditId,
        });

        return { id: row.id, mandatsNr };
      }),
    );
  }),

  update: vorstandProc
    .input(v.object({ id: v.string(), patch: UpdateInput }))
    .handler(async ({ context, input }) => {
      await context.db.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(sepaMandatesTable)
          .where(eq(sepaMandatesTable.id, input.id))
          .limit(1);
        if (!existing) {
          throw new ORPCError("NOT_FOUND", { message: "Mandat nicht gefunden." });
        }
        const patch: Record<string, unknown> = { updatedAt: new Date() };
        if ("status" in input.patch) patch.status = input.patch.status ?? null;
        if ("lastschriftart" in input.patch)
          patch.lastschriftart = input.patch.lastschriftart ?? null;
        if ("typ" in input.patch) patch.typ = input.patch.typ ?? null;
        if ("unterschriftDatum" in input.patch)
          patch.unterschriftDatum = toDateOrNull(
            input.patch.unterschriftDatum,
            "Unterschriftsdatum",
          );
        if ("gueltigAb" in input.patch)
          patch.gueltigAb = toDateOrNull(input.patch.gueltigAb, "Gültig ab");
        if ("gultigBis" in input.patch)
          patch.gultigBis = toDateOrNull(input.patch.gultigBis, "Gültig bis");
        if ("widerrufenAm" in input.patch)
          patch.widerrufenAm = toDateOrNull(input.patch.widerrufenAm, "Widerrufen am");

        const projected: Record<string, unknown> = {
          ...(existing as Record<string, unknown>),
          ...patch,
        };

        await tx
          .update(sepaMandatesTable)
          .set(patch as never)
          .where(eq(sepaMandatesTable.id, input.id));

        const changes = diff(existing as unknown as Record<string, unknown>, projected);
        if (Object.keys(changes).length > 0) {
          const auditId = await appendAudit(tx, {
            entityType: "sepa_mandate",
            entityId: input.id,
            action: "update",
            source: "ui",
            actorId: context.session!.user.id,
            actorEmail: context.session!.user.email,
            changes,
            requestId: context.requestId ?? null,
          });
          await takeMemberSnapshot(tx, existing.memberId, {
            trigger: "mutation",
            actorId: context.session!.user.id,
            actorEmail: context.session!.user.email,
            auditId,
          });
        }
      });

      return { ok: true };
    }),

  /**
   * Soft-revoke: sets `widerrufen_am` to now and `is_deleted=true` so the
   * mandate stays in the audit history but is excluded from active mandate
   * lookups. Hard deletion is intentionally not exposed -- once a mandate is
   * used for a Lastschrift it must remain referenceable for SEPA returns.
   */
  revoke: vorstandProc.input(v.object({ id: v.string() })).handler(async ({ context, input }) => {
    await context.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(sepaMandatesTable)
        .where(eq(sepaMandatesTable.id, input.id))
        .limit(1);
      if (!existing) {
        throw new ORPCError("NOT_FOUND", { message: "Mandat nicht gefunden." });
      }
      const now = new Date();
      await tx
        .update(sepaMandatesTable)
        .set({ widerrufenAm: now, isDeleted: true, updatedAt: now } as never)
        .where(eq(sepaMandatesTable.id, input.id));
      const auditId = await appendAudit(tx, {
        entityType: "sepa_mandate",
        entityId: input.id,
        action: "update",
        source: "ui",
        actorId: context.session!.user.id,
        actorEmail: context.session!.user.email,
        changes: {
          widerrufenAm: {
            before: existing.widerrufenAm?.toISOString() ?? null,
            after: now.toISOString(),
          },
          isDeleted: { before: existing.isDeleted ?? false, after: true },
        },
        requestId: context.requestId ?? null,
      });
      await takeMemberSnapshot(tx, existing.memberId, {
        trigger: "mutation",
        actorId: context.session!.user.id,
        actorEmail: context.session!.user.email,
        auditId,
      });
    });
    return { ok: true };
  }),

  /**
   * Kandidaten für "Mandate nachtragen", Zahler-zentriert: das Mandat muss
   * beim Zahler liegen (Familien-Zahler, Vertreter bei Minderjährigen, sonst
   * das Mitglied selbst), nie beim Kind. Minderjährige Selbstzahler ohne
   * Vertreter oder Familie sind ein Datenqualitätsfall und werden nur
   * angezeigt -- erst Beziehung mit Vertreter-Flag oder Familie pflegen.
   */
  nachtragKandidaten: vorstandProc.input(v.void()).handler(async ({ context }) => {
    return await loadNachtragKandidaten(context.db);
  }),

  /**
   * Führt das Nachtragen für die übergebenen ZAHLER aus. Der Plan kommt aus
   * `loadNachtragKandidaten` und wird serverseitig neu berechnet (nie dem
   * Client geglaubt): `create` legt das Mandat beim Zahler an, Unterschrift =
   * früheste von ihm unterschriebene Beitrittserklärung; `reactivate` leert
   * das Gültig-bis des jüngsten nie widerrufenen Mandats. Alles auditiert
   * plus Mitglieds-Snapshot, wie bei manueller Anlage.
   */
  mandateNachtragen: vorstandProc
    .input(v.object({ memberIds: v.pipe(v.array(v.string()), v.minLength(1)) }))
    .handler(async ({ context, input }) => {
      const kandidaten = await loadNachtragKandidaten(context.db);
      const byId = new Map(kandidaten.map((k) => [k.zahlerMemberId, k]));
      const results: Array<{ memberId: string; action: string; detail?: string }> = [];
      for (const memberId of [...new Set(input.memberIds)]) {
        const kandidat = byId.get(memberId);
        if (!kandidat) {
          results.push({ memberId, action: "skip", detail: "Kein offener Kandidat" });
          continue;
        }
        const result = await withUniqueRetry(() =>
          context.db.transaction(async (tx) => {
            const [member] = await tx
              .select({
                id: membersTable.id,
                adrNr: membersTable.adrNr,
              })
              .from(membersTable)
              .where(eq(membersTable.id, memberId))
              .limit(1);
            if (!member) return { action: "skip", detail: "Mitglied nicht gefunden" };

            const plan = kandidat.plan;
            if (plan.kind === "skip") return { action: "skip", detail: plan.reason };

            if (plan.kind === "reactivate") {
              const [existing] = await tx
                .select()
                .from(sepaMandatesTable)
                .where(eq(sepaMandatesTable.id, plan.mandateId))
                .limit(1);
              if (!existing) return { action: "skip", detail: "Mandat nicht gefunden" };
              const now = new Date();
              await tx
                .update(sepaMandatesTable)
                .set({ gultigBis: null, status: "Aktiv", updatedAt: now } as never)
                .where(eq(sepaMandatesTable.id, plan.mandateId));
              const auditId = await appendAudit(tx, {
                entityType: "sepa_mandate",
                entityId: plan.mandateId,
                action: "update",
                source: "ui",
                actorId: context.session!.user.id,
                actorEmail: context.session!.user.email,
                changes: {
                  gultigBis: {
                    before: existing.gultigBis?.toISOString() ?? null,
                    after: null,
                  },
                  status: { before: existing.status, after: "Aktiv" },
                  nachtrag: {
                    before: null,
                    after:
                      "Reaktiviert: Gültig-bis war Import-Artefakt, Mandat durchgehend genutzt",
                  },
                },
                requestId: context.requestId ?? null,
              });
              await takeMemberSnapshot(tx, memberId, {
                trigger: "mutation",
                actorId: context.session!.user.id,
                actorEmail: context.session!.user.email,
                auditId,
              });
              return { action: "reactivated", detail: existing.mandatsNr ?? undefined };
            }

            // create: Mandat aus der Beitrittserklärung nachtragen.
            const [maxRow] = await tx
              .select({
                maxSeq: sql<number>`coalesce(max(nullif(regexp_replace(${sepaMandatesTable.mandatsNr}, '\\D', '', 'g'), '')::int), 0)::int`,
              })
              .from(sepaMandatesTable)
              .where(eq(sepaMandatesTable.memberId, memberId));
            const mandatsNr = `M${(maxRow?.maxSeq ?? 0) + 1}`;
            const unterschrift = kandidat.unterschriftDatum;
            const values = {
              memberId,
              adrNr: member.adrNr,
              mandatsNr,
              status: "Aktiv",
              angelegtAm: new Date(),
              unterschriftDatum: unterschrift,
              gueltigAb: unterschrift,
              gultigBis: null,
            };
            const [row] = await tx
              .insert(sepaMandatesTable)
              .values(values as never)
              .returning({ id: sepaMandatesTable.id });
            if (!row) return { action: "skip", detail: "Anlage fehlgeschlagen" };
            const auditId = await appendAudit(tx, {
              entityType: "sepa_mandate",
              entityId: row.id,
              action: "create",
              source: "ui",
              actorId: context.session!.user.id,
              actorEmail: context.session!.user.email,
              changes: {
                ...diff(null, values as Record<string, unknown>),
                nachtrag: {
                  before: null,
                  after:
                    kandidat.zahltFuer.length > 0
                      ? `Nachgetragen aus Beitrittserklärung als Zahler für: ${kandidat.zahltFuer.join(", ")}`
                      : "Nachgetragen aus Beitrittserklärung (Unterschrift = Eintrittsdatum)",
                },
              },
              requestId: context.requestId ?? null,
            });
            await takeMemberSnapshot(tx, memberId, {
              trigger: "mutation",
              actorId: context.session!.user.id,
              actorEmail: context.session!.user.email,
              auditId,
            });
            return { action: "created", detail: mandatsNr };
          }),
        );
        results.push({ memberId, ...result });
      }
      return {
        created: results.filter((r) => r.action === "created").length,
        reactivated: results.filter((r) => r.action === "reactivated").length,
        skipped: results.filter((r) => r.action === "skip").length,
        results,
      };
    }),
};
