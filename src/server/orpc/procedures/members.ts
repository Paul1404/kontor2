import { and, asc, count, desc, eq, ilike, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import * as v from "valibot";
import { authedProc, vorstandProc } from "~/server/orpc/base";
import { abteilungenTable, memberAbteilungenTable } from "~/server/db/schema/abteilungen";
import { auditLogTable } from "~/server/db/schema/audit";
import { attachmentsTable } from "~/server/db/schema/attachments";
import { contractsTable } from "~/server/db/schema/contracts";
import { membersTable } from "~/server/db/schema/members";
import { relationshipsTable } from "~/server/db/schema/relationships";
import { sepaMandatesTable } from "~/server/db/schema/sepa";
import { appendAudit, diff } from "~/server/audit/log";
import { lastFour } from "~/server/crypto/encrypt";
import {
  invalidateMemberCaches,
  getCached,
  searchCacheKey,
  setCached,
} from "~/server/search/cache";

const StatusSchema = v.picklist(["aktiv", "passiv", "ausgetreten", "verstorben", "alle"]);

const ListInput = v.object({
  q: v.optional(v.string(), ""),
  status: v.optional(StatusSchema, "aktiv"),
  abteilungId: v.optional(v.nullable(v.string()), null),
  includeAusgetretene: v.optional(v.boolean(), false),
  page: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1)), 1),
  pageSize: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(200)), 50),
});

/**
 * Curated subset of Linear's 200+ `adresse` columns that the UI can edit.
 * Designed to be expanded one line at a time as the UI grows; anything not in
 * this allow-list is preserved as-is on update.
 */
const StammdatenInput = v.object({
  anrede: v.optional(v.nullable(v.string())),
  titel1: v.optional(v.nullable(v.string())),
  titel2: v.optional(v.nullable(v.string())),
  vorname: v.optional(v.nullable(v.string())),
  nachname: v.optional(v.nullable(v.string())),
  geborene: v.optional(v.nullable(v.string())),
  geburtsname: v.optional(v.nullable(v.string())),
  geburtsdatum: v.optional(v.nullable(v.string())),
  geburtsort: v.optional(v.nullable(v.string())),
  strasse: v.optional(v.nullable(v.string())),
  hausnummer: v.optional(v.nullable(v.string())),
  plz: v.optional(v.nullable(v.string())),
  ort: v.optional(v.nullable(v.string())),
  land: v.optional(v.nullable(v.string())),
  telefon1: v.optional(v.nullable(v.string())),
  telefon2: v.optional(v.nullable(v.string())),
  eMailName: v.optional(v.nullable(v.pipe(v.string(), v.email()))),
  eintritt: v.optional(v.nullable(v.string())),
  austritt: v.optional(v.nullable(v.string())),
  verstorbenAm: v.optional(v.nullable(v.string())),
  aktivPasiv: v.optional(v.nullable(v.picklist(["A", "P"]))),
  bank1: v.optional(v.nullable(v.string())),
  bic1: v.optional(v.nullable(v.string())),
  iban1: v.optional(v.nullable(v.string())),
  abwKontoInh: v.optional(v.nullable(v.string())),
  mandatsrefenz: v.optional(v.nullable(v.string())),
  notes: v.optional(v.nullable(v.string())),
});

function toDateOrNull(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
}

function normalizeIban(value: string | null | undefined): string | null {
  if (!value) return null;
  const clean = value.replace(/\s+/g, "").toUpperCase();
  return clean.length > 0 ? clean : null;
}

/**
 * Translate the curated Stammdaten payload into a partial DB-row object,
 * coercing date strings to `Date` and computing `iban1Last4` when the IBAN
 * changes.
 */
function buildMemberPatch(input: v.InferOutput<typeof StammdatenInput>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const setIfPresent = <K extends keyof typeof input>(key: K, mapped?: string) => {
    if (key in input) {
      patch[mapped ?? (key as string)] = input[key] ?? null;
    }
  };
  setIfPresent("anrede");
  setIfPresent("titel1");
  setIfPresent("titel2");
  setIfPresent("vorname");
  setIfPresent("nachname");
  setIfPresent("geborene");
  setIfPresent("geburtsname");
  setIfPresent("geburtsort");
  setIfPresent("strasse");
  setIfPresent("hausnummer");
  setIfPresent("plz");
  setIfPresent("ort");
  setIfPresent("land");
  setIfPresent("telefon1");
  setIfPresent("telefon2");
  setIfPresent("eMailName");
  setIfPresent("aktivPasiv");
  setIfPresent("bank1");
  setIfPresent("bic1");
  setIfPresent("abwKontoInh");
  setIfPresent("mandatsrefenz");
  setIfPresent("notes");

  if ("geburtsdatum" in input) patch.geburtsdatum = toDateOrNull(input.geburtsdatum);
  if ("eintritt" in input) patch.eintritt = toDateOrNull(input.eintritt);
  if ("austritt" in input) patch.austritt = toDateOrNull(input.austritt);
  if ("verstorbenAm" in input) patch.verstorbenAm = toDateOrNull(input.verstorbenAm);

  if ("iban1" in input) {
    const norm = normalizeIban(input.iban1);
    patch.iban1 = norm;
    patch.iban1Last4 = lastFour(norm);
  }

  return patch;
}

