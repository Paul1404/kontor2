import { ORPCError } from "@orpc/server";
import { and, asc, count, desc, eq, ilike, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import * as v from "valibot";
import { appendAudit, diff } from "~/server/audit/log";
import { lastFour } from "~/server/crypto/encrypt";
import { abteilungenTable, memberAbteilungenTable } from "~/server/db/schema/abteilungen";
import { attachmentsTable } from "~/server/db/schema/attachments";
import { auditLogTable } from "~/server/db/schema/audit";
import { contractsTable } from "~/server/db/schema/contracts";
import { sollStellungenTable } from "~/server/db/schema/fee-runs";
import { membersTable } from "~/server/db/schema/members";
import { relationshipsTable } from "~/server/db/schema/relationships";
import { sepaMandatesTable } from "~/server/db/schema/sepa";
import { authedProc, vorstandProc } from "~/server/orpc/base";
import {
  getCached,
  invalidateMemberCaches,
  searchCacheKey,
  setCached,
} from "~/server/search/cache";
import { validateIban } from "~/server/sepa/iban";
import { takeMemberSnapshot } from "~/server/snapshots/snapshot";

const StatusSchema = v.picklist(["aktiv", "passiv", "ausgetreten", "verstorben", "alle"]);

const SortBySchema = v.picklist(["nachname", "mitglnr", "ort", "email", "eintritt"]);
const SortDirSchema = v.picklist(["asc", "desc"]);

const ListInput = v.object({
  q: v.optional(v.string(), ""),
  status: v.optional(StatusSchema, "aktiv"),
  abteilungId: v.optional(v.nullable(v.string()), null),
  includeAusgetretene: v.optional(v.boolean(), false),
  orphanOnly: v.optional(v.boolean(), false),
  page: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1)), 1),
  pageSize: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(200)), 50),
  sortBy: v.optional(SortBySchema, "nachname"),
  sortDir: v.optional(SortDirSchema, "asc"),
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
  geschlecht: v.optional(v.nullable(v.picklist(["m", "w", "d", "unbekannt"]))),
  strasse: v.optional(v.nullable(v.string())),
  hausnummer: v.optional(v.nullable(v.string())),
  adresszusatz: v.optional(v.nullable(v.string())),
  plz: v.optional(v.nullable(v.string())),
  ort: v.optional(v.nullable(v.string())),
  land: v.optional(v.nullable(v.string())),
  telefon1: v.optional(v.nullable(v.string())),
  telefon2: v.optional(v.nullable(v.string())),
  eMailName: v.optional(v.nullable(v.pipe(v.string(), v.email()))),
  www: v.optional(v.nullable(v.string())),
  firma1: v.optional(v.nullable(v.string())),
  funktion: v.optional(v.nullable(v.string())),
  spender: v.optional(v.nullable(v.string())),
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