export const membersRouter = {
  list: authedProc.input(ListInput).handler(async ({ context, input }) => {
    const cacheKey = searchCacheKey(input);
    const cached = await getCached<{ rows: unknown[]; total: number }>(cacheKey);
    if (cached) return cached;

    const conditions = [] as ReturnType<typeof eq>[];

    if (!input.includeAusgetretene && input.status !== "ausgetreten") {
      conditions.push(isNull(membersTable.austritt) as never);
    }
    if (input.status === "ausgetreten") {
      conditions.push(isNotNull(membersTable.austritt) as never);
    }
    if (input.status === "verstorben") {
      conditions.push(isNotNull(membersTable.verstorbenAm) as never);
    }
    if (input.status === "aktiv") {
      // Match the dashboard's "Aktive Mitglieder" definition: not exited
      // and not deceased. The Linear `Aktiv` column is a free-form string
      // ("J"/"N"/empty in German source data) and not reliable here.
      conditions.push(isNull(membersTable.verstorbenAm) as never);
    }
    if (input.status === "passiv") {
      conditions.push(
        eq(membersTable.aktivPasiv, "P") as never,
        isNull(membersTable.verstorbenAm) as never,
      );
    }

    // Hide soft-deleted members from the normal list view.
    conditions.push(isNull(membersTable.deletedAt) as never);

    if (input.q.trim()) {
      const like = `%${input.q.trim()}%`;
      conditions.push(
        or(
          ilike(membersTable.nachname, like),
          ilike(membersTable.vorname, like),
          ilike(membersTable.mitglnr, like),
          ilike(membersTable.eMailName, like),
          ilike(membersTable.ort, like),
        ) as never,
      );
    }

    let memberIdsByAbt: string[] | null = null;
    if (input.abteilungId) {
      const rows = await context.db
        .select({ memberId: memberAbteilungenTable.memberId })
        .from(memberAbteilungenTable)
        .where(eq(memberAbteilungenTable.abteilungId, input.abteilungId));
      memberIdsByAbt = rows.map((r) => r.memberId);
      if (memberIdsByAbt.length === 0) {
        const empty = { rows: [], total: 0 };
        await setCached(cacheKey, empty);
        return empty;
      }
      conditions.push(inArray(membersTable.id, memberIdsByAbt) as never);
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const offset = (input.page - 1) * input.pageSize;
    const [rows, [totalRow]] = await Promise.all([
      context.db
        .select({
          id: membersTable.id,
          adrNr: membersTable.adrNr,
          mitglnr: membersTable.mitglnr,
          anrede: membersTable.anrede,
          titel: membersTable.titel1,
          vorname: membersTable.vorname,
          nachname: membersTable.nachname,
          plz: membersTable.plz,
          ort: membersTable.ort,
          email: membersTable.eMailName,
          telefon: membersTable.telefon1,
          eintritt: membersTable.eintritt,
          austritt: membersTable.austritt,
          verstorbenAm: membersTable.verstorbenAm,
          aktiv: membersTable.aktiv,
          aktivPasiv: membersTable.aktivPasiv,
          abteilung: membersTable.abteilung,
        })
        .from(membersTable)
        .where(where)
        .orderBy(asc(membersTable.nachname), asc(membersTable.vorname))
        .limit(input.pageSize)
        .offset(offset),
      context.db.select({ c: count() }).from(membersTable).where(where),
    ]);

    const result = { rows, total: totalRow?.c ?? 0 };
    await setCached(cacheKey, result);
    return result;
  }),

  get: authedProc
    .input(v.object({ mitgliedsnummer: v.string() }))
    .handler(async ({ context, input }) => {
      const rows = await context.db
        .select()
        .from(membersTable)
        .where(eq(membersTable.mitglnr, input.mitgliedsnummer))
        .limit(1);
      const m = rows[0];
      if (!m) throw new ORPCError("NOT_FOUND", { message: "Mitglied nicht gefunden." });

      const [abteilungen, vertraege, sepa, anhaenge, audit, beziehungen] = await Promise.all([
        context.db
          .select({
            id: abteilungenTable.id,
            name: abteilungenTable.name,
            eintrittsdatum: memberAbteilungenTable.eintrittsdatum,
            austrittsdatum: memberAbteilungenTable.austrittsdatum,
          })
          .from(memberAbteilungenTable)
          .innerJoin(abteilungenTable, eq(abteilungenTable.id, memberAbteilungenTable.abteilungId))
          .where(eq(memberAbteilungenTable.memberId, m.id))
          .orderBy(asc(abteilungenTable.name)),
        context.db
          .select()
          .from(contractsTable)
          .where(eq(contractsTable.memberId, m.id))
          .orderBy(desc(contractsTable.vertragBegin)),
        context.db
          .select()
          .from(sepaMandatesTable)
          .where(eq(sepaMandatesTable.memberId, m.id))
          .orderBy(desc(sepaMandatesTable.angelegtAm)),
        context.db
          .select()
          .from(attachmentsTable)
          .where(eq(attachmentsTable.memberId, m.id))
          .orderBy(desc(attachmentsTable.uploadedAt)),
        context.db
          .select()
          .from(auditLogTable)
          .where(and(eq(auditLogTable.entityType, "member"), eq(auditLogTable.entityId, m.id)))
          .orderBy(desc(auditLogTable.createdAt))
          .limit(50),
        context.db
          .select({
            id: relationshipsTable.id,
            beziehung: relationshipsTable.beziehung,
            notiz: relationshipsTable.notiz,
            datVon: relationshipsTable.datVon,
            datBis: relationshipsTable.datBis,
            toMemberId: relationshipsTable.toMemberId,
            toAdrNr: relationshipsTable.toAdrNr,
            fallbackName: relationshipsTable.name,
            toMitglnr: membersTable.mitglnr,
            toVorname: membersTable.vorname,
            toNachname: membersTable.nachname,
          })
          .from(relationshipsTable)
          .leftJoin(membersTable, eq(membersTable.id, relationshipsTable.toMemberId))
          .where(eq(relationshipsTable.fromMemberId, m.id))
          .orderBy(asc(relationshipsTable.beziehung), asc(relationshipsTable.toAdrNr)),
      ]);

      // Strip the encrypted IBAN ciphertexts from the response. UI only sees last4.
      const { iban1, iban2, iban3, ...stamm } = m;
      void iban1;
      void iban2;
      void iban3;

      return {
        member: stamm,
        abteilungen,
        vertraege,
        sepa,
        anhaenge: anhaenge.map((a) => ({
          id: a.id,
          filename: a.filename,
          mimeType: a.mimeType,
          sizeBytes: a.sizeBytes,
          uploadedAt: a.uploadedAt,
        })),
        audit,
        beziehungen,
      };
    }),

  abteilungenList: authedProc.input(v.void()).handler(async ({ context }) => {
    return context.db
      .select({
        id: abteilungenTable.id,
        name: abteilungenTable.name,
        slug: abteilungenTable.slug,
        count: sql<number>`(select count(*) from ${memberAbteilungenTable} where ${memberAbteilungenTable.abteilungId} = ${abteilungenTable.id})::int`,
      })
      .from(abteilungenTable)
      .orderBy(asc(abteilungenTable.name));
  }),

  update: vorstandProc
    .input(v.object({ memberId: v.string(), patch: StammdatenInput }))
    .handler(async ({ context, input }) => {
      const [existing] = await context.db
        .select()
        .from(membersTable)
        .where(eq(membersTable.id, input.memberId))
        .limit(1);
      if (!existing) {
        throw new ORPCError("NOT_FOUND", { message: "Mitglied nicht gefunden." });
      }

      const patch = buildMemberPatch(input.patch);
      if (Object.keys(patch).length === 0) {
        return { ok: true, mitglnr: existing.mitglnr };
      }

      // Build the projected next-state for the diff. We need to compare what
      // *will* be in the row after the update so the audit log reflects the
      // actual change, not the request shape.
      const projected: Record<string, unknown> = {
        ...(existing as Record<string, unknown>),
        ...patch,
      };

      await context.db
        .update(membersTable)
        .set({ ...patch, updatedAt: new Date() } as never)
        .where(eq(membersTable.id, input.memberId));

      const changes = diff(existing as unknown as Record<string, unknown>, projected);
      if (Object.keys(changes).length > 0) {
        await appendAudit(context.db, {
          entityType: "member",
          entityId: input.memberId,
          action: "update",
          source: "ui",
          actorId: context.session!.user.id,
          actorEmail: context.session!.user.email,
          changes,
          requestId: context.requestId ?? null,
        });
      }

      await invalidateMemberCaches();
      return { ok: true, mitglnr: existing.mitglnr };
    }),

  create: vorstandProc
    .input(
      v.object({
        mitglnr: v.optional(v.nullable(v.string())),
        patch: StammdatenInput,
      }),
    )
    .handler(async ({ context, input }) => {
      const patch = buildMemberPatch(input.patch);
      if (!patch.nachname && !patch.vorname) {
        throw new ORPCError("VALIDATION_FAILED", {
          message: "Vor- oder Nachname ist erforderlich.",
        });
      }

      // Generate the next available AdrNr (Linear's primary identifier) and
      // Mitgliedsnummer. Both columns are unique. AdrNr is required NOT NULL
      // on the schema. We compute max(adr_nr)+1 in a single query.
      const [maxRow] = await context.db
        .select({
          maxAdrNr: sql<number>`coalesce(max(${membersTable.adrNr}), 0)::int`,
          maxMitglnrInt: sql<number>`coalesce(max(nullif(regexp_replace(${membersTable.mitglnr}, '\\D', '', 'g'), '')::int), 0)::int`,
        })
        .from(membersTable);
      const nextAdrNr = (maxRow?.maxAdrNr ?? 0) + 1;
      const nextMitglnr =
        input.mitglnr && input.mitglnr.trim().length > 0
          ? input.mitglnr.trim()
          : String((maxRow?.maxMitglnrInt ?? 0) + 1);

      // Enforce mitglnr uniqueness explicitly: not enforced by a DB constraint
      // because some legacy rows in the import may share or lack mitglnr.
      if (nextMitglnr) {
        const [dupe] = await context.db
          .select({ id: membersTable.id })
          .from(membersTable)
          .where(eq(membersTable.mitglnr, nextMitglnr))
          .limit(1);
        if (dupe) {
          throw new ORPCError("CONFLICT", {
            message: `Mitgliedsnummer ${nextMitglnr} ist bereits vergeben.`,
          });
        }
      }

      const now = new Date();
      const [inserted] = await context.db
        .insert(membersTable)
        .values({
          ...(patch as Record<string, unknown>),
          adrNr: nextAdrNr,
          mitglnr: nextMitglnr,
          createdAt: now,
          updatedAt: now,
        } as never)
        .returning({ id: membersTable.id, mitglnr: membersTable.mitglnr });
      if (!inserted) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Anlage fehlgeschlagen." });
      }

      await appendAudit(context.db, {
        entityType: "member",
        entityId: inserted.id,
        action: "create",
        source: "ui",
        actorId: context.session!.user.id,
        actorEmail: context.session!.user.email,
        changes: diff(null, { ...patch, adrNr: nextAdrNr, mitglnr: nextMitglnr }),
        requestId: context.requestId ?? null,
      });

      await invalidateMemberCaches();
      return { id: inserted.id, mitglnr: inserted.mitglnr ?? nextMitglnr, adrNr: nextAdrNr };
    }),

  softDelete: vorstandProc
    .input(v.object({ memberId: v.string() }))
    .handler(async ({ context, input }) => {
      const [existing] = await context.db
        .select()
        .from(membersTable)
        .where(eq(membersTable.id, input.memberId))
        .limit(1);
      if (!existing) {
        throw new ORPCError("NOT_FOUND", { message: "Mitglied nicht gefunden." });
      }
      if (existing.deletedAt) return { ok: true };

      await context.db
        .update(membersTable)
        .set({ deletedAt: new Date(), updatedAt: new Date() } as never)
        .where(eq(membersTable.id, input.memberId));

      await appendAudit(context.db, {
        entityType: "member",
        entityId: input.memberId,
        action: "delete",
        source: "ui",
        actorId: context.session!.user.id,
        actorEmail: context.session!.user.email,
        changes: { deletedAt: { before: null, after: new Date().toISOString() } },
        requestId: context.requestId ?? null,
      });

      await invalidateMemberCaches();
      return { ok: true };
    }),

  restore: vorstandProc
    .input(v.object({ memberId: v.string() }))
    .handler(async ({ context, input }) => {
      const [existing] = await context.db
        .select()
        .from(membersTable)
        .where(eq(membersTable.id, input.memberId))
        .limit(1);
      if (!existing) {
        throw new ORPCError("NOT_FOUND", { message: "Mitglied nicht gefunden." });
      }
      if (!existing.deletedAt) return { ok: true };

      const before = existing.deletedAt;
      await context.db
        .update(membersTable)
        .set({ deletedAt: null, updatedAt: new Date() } as never)
        .where(eq(membersTable.id, input.memberId));

      await appendAudit(context.db, {
        entityType: "member",
        entityId: input.memberId,
        action: "restore",
        source: "ui",
        actorId: context.session!.user.id,
        actorEmail: context.session!.user.email,
        changes: { deletedAt: { before: before?.toISOString() ?? null, after: null } },
        requestId: context.requestId ?? null,
      });

      await invalidateMemberCaches();
      return { ok: true };
    }),
};