/**
 * Parse a `YYYY-MM-DD`(`THH:MM:SS...`) string to a Date, or null for
 * an empty value. Rejects malformed input rather than silently returning
 * null — a user typo like "2025-13-45" should surface as a validation
 * error, not wipe the column to null.
 */
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
  setIfPresent("geschlecht");
  setIfPresent("strasse");
  setIfPresent("hausnummer");
  setIfPresent("adresszusatz");
  setIfPresent("plz");
  setIfPresent("ort");
  setIfPresent("land");
  setIfPresent("telefon1");
  setIfPresent("telefon2");
  setIfPresent("eMailName");
  setIfPresent("www");
  setIfPresent("firma1");
  setIfPresent("funktion");
  setIfPresent("spender");
  setIfPresent("aktivPasiv");
  setIfPresent("bank1");
  setIfPresent("bic1");
  setIfPresent("abwKontoInh");
  setIfPresent("mandatsrefenz");
  setIfPresent("notes");

  if ("geburtsdatum" in input)
    patch.geburtsdatum = toDateOrNull(input.geburtsdatum, "Geburtsdatum");
  if ("eintritt" in input) patch.eintritt = toDateOrNull(input.eintritt, "Eintritt");
  if ("austritt" in input) patch.austritt = toDateOrNull(input.austritt, "Austritt");
  if ("verstorbenAm" in input)
    patch.verstorbenAm = toDateOrNull(input.verstorbenAm, "Verstorben am");

  if ("iban1" in input) {
    const norm = normalizeIban(input.iban1);
    if (norm && !validateIban(norm)) {
      throw new ORPCError("VALIDATION_FAILED", {
        message: "IBAN ungültig (Prüfsumme fehlerhaft).",
      });
    }
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

    // "Verwaiste Kontakte" filter: Kontakt (no mitglnr) AND no relationship
    // pointing to or from this row. Used by admins to find Linear-import
    // leftovers.
    if (input.orphanOnly) {
      conditions.push(isNull(membersTable.mitglnr) as never);
      conditions.push(
        sql`not exists (
          select 1 from ${relationshipsTable}
          where ${relationshipsTable.fromMemberId} = ${membersTable.id}
             or ${relationshipsTable.toMemberId} = ${membersTable.id}
        )` as never,
      );
    }

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

    // Map the validated `sortBy` to its DB column so the UI can sort by
    // logical names without exposing column identifiers in the API.
    const sortColumn = {
      nachname: membersTable.nachname,
      mitglnr: membersTable.mitglnr,
      ort: membersTable.ort,
      email: membersTable.eMailName,
      eintritt: membersTable.eintritt,
    }[input.sortBy];
    const direction = input.sortDir === "desc" ? desc : asc;
    // Always tie-break on (nachname, vorname) so paging is stable when
    // the primary sort key is null/duplicated.
    const orderBy = [direction(sortColumn), asc(membersTable.nachname), asc(membersTable.vorname)];

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
        .orderBy(...orderBy)
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
      // Look up by mitglnr first (the normal member case). Legacy Linear
      // "Zahler-only" entries — people who pay for someone else's contract
      // but aren't members themselves — have no mitglnr; the list links
      // them by numeric adrNr instead. Fall back to that when the input
      // parses as an integer and no mitglnr match exists, so those rows
      // are still openable from the list and bookmarkable.
      const rows = await context.db
        .select()
        .from(membersTable)
        .where(eq(membersTable.mitglnr, input.mitgliedsnummer))
        .limit(1);
      let m = rows[0];
      if (!m) {
        const adrNrParsed = Number(input.mitgliedsnummer);
        if (Number.isInteger(adrNrParsed) && adrNrParsed > 0) {
          const fallback = await context.db
            .select()
            .from(membersTable)
            .where(eq(membersTable.adrNr, adrNrParsed))
            .limit(1);
          m = fallback[0];
        }
      }
      if (!m) throw new ORPCError("NOT_FOUND", { message: "Mitglied nicht gefunden." });

      const [abteilungen, vertraege, sepa, anhaenge, audit, beziehungen, sollstellungen] =
        await Promise.all([
          context.db
            .select({
              id: abteilungenTable.id,
              name: abteilungenTable.name,
              sportart: abteilungenTable.sportart,
              verbandName: abteilungenTable.verbandName,
              verbandNr: abteilungenTable.verbandNr,
              inaktiv: abteilungenTable.inaktiv,
              eintrittsdatum: memberAbteilungenTable.eintrittsdatum,
              austrittsdatum: memberAbteilungenTable.austrittsdatum,
            })
            .from(memberAbteilungenTable)
            .innerJoin(
              abteilungenTable,
              eq(abteilungenTable.id, memberAbteilungenTable.abteilungId),
            )
            .where(eq(memberAbteilungenTable.memberId, m.id))
            .orderBy(asc(abteilungenTable.name)),
          // Project only UI-needed columns. Notably, do NOT return the
          // `*_V` bank fields (kontoV/blzV/bankV/ktoInhV) which would leak
          // banking data to readonly users.
          context.db
            .select({
              id: contractsTable.id,
              vertragNr: contractsTable.vertragNr,
              art: contractsTable.art,
              artName: contractsTable.artName,
              betrag: contractsTable.betrag,
              aufnahmegeb: contractsTable.aufnahmegeb,
              sollstellung: contractsTable.sollstellung,
              vertragBegin: contractsTable.vertragBegin,
              vertragEnde: contractsTable.vertragEnde,
              gekuendAm: contractsTable.gekuendAm,
              gekuendZum: contractsTable.gekuendZum,
              lastschrift: contractsTable.lastschrift,
              abwKontoInh: contractsTable.abwKontoInh,
            })
            .from(contractsTable)
            .where(eq(contractsTable.memberId, m.id))
            .orderBy(desc(contractsTable.vertragBegin)),
          context.db
            .select({
              id: sepaMandatesTable.id,
              mandatsNr: sepaMandatesTable.mandatsNr,
              lastschriftart: sepaMandatesTable.lastschriftart,
              typ: sepaMandatesTable.typ,
              status: sepaMandatesTable.status,
              angelegtAm: sepaMandatesTable.angelegtAm,
              gultigBis: sepaMandatesTable.gultigBis,
              unterschriftDatum: sepaMandatesTable.unterschriftDatum,
              ersteVerwendung: sepaMandatesTable.ersteVerwendung,
              letzteVerwendung: sepaMandatesTable.letzteVerwendung,
              widerrufenAm: sepaMandatesTable.widerrufenAm,
              gueltigAb: sepaMandatesTable.gueltigAb,
              isDeleted: sepaMandatesTable.isDeleted,
            })
            .from(sepaMandatesTable)
            .where(eq(sepaMandatesTable.memberId, m.id))
            .orderBy(desc(sepaMandatesTable.angelegtAm)),
          context.db
            .select()
            .from(attachmentsTable)
            .where(eq(attachmentsTable.memberId, m.id))
            .orderBy(desc(attachmentsTable.uploadedAt)),
          // Audit history is sensitive: project only what the UI renders,
          // and gate the full feed to vorstand+ via the role check below.
          context.db
            .select({
              id: auditLogTable.id,
              action: auditLogTable.action,
              source: auditLogTable.source,
              actorEmail: auditLogTable.actorEmail,
              changes: auditLogTable.changes,
              createdAt: auditLogTable.createdAt,
            })
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
          // Sollstellung (Linear `mgsolln`): per-year posting for every
          // contract. Joined to contracts so the UI can show Bezeichnung
          // without a second roundtrip.
          context.db
            .select({
              id: sollStellungenTable.id,
              contractId: sollStellungenTable.contractId,
              vertragNr: contractsTable.vertragNr,
              artName: contractsTable.artName,
              billingYear: sollStellungenTable.billingYear,
              falligkeitsdatum: sollStellungenTable.falligkeitsdatum,
              amount: sollStellungenTable.amount,
              paidAmount: sollStellungenTable.paidAmount,
              openAmount: sollStellungenTable.openAmount,
              status: sollStellungenTable.status,
            })
            .from(sollStellungenTable)
            .innerJoin(contractsTable, eq(contractsTable.id, sollStellungenTable.contractId))
            .where(eq(sollStellungenTable.memberId, m.id))
            .orderBy(desc(sollStellungenTable.billingYear), asc(contractsTable.vertragNr)),
        ]);

      // The IBAN columns are AES-256-GCM ciphertext at rest but our custom
      // drizzle type decrypts on read. We expose iban1 in clear (the page
      // is gated to authed users; vorstand sees the full IBAN). iban2/iban3
      // are unused in the UI today, so drop their ciphertexts.
      const { iban2, iban3, ...stamm } = m;
      void iban2;
      void iban3;

      // Hide the audit trail from readonly viewers: revealing who edited
      // what when is operational metadata the vorstand owns.
      const role = (context.session?.user.role as string | undefined) ?? "readonly";
      const visibleAudit = role === "readonly" ? [] : audit;

      // Count of incoming relationships (others who point at this member)
      // — needed alongside outgoing `beziehungen` to detect orphan
      // Kontakts: a Kontakt without ANY relationship is dead data.
      const [incoming] = await context.db
        .select({ c: count() })
        .from(relationshipsTable)
        .where(eq(relationshipsTable.toMemberId, m.id));

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
        audit: visibleAudit,
        beziehungen,
        incomingBeziehungenCount: incoming?.c ?? 0,
        sollstellungen,
      };
    }),

  abteilungenList: authedProc.input(v.void()).handler(async ({ context }) => {
    return context.db
      .select({
        id: abteilungenTable.id,
        name: abteilungenTable.name,
        slug: abteilungenTable.slug,
        count: sql<number>`(select count(*)::int from member_abteilungen ma where ma.abteilung_id = abteilungen.id)`,
      })
      .from(abteilungenTable)
      .orderBy(asc(abteilungenTable.name));
  }),

  update: vorstandProc
    .input(v.object({ memberId: v.string(), patch: StammdatenInput }))
    .handler(async ({ context, input }) => {
      const result = await context.db.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(membersTable)
          .where(eq(membersTable.id, input.memberId))
          .limit(1);
        if (!existing) {
          throw new ORPCError("NOT_FOUND", { message: "Mitglied nicht gefunden." });
        }

        const patch = buildMemberPatch(input.patch);
        if (Object.keys(patch).length === 0) {
          return { mitglnr: existing.mitglnr };
        }

        // Build the projected next-state for the diff so the audit log
        // reflects the actual change, not the request shape.
        const projected: Record<string, unknown> = {
          ...(existing as Record<string, unknown>),
          ...patch,
        };

        await tx
          .update(membersTable)
          .set({ ...patch, updatedAt: new Date() } as never)
          .where(eq(membersTable.id, input.memberId));

        const changes = diff(existing as unknown as Record<string, unknown>, projected);
        let auditId: string | null = null;
        if (Object.keys(changes).length > 0) {
          auditId = await appendAudit(tx, {
            entityType: "member",
            entityId: input.memberId,
            action: "update",
            source: "ui",
            actorId: context.session!.user.id,
            actorEmail: context.session!.user.email,
            changes,
            requestId: context.requestId ?? null,
          });
          await takeMemberSnapshot(tx, input.memberId, {
            trigger: "mutation",
            actorId: context.session!.user.id,
            actorEmail: context.session!.user.email,
            auditId,
          });
        }

        return { mitglnr: existing.mitglnr };
      });

      await invalidateMemberCaches();
      return { ok: true, mitglnr: result.mitglnr };
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

      // Single transaction: pick the next AdrNr/Mitgliedsnummer and insert
      // atomically. Retry on serialization / unique-violation conflicts
      // (two concurrent creates racing for the same AdrNr).
      const MAX_RETRIES = 5;
      let lastError: unknown = null;
      for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
        try {
          const result = await context.db.transaction(async (tx) => {
            const [maxRow] = await tx
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

            if (nextMitglnr) {
              const [dupe] = await tx
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
            const [inserted] = await tx
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
              throw new ORPCError("INTERNAL_SERVER_ERROR", {
                message: "Anlage fehlgeschlagen.",
              });
            }

            const auditId = await appendAudit(tx, {
              entityType: "member",
              entityId: inserted.id,
              action: "create",
              source: "ui",
              actorId: context.session!.user.id,
              actorEmail: context.session!.user.email,
              changes: diff(null, { ...patch, adrNr: nextAdrNr, mitglnr: nextMitglnr }),
              requestId: context.requestId ?? null,
            });
            await takeMemberSnapshot(tx, inserted.id, {
              trigger: "mutation",
              actorId: context.session!.user.id,
              actorEmail: context.session!.user.email,
              auditId,
            });

            return {
              id: inserted.id,
              mitglnr: inserted.mitglnr ?? nextMitglnr,
              adrNr: nextAdrNr,
            };
          });

          await invalidateMemberCaches();
          return result;
        } catch (e) {
          lastError = e;
          // Postgres unique violation = 23505. Retry — the next iteration
          // will see the concurrent row's max and pick the next available.
          const code =
            (e as { code?: string; cause?: { code?: string } }).code ??
            (e as { code?: string; cause?: { code?: string } }).cause?.code;
          if (code !== "23505") throw e;
        }
      }
      throw (
        lastError ??
        new ORPCError("CONFLICT", {
          message: "Mitglied konnte wegen Konfliktes nicht angelegt werden.",
        })
      );
    }),

  softDelete: vorstandProc
    .input(v.object({ memberId: v.string() }))
    .handler(async ({ context, input }) => {
      await context.db.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(membersTable)
          .where(eq(membersTable.id, input.memberId))
          .limit(1);
        if (!existing) {
          throw new ORPCError("NOT_FOUND", { message: "Mitglied nicht gefunden." });
        }
        if (existing.deletedAt) return;

        const now = new Date();
        await tx
          .update(membersTable)
          .set({ deletedAt: now, updatedAt: now } as never)
          .where(eq(membersTable.id, input.memberId));

        const auditId = await appendAudit(tx, {
          entityType: "member",
          entityId: input.memberId,
          action: "delete",
          source: "ui",
          actorId: context.session!.user.id,
          actorEmail: context.session!.user.email,
          changes: { deletedAt: { before: null, after: now.toISOString() } },
          requestId: context.requestId ?? null,
        });
        await takeMemberSnapshot(tx, input.memberId, {
          trigger: "mutation",
          actorId: context.session!.user.id,
          actorEmail: context.session!.user.email,
          auditId,
        });
      });

      await invalidateMemberCaches();
      return { ok: true };
    }),

  restore: vorstandProc
    .input(v.object({ memberId: v.string() }))
    .handler(async ({ context, input }) => {
      await context.db.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(membersTable)
          .where(eq(membersTable.id, input.memberId))
          .limit(1);
        if (!existing) {
          throw new ORPCError("NOT_FOUND", { message: "Mitglied nicht gefunden." });
        }
        if (!existing.deletedAt) return;

        const before = existing.deletedAt;
        await tx
          .update(membersTable)
          .set({ deletedAt: null, updatedAt: new Date() } as never)
          .where(eq(membersTable.id, input.memberId));

        const auditId = await appendAudit(tx, {
          entityType: "member",
          entityId: input.memberId,
          action: "restore",
          source: "ui",
          actorId: context.session!.user.id,
          actorEmail: context.session!.user.email,
          changes: { deletedAt: { before: before?.toISOString() ?? null, after: null } },
          requestId: context.requestId ?? null,
        });
        await takeMemberSnapshot(tx, input.memberId, {
          trigger: "mutation",
          actorId: context.session!.user.id,
          actorEmail: context.session!.user.email,
          auditId,
        });
      });

      await invalidateMemberCaches();
      return { ok: true };
    }),

  /**
   * Lightweight typeahead used by the Cmd+K command palette. Returns only
   * the columns needed to render a result row + a link.
   */
  quickSearch: authedProc
    .input(
      v.object({
        q: v.pipe(v.string(), v.minLength(1)),
        limit: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(20)), 10),
      }),
    )
    .handler(async ({ context, input }) => {
      const like = `%${input.q.trim()}%`;
      const rows = await context.db
        .select({
          id: membersTable.id,
          mitglnr: membersTable.mitglnr,
          adrNr: membersTable.adrNr,
          vorname: membersTable.vorname,
          nachname: membersTable.nachname,
          ort: membersTable.ort,
        })
        .from(membersTable)
        .where(
          and(
            isNull(membersTable.deletedAt),
            or(
              ilike(membersTable.nachname, like),
              ilike(membersTable.vorname, like),
              ilike(membersTable.mitglnr, like),
              ilike(membersTable.eMailName, like),
            ),
          ),
        )
        .orderBy(asc(membersTable.nachname), asc(membersTable.vorname))
        .limit(input.limit);
      return { rows };
    }),
};
