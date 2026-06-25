import { ORPCError } from "@orpc/server";
import { and, asc, count, desc, eq, ilike, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import * as v from "valibot";
import { ABTEILUNG_NONE_FILTER } from "~/lib/abteilung-filter";
import { appendAudit, diff } from "~/server/audit/log";
import { lastFour } from "~/server/crypto/encrypt";
import { escapeLike } from "~/server/db/like";
import {
  memberHasDied,
  memberHasExited,
  memberHasPendingExit,
  memberHasRealAbteilung,
  memberIsPassiv,
  memberNotDeceased,
  memberNotDeleted,
  memberNotExited,
} from "~/server/db/member-filters";
import { withUniqueRetry } from "~/server/db/retry";
import { abteilungenTable, memberAbteilungenTable } from "~/server/db/schema/abteilungen";
import { attachmentsTable } from "~/server/db/schema/attachments";
import { auditLogTable } from "~/server/db/schema/audit";
import { contractsTable } from "~/server/db/schema/contracts";
import { sollStellungenTable } from "~/server/db/schema/fee-runs";
import { membersTable } from "~/server/db/schema/members";
import { organizationSettingsTable } from "~/server/db/schema/organization-settings";
import { relationshipsTable } from "~/server/db/schema/relationships";
import { sepaMandatesTable } from "~/server/db/schema/sepa";
import {
  deriveGeschlecht,
  deriveStatus,
  type MemberStatus,
  memberRef,
} from "~/server/domain/member";
import { onboardMember } from "~/server/domain/member/onboard";
import { generateMemberNumber } from "~/server/domain/member-number";
import { assertCancellationAllowed } from "~/server/lib/cancellation-frist";
import {
  planAustrittCascade,
  planReactivateCascade,
  toIsoDay,
} from "~/server/lib/member-lifecycle";
import { adminProc, authedProc, vorstandProc } from "~/server/orpc/base";
import {
  CACHE_NS,
  cached,
  getCached,
  invalidateMemberCaches,
  searchCacheKey,
  setCached,
} from "~/server/search/cache";
import { validateIban } from "~/server/sepa/iban";
import { takeMemberSnapshot } from "~/server/snapshots/snapshot";
import {
  type FieldResult,
  validateBic,
  validateEmail,
  validateGeburtsdatum,
  validatePhone,
  validatePlz,
} from "~/server/validation/member-fields";

const StatusSchema = v.picklist([
  "aktiv",
  "passiv",
  "gekuendigt",
  "ausgetreten",
  "verstorben",
  "alle",
]);

const SortBySchema = v.picklist(["nachname", "mitgliedsnummer", "ort", "email", "eintritt"]);
const SortDirSchema = v.picklist(["asc", "desc"]);

const DateStringInput = v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/));

const ListInput = v.object({
  q: v.optional(v.string(), ""),
  status: v.optional(StatusSchema, "aktiv"),
  abteilungId: v.optional(v.nullable(v.string()), null),
  includeAusgetretene: v.optional(v.boolean(), false),
  orphanOnly: v.optional(v.boolean(), false),
  deletedOnly: v.optional(v.boolean(), false),
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
  vorname: v.optional(v.nullable(v.string())),
  nachname: v.optional(v.nullable(v.string())),
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
  email: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.email()))),
  www: v.optional(v.nullable(v.string())),
  firma1: v.optional(v.nullable(v.string())),
  funktion: v.optional(v.nullable(v.string())),
  spender: v.optional(v.nullable(v.string())),
  eintritt: v.optional(v.nullable(v.string())),
  austritt: v.optional(v.nullable(v.string())),
  verstorbenAm: v.optional(v.nullable(v.string())),
  bic1: v.optional(v.nullable(v.string())),
  iban1: v.optional(v.nullable(v.string())),
  abwKontoInh: v.optional(v.nullable(v.string())),
  // Custom legal representative (gesetzliche Vertretung) for minors.
  vertreterAnrede: v.optional(v.nullable(v.string())),
  vertreterName: v.optional(v.nullable(v.string())),
  vertreterStrasse: v.optional(v.nullable(v.string())),
  vertreterHausnummer: v.optional(v.nullable(v.string())),
  vertreterPlz: v.optional(v.nullable(v.string())),
  vertreterOrt: v.optional(v.nullable(v.string())),
  notes: v.optional(v.nullable(v.string())),
  /** Suspends SEPA direct debit: the Beitragslauf skips this member. */
  directDebitBlocked: v.optional(v.nullable(v.boolean())),
  /** Ruhende Mitgliedschaft: still a member, but the Beitragslauf skips them. */
  ruhend: v.optional(v.nullable(v.boolean())),
  /** Beitragsbefreiung: exempt from fees; the Beitragslauf raises no posting. */
  beitragsbefreit: v.optional(v.nullable(v.boolean())),
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
  // `new Date` silently rolls day-overflow dates forward: "2025-02-30" becomes
  // March 2, "2025-02-29" (non-leap) becomes March 1. That passes the finite
  // check above but stores a different day than the user typed. For plain
  // YYYY-MM-DD input, require the parsed UTC date to match the components.
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (
    m &&
    (d.getUTCFullYear() !== Number(m[1]) ||
      d.getUTCMonth() + 1 !== Number(m[2]) ||
      d.getUTCDate() !== Number(m[3]))
  ) {
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

/** Validate and normalize a German-or-dot decimal Betrag string, or null. */
function validateBetragString(value: string | null | undefined, field: string): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) {
    throw new ORPCError("VALIDATION_FAILED", {
      message: `Ungültiger Betrag im Feld "${field}": ${value}`,
    });
  }
  return normalized;
}

/**
 * Translate the curated Stammdaten payload into a partial DB-row object,
 * coercing date strings to `Date` and computing `iban1Last4` when the IBAN
 * changes.
 */
/**
 * Derive the normalized lifecycle `status` from the form's exit/death dates.
 * aktiv vs passiv is no longer set here: it is derived on read from the
 * member's active Abteilungen, so the form only drives the lifecycle axis.
 */
function memberStatusFromForm(austritt: Date | null, verstorbenAm: Date | null): MemberStatus {
  return deriveStatus({ austritt, verstorbenAm });
}

function buildMemberPatch(input: v.InferOutput<typeof StammdatenInput>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const setIfPresent = <K extends keyof typeof input>(key: K, mapped?: string) => {
    if (key in input) {
      const raw = input[key];
      // Trim text input and fold blank/whitespace-only values to null. Without
      // this a name of "   " passes the "Vor- oder Nachname erforderlich" check
      // (it is truthy) and an untrimmed "  Müller " never matches the ilike
      // search or duplicate detection.
      const value = typeof raw === "string" ? raw.trim() || null : (raw ?? null);
      patch[mapped ?? (key as string)] = value;
    }
  };
  setIfPresent("anrede");
  setIfPresent("titel1");
  setIfPresent("vorname");
  setIfPresent("nachname");
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
  setIfPresent("email");
  setIfPresent("www");
  setIfPresent("firma1");
  setIfPresent("funktion");
  setIfPresent("spender");
  setIfPresent("bic1");
  setIfPresent("abwKontoInh");
  setIfPresent("vertreterAnrede");
  setIfPresent("vertreterName");
  setIfPresent("vertreterStrasse");
  setIfPresent("vertreterHausnummer");
  setIfPresent("vertreterPlz");
  setIfPresent("vertreterOrt");
  setIfPresent("notes");
  setIfPresent("directDebitBlocked");
  setIfPresent("ruhend");
  setIfPresent("beitragsbefreit");

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

  // Reject the same bad inputs the import gate flags, using the shared field
  // validators (issue #80) so the two surfaces cannot drift. Only fields
  // actually present in the patch are checked; an error-level result is a hard
  // reject (warnings are left to the Datenqualitaet view).
  const reject = (result: FieldResult): void => {
    if (result.level === "error") {
      throw new ORPCError("VALIDATION_FAILED", { message: result.message ?? "Eingabe ungültig." });
    }
  };
  if ("email" in input) reject(validateEmail(patch.email as string | null));
  if ("bic1" in input) reject(validateBic(patch.bic1 as string | null));
  if ("telefon1" in input) reject(validatePhone(patch.telefon1 as string | null));
  if ("telefon2" in input) reject(validatePhone(patch.telefon2 as string | null));
  if ("plz" in input) {
    reject(
      validatePlz(patch.plz as string | null, {
        land: ("land" in input ? (patch.land as string | null) : null) ?? undefined,
      }),
    );
  }
  if ("geburtsdatum" in input) reject(validateGeburtsdatum(patch.geburtsdatum as Date | null));

  return patch;
}

/** A leave (Austritt) cascade request. */
const AustrittInput = v.object({
  memberId: v.pipe(v.string(), v.uuid()),
  austrittDatum: DateStringInput,
  /** "verstorben" stamps verstorbenAm instead of austritt and skips the Frist. */
  reason: v.optional(v.picklist(["austritt", "verstorben"]), "austritt"),
  revokeSepa: v.optional(v.boolean(), true),
  /** Restrict the department closing; null/omitted closes all open ones. */
  abteilungIds: v.optional(v.nullable(v.array(v.string())), null),
});

/** One department assignment for the onboarding wizard. */
const OnboardAbteilung = v.object({
  abteilungId: v.pipe(v.string(), v.uuid()),
  eintrittsdatum: v.optional(v.nullable(DateStringInput)),
});

/** Optional first contract created during onboarding. */
const OnboardContract = v.object({
  art: v.pipe(v.number(), v.integer()),
  artName: v.optional(v.nullable(v.string())),
  vertragNr: v.optional(v.nullable(v.string())),
  betrag: v.optional(v.nullable(v.string())),
  vertragBegin: v.optional(v.nullable(DateStringInput)),
  sollstellung: v.optional(v.nullable(v.string())),
});

/** Optional first SEPA mandate created during onboarding. */
const OnboardSepa = v.object({
  mandatsNr: v.optional(v.nullable(v.string())),
  unterschriftDatum: v.optional(v.nullable(DateStringInput)),
  gueltigAb: v.optional(v.nullable(DateStringInput)),
});

export const membersRouter = {
  list: authedProc.input(ListInput).handler(async ({ context, input }) => {
    const cacheKey = searchCacheKey(context.tenant.key, input);
    const cached = await getCached<{ rows: unknown[]; total: number }>(cacheKey);
    if (cached) return cached;

    const conditions = [] as ReturnType<typeof eq>[];

    // The "Papierkorb" view shows only soft-deleted rows and ignores the
    // lifecycle status filters (a deleted member can be of any status). It is
    // the in-app entry point for restoring an accidental deletion.
    if (input.deletedOnly) {
      conditions.push(isNotNull(membersTable.deletedAt) as never);
    } else {
      // Hide soft-deleted members from every normal view. The legacy Linear
      // `geloscht` flag is folded into the app's single `deletedAt`.
      conditions.push(memberNotDeleted() as never);
    }

    // "Exited" means the Austritt date has actually arrived. A member who has
    // only given notice for a future date is still active and must stay in the
    // default and "aktiv"/"passiv" views (see `memberNotExited`).
    //
    // `status === "alle"` is the explicit "no lifecycle filter" request: it must
    // return the full union (aktiv + passiv + gekuendigt + ausgetreten +
    // verstorben + Kontakte), still respecting `deletedAt IS NULL`. Excluding it
    // here was the silent bug that made "alle" collapse to "aktiv" and dropped
    // every ausgetretenes Mitglied from exports and Serienbriefe.
    if (
      !input.deletedOnly &&
      !input.includeAusgetretene &&
      input.status !== "ausgetreten" &&
      input.status !== "alle"
    ) {
      conditions.push(memberNotExited() as never);
    }
    if (!input.deletedOnly && input.status === "ausgetreten") {
      conditions.push(memberHasExited() as never);
    }
    if (!input.deletedOnly && input.status === "verstorben") {
      conditions.push(memberHasDied() as never);
    }
    if (!input.deletedOnly && input.status === "gekuendigt") {
      // Notice given, leave date still in the future.
      conditions.push(memberHasPendingExit() as never);
    }
    if (!input.deletedOnly && input.status === "aktiv") {
      // "Aktiv" = lebendes Mitglied MIT aktiver Mitgliedschaft in einer echten
      // Abteilung -- spiegelt das Aktiv/Passiv-Badge (sport-aktiv vs. förderndes
      // Mitglied). Ohne `memberHasRealAbteilung` rutschten passive Mitglieder in
      // die Aktiv-Liste, obwohl ihr Badge "Passiv" zeigt. Aktiv + Passiv ergeben
      // zusammen die lebenden Mitglieder, disjunkt.
      conditions.push(memberNotExited() as never);
      conditions.push(memberNotDeceased() as never);
      conditions.push(memberHasRealAbteilung() as never);
    }
    if (!input.deletedOnly && input.status === "passiv") {
      // Passiv is derived, not stored: a live member with no active membership
      // in a real Abteilung. `memberIsPassiv` already excludes exited and
      // deceased members.
      conditions.push(memberIsPassiv() as never);
    }

    // "Verwaiste Kontakte" filter: Kontakt (no mitgliedsnummer) AND no relationship
    // pointing to or from this row. Used by admins to find Linear-import
    // leftovers.
    if (input.orphanOnly) {
      conditions.push(isNull(membersTable.memberNo) as never);
      conditions.push(
        sql`not exists (
          select 1 from ${relationshipsTable}
          where ${relationshipsTable.fromMemberId} = ${membersTable.id}
             or ${relationshipsTable.toMemberId} = ${membersTable.id}
        )` as never,
      );
    }

    if (input.q.trim()) {
      const like = `%${escapeLike(input.q.trim())}%`;
      conditions.push(
        or(
          ilike(membersTable.nachname, like),
          ilike(membersTable.vorname, like),
          ilike(membersTable.memberNo, like),
          ilike(membersTable.kontaktNo, like),
          ilike(membersTable.mitgliedsnummer, like),
          ilike(membersTable.email, like),
          ilike(membersTable.ort, like),
        ) as never,
      );
    }

    let memberIdsByAbt: string[] | null = null;
    if (input.abteilungId === ABTEILUNG_NONE_FILTER) {
      // "Ohne Abteilung": members with no active department membership. Surfaces
      // the Linear rows that carried no Abteilung (or only the "Keine-Abteilung"
      // sentinel) so the office can find and fix them.
      conditions.push(
        sql`not exists (
          select 1 from ${memberAbteilungenTable} ma
          where ma.member_id = ${membersTable.id} and ma.austrittsdatum is null
        )` as never,
      );
    } else if (input.abteilungId) {
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
      mitgliedsnummer: membersTable.mitgliedsnummer,
      ort: membersTable.ort,
      email: membersTable.email,
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
          memberNo: membersTable.memberNo,
          kontaktNo: membersTable.kontaktNo,
          mitgliedsnummer: membersTable.mitgliedsnummer,
          anrede: membersTable.anrede,
          titel: membersTable.titel1,
          vorname: membersTable.vorname,
          nachname: membersTable.nachname,
          plz: membersTable.plz,
          ort: membersTable.ort,
          email: membersTable.email,
          telefon: membersTable.telefon1,
          eintritt: membersTable.eintritt,
          austritt: membersTable.austritt,
          verstorbenAm: membersTable.verstorbenAm,
          status: membersTable.status,
          abteilung: membersTable.abteilung,
          deletedAt: membersTable.deletedAt,
          // Derived aktiv/passiv signal for the badge: true when the member
          // holds an active membership in a real Abteilung.
          hatAktiveAbteilung: memberHasRealAbteilung(),
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
      // The route param holds the record's reference. Resolve it against the
      // app-owned numbers first (member_no for members, kontakt_no for
      // contacts), then fall back to the preserved legacy Linear number so
      // references on old Mahnungen and bookmarks still open.
      const ref = input.mitgliedsnummer;
      const matchers = [
        eq(membersTable.memberNo, ref),
        eq(membersTable.kontaktNo, ref),
        eq(membersTable.mitgliedsnummer, ref),
      ];
      // Also resolve by the internal UUID id. Data-quality drill-downs and the
      // MCP audit reference records by their internal id, and a Kontakt without
      // a memberNo/kontaktNo was otherwise unreachable here. Guard the
      // comparison behind a UUID-shape check: `eq(uuid_col, 'M-123')` would
      // raise a Postgres "invalid input syntax for type uuid" for every
      // non-UUID ref, which previously surfaced as an opaque error (issue #82).
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref)) {
        matchers.push(eq(membersTable.id, ref));
      }
      const rows = await context.db
        .select()
        .from(membersTable)
        .where(or(...matchers))
        // A soft-deleted row can share a reused number with a live one (the
        // unique indexes are partial on deletedAt IS NULL). Prefer the live row
        // so a reference never resolves to the deleted predecessor.
        .orderBy(sql`${membersTable.deletedAt} asc nulls first`)
        .limit(1);
      let m = rows[0];
      if (!m) {
        // Transitional fallback: contacts used to be linked by bare numeric
        // adrNr. Keep this so old contact bookmarks resolve; remove next
        // release once links have rolled over to the K-number.
        const adrNrParsed = Number(ref);
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
              isDirectDebit: contractsTable.isDirectDebit,
              zahlerMemberId: contractsTable.zahlerMemberId,
              // Explicit, qualified correlation (contracts.zahler_member_id) so
              // Drizzle does not emit a bare "zahler_member_id" that the inner
              // `members z` could shadow.
              zahlerName: sql<
                string | null
              >`(select z.nachname || coalesce(', ' || z.vorname, '') from members z where z.id = contracts.zahler_member_id)`,
              zahlerRef: sql<
                string | null
              >`(select coalesce(z.member_no, z.kontakt_no, z.mitgliedsnummer) from members z where z.id = contracts.zahler_member_id)`,
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
              istVertreter: relationshipsTable.istVertreter,
              toMemberId: relationshipsTable.toMemberId,
              toAdrNr: relationshipsTable.toAdrNr,
              fallbackName: relationshipsTable.name,
              toMitglnr: membersTable.mitgliedsnummer,
              toVorname: membersTable.vorname,
              toNachname: membersTable.nachname,
              // Target address + birthday so the Austrittsbestätigung can
              // pull a Zahler/Vertreter recipient or a family member straight
              // from a relationship instead of retyping it.
              toAnrede: membersTable.anrede,
              toStrasse: membersTable.strasse,
              toHausnummer: membersTable.hausnummer,
              toPlz: membersTable.plz,
              toOrt: membersTable.ort,
              toGeburtsdatum: membersTable.geburtsdatum,
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

      // `iban1` is AES-256-GCM ciphertext at rest but our custom drizzle type
      // decrypts on read. Shallow-copy so we can null it for readonly viewers.
      const stamm = { ...m };

      // Readonly viewers get neither the cleartext IBAN nor the audit trail:
      // the full account number is financial PII the vorstand owns, and the
      // masked `iban1Last4` already covers what the page needs to show them.
      const role = (context.session?.user.role as string | undefined) ?? "readonly";
      const isReadonly = role === "readonly";
      if (isReadonly) stamm.iban1 = null;
      const visibleAudit = isReadonly ? [] : audit;

      // Count of incoming relationships (others who point at this member)
      // — needed alongside outgoing `beziehungen` to detect orphan
      // Kontakts: a Kontakt without ANY relationship is dead data.
      const [incoming] = await context.db
        .select({ c: count() })
        .from(relationshipsTable)
        .where(eq(relationshipsTable.toMemberId, m.id));

      return {
        // Keep the legacy output keys (sourced from the clean columns) so the
        // detail UI need not change here; the cosmetic API rename is a separate
        // pass.
        member: { ...stamm, mitgliedsnummer: stamm.mitgliedsnummer, email: stamm.email },
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

  /**
   * Cursor-paged export of the whole member base for AI/MCP clients (issue
   * #83), so a client can pull everyone in a few page calls instead of N
   * individual `get` lookups (which tripped the rate limit during the audit).
   * Keyset pagination on the internal id (stable, no offset drift). The full
   * IBAN is never exported; only the masked last four.
   */
  bulkExport: authedProc
    .input(
      v.object({
        cursor: v.optional(v.nullable(v.pipe(v.string(), v.uuid())), null),
        limit: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(500)), 200),
        includeDeleted: v.optional(v.boolean(), false),
      }),
    )
    .handler(async ({ context, input }) => {
      const conditions = [] as ReturnType<typeof eq>[];
      if (!input.includeDeleted) conditions.push(memberNotDeleted() as never);
      if (input.cursor) conditions.push(sql`${membersTable.id} > ${input.cursor}` as never);
      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const rows = await context.db
        .select({
          id: membersTable.id,
          adrNr: membersTable.adrNr,
          memberNo: membersTable.memberNo,
          kontaktNo: membersTable.kontaktNo,
          mitgliedsnummer: membersTable.mitgliedsnummer,
          anrede: membersTable.anrede,
          vorname: membersTable.vorname,
          nachname: membersTable.nachname,
          geschlecht: membersTable.geschlecht,
          geburtsdatum: membersTable.geburtsdatum,
          strasse: membersTable.strasse,
          hausnummer: membersTable.hausnummer,
          plz: membersTable.plz,
          ort: membersTable.ort,
          telefon1: membersTable.telefon1,
          telefon2: membersTable.telefon2,
          email: membersTable.email,
          iban1Last4: membersTable.iban1Last4,
          bic1: membersTable.bic1,
          status: membersTable.status,
          eintritt: membersTable.eintritt,
          austritt: membersTable.austritt,
          verstorbenAm: membersTable.verstorbenAm,
          beitragsbefreit: membersTable.beitragsbefreit,
          dunningBlocked: membersTable.dunningBlocked,
          directDebitBlocked: membersTable.directDebitBlocked,
        })
        .from(membersTable)
        .where(where)
        .orderBy(asc(membersTable.id))
        .limit(input.limit);

      // Another page exists only when this one filled the limit; the cursor is
      // the last id returned (keyset).
      const nextCursor = rows.length === input.limit ? (rows[rows.length - 1]?.id ?? null) : null;
      return { rows, nextCursor };
    }),

  abteilungenList: authedProc.input(v.void()).handler(async ({ context }) =>
    cached(context.tenant.key, CACHE_NS.abteilungen, "members-list", 300, () =>
      context.db
        .select({
          id: abteilungenTable.id,
          name: abteilungenTable.name,
          slug: abteilungenTable.slug,
          count: sql<number>`(select count(*)::int from member_abteilungen ma where ma.abteilung_id = abteilungen.id)`,
        })
        .from(abteilungenTable)
        .orderBy(asc(abteilungenTable.name)),
    ),
  ),

  /**
   * Counts by status for the Mitglieder overview strip. Buckets mirror the
   * list's status filter so a click on a stat maps 1:1 to a filter: "aktiv" =
   * lebendes Mitglied MIT echter Abteilung, "passiv" = lebendes Mitglied OHNE
   * (zusammen die Lebenden), exited/deceased getrennt. Soft-deleted rows
   * are excluded everywhere. Cached short-term in the dashboard namespace,
   * which is invalidated whenever a member changes.
   */
  stats: authedProc.input(v.void()).handler(async ({ context }) =>
    cached(context.tenant.key, CACHE_NS.dashboard, "members-stats", 120, async () => {
      const notDeleted = memberNotDeleted();
      // "Lebt": still a member today (a future-dated Austritt still counts).
      const lebt = and(notDeleted, memberNotExited(), memberNotDeceased());
      const [[total], [aktiv], [passiv], [gekuendigt], [ausgetreten], [verstorben], [kontakte]] =
        await Promise.all([
          context.db.select({ c: count() }).from(membersTable).where(notDeleted),
          context.db
            .select({ c: count() })
            .from(membersTable)
            .where(and(lebt, memberHasRealAbteilung())),
          context.db
            .select({ c: count() })
            .from(membersTable)
            .where(and(lebt, sql`not ${memberHasRealAbteilung()}`)),
          context.db
            .select({ c: count() })
            .from(membersTable)
            .where(and(notDeleted, memberHasPendingExit())),
          context.db
            .select({ c: count() })
            .from(membersTable)
            .where(and(notDeleted, memberHasExited())),
          context.db
            .select({ c: count() })
            .from(membersTable)
            .where(and(notDeleted, memberHasDied())),
          context.db
            .select({ c: count() })
            // Kontakte = rows without an app member number (kontaktNo set),
            // matching the orphanOnly filter. The legacy `mitgliedsnummer` is
            // null for every in-app-created member too, so using it here would
            // miscount real members as Kontakte.
            .from(membersTable)
            .where(and(notDeleted, isNull(membersTable.memberNo))),
        ]);
      return {
        total: total?.c ?? 0,
        aktiv: aktiv?.c ?? 0,
        passiv: passiv?.c ?? 0,
        gekuendigt: gekuendigt?.c ?? 0,
        ausgetreten: ausgetreten?.c ?? 0,
        verstorben: verstorben?.c ?? 0,
        kontakte: kontakte?.c ?? 0,
      };
    }),
  ),

  update: vorstandProc
    .input(
      v.object({
        memberId: v.string(),
        patch: StammdatenInput,
        // Optimistic-lock token: the `updatedAt` the editor loaded. When two
        // people edit the same member, the second save is rejected instead of
        // silently clobbering the first. Optional so other callers stay valid.
        expectedUpdatedAt: v.optional(v.nullable(v.string()), null),
      }),
    )
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

        // Conflict detection. Both the editor's token and `existing.updatedAt`
        // come back through the same Drizzle timestamptz->Date read, so an
        // unchanged row compares equal to the millisecond.
        if (input.expectedUpdatedAt) {
          const expectedMs = new Date(input.expectedUpdatedAt).getTime();
          if (!Number.isFinite(expectedMs)) {
            throw new ORPCError("VALIDATION_FAILED", {
              message: "Ungültiger Bearbeitungsstand. Bitte Seite neu laden.",
            });
          }
          const currentMs = existing.updatedAt?.getTime() ?? null;
          // A missing current timestamp or a mismatch both mean we can't prove
          // the row is unchanged -- refuse rather than silently clobber.
          if (currentMs === null || currentMs !== expectedMs) {
            throw new ORPCError("CONFLICT", {
              message:
                "Die Daten wurden zwischenzeitlich von jemand anderem geändert. Bitte Seite neu laden und erneut speichern.",
            });
          }
        }

        const patch = buildMemberPatch(input.patch);
        if (Object.keys(patch).length === 0) {
          return { mitgliedsnummer: existing.mitgliedsnummer };
        }

        // Enforce the configurable Kündigungsfrist only when the Austritt is
        // newly set or changed. No-op when the feature is disabled.
        if (
          patch.austritt instanceof Date &&
          patch.austritt.getTime() !== existing.austritt?.getTime()
        ) {
          const [settings] = await tx.select().from(organizationSettingsTable).limit(1);
          assertCancellationAllowed(settings, patch.austritt);
        }

        // Build the projected next-state for the diff so the audit log
        // reflects the actual change, not the request shape.
        const projected: Record<string, unknown> = {
          ...(existing as Record<string, unknown>),
          ...patch,
        };

        // Keep the normalized `status` in sync with the A/P toggle and the
        // exit/death dates. `email` is written straight from the patch; the
        // other clean columns (mitgliedsnummer, dunning_blocked) are not edited
        // here, so they are left untouched.
        const nextStatus = memberStatusFromForm(
          (projected.austritt as Date | null) ?? null,
          (projected.verstorbenAm as Date | null) ?? null,
        );
        patch.status = nextStatus;
        projected.status = nextStatus;

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

        return { mitgliedsnummer: existing.mitgliedsnummer };
      });

      await invalidateMemberCaches(context.tenant.key);
      return { ok: true, mitgliedsnummer: result.mitgliedsnummer };
    }),

  /**
   * Replace a member's active Abteilungen with the given set. Currently active
   * memberships (austrittsdatum null) that are not in the set get closed
   * (austrittsdatum = today); ids not yet active are added (eintrittsdatum =
   * today). Lets a member be moved between departments without the full
   * onboarding wizard. Audited and snapshotted.
   */
  setAbteilungen: vorstandProc
    .input(
      v.object({
        memberId: v.pipe(v.string(), v.uuid()),
        abteilungIds: v.array(v.pipe(v.string(), v.uuid())),
      }),
    )
    .handler(async ({ context, input }) => {
      const desired = [...new Set(input.abteilungIds)];
      const result = await context.db.transaction(async (tx) => {
        const [member] = await tx
          .select({ id: membersTable.id, mitgliedsnummer: membersTable.mitgliedsnummer })
          .from(membersTable)
          .where(eq(membersTable.id, input.memberId))
          .limit(1);
        if (!member) {
          throw new ORPCError("NOT_FOUND", { message: "Mitglied nicht gefunden." });
        }
        if (desired.length > 0) {
          const found = await tx
            .select({ id: abteilungenTable.id })
            .from(abteilungenTable)
            .where(inArray(abteilungenTable.id, desired));
          if (found.length !== desired.length) {
            throw new ORPCError("NOT_FOUND", { message: "Abteilung nicht gefunden." });
          }
        }

        const current = await tx
          .select({ abteilungId: memberAbteilungenTable.abteilungId })
          .from(memberAbteilungenTable)
          .where(
            and(
              eq(memberAbteilungenTable.memberId, input.memberId),
              isNull(memberAbteilungenTable.austrittsdatum),
            ),
          );
        const currentIds = new Set(current.map((r) => r.abteilungId));
        const desiredSet = new Set(desired);
        const toClose = [...currentIds].filter((id) => !desiredSet.has(id));
        const toAdd = desired.filter((id) => !currentIds.has(id));

        const today = new Date().toISOString().slice(0, 10);
        if (toClose.length > 0) {
          await tx
            .update(memberAbteilungenTable)
            .set({ austrittsdatum: today })
            .where(
              and(
                eq(memberAbteilungenTable.memberId, input.memberId),
                isNull(memberAbteilungenTable.austrittsdatum),
                inArray(memberAbteilungenTable.abteilungId, toClose),
              ),
            );
        }
        for (const abteilungId of toAdd) {
          await tx
            .insert(memberAbteilungenTable)
            .values({ memberId: input.memberId, abteilungId, eintrittsdatum: today })
            .onConflictDoNothing();
        }

        if (toClose.length > 0 || toAdd.length > 0) {
          const auditId = await appendAudit(tx, {
            entityType: "member",
            entityId: input.memberId,
            action: "update",
            source: "ui",
            actorId: context.session!.user.id,
            actorEmail: context.session!.user.email,
            changes: {
              abteilungenAdded: { before: null, after: toAdd.length },
              abteilungenClosed: { before: null, after: toClose.length },
            },
            requestId: context.requestId ?? null,
          });
          await takeMemberSnapshot(tx, input.memberId, {
            trigger: "mutation",
            actorId: context.session!.user.id,
            actorEmail: context.session!.user.email,
            auditId,
          });
        }

        return {
          mitgliedsnummer: member.mitgliedsnummer,
          added: toAdd.length,
          closed: toClose.length,
        };
      });
      await invalidateMemberCaches(context.tenant.key);
      return { ok: true as const, ...result };
    }),

  create: vorstandProc
    .input(
      v.object({
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
      // Seed the explicit gender from the Anrede when the form left it open, so
      // a new member is not silently "unbekannt" on the dashboard.
      if (patch.geschlecht == null) {
        patch.geschlecht = deriveGeschlecht(input.patch.anrede);
      }

      // Single transaction: allocate the internal AdrNr (still a sequential
      // join key) and mint an opaque app-owned member number, then insert.
      // `withUniqueRetry` re-runs the whole transaction on a 23505 so a racing
      // AdrNr or a member_no collision picks fresh values on the next attempt.
      const result = await withUniqueRetry(() =>
        context.db.transaction(async (tx) => {
          const [maxRow] = await tx
            .select({
              maxAdrNr: sql<number>`coalesce(max(${membersTable.adrNr}), 0)::int`,
            })
            .from(membersTable);
          const nextAdrNr = (maxRow?.maxAdrNr ?? 0) + 1;
          const memberNo = generateMemberNumber("member");

          const now = new Date();
          // Write the clean columns directly so a newly created member is
          // consistent without waiting for an import. `email` is already in
          // the patch. App-created members have no legacy Linear number, so
          // `mitgliedsnummer` stays null.
          const cleanCols = {
            memberNo,
            status: memberStatusFromForm(
              (patch.austritt as Date | null) ?? null,
              (patch.verstorbenAm as Date | null) ?? null,
            ),
            dunningBlocked: false,
            directDebitBlocked: false,
          };
          const [inserted] = await tx
            .insert(membersTable)
            .values({
              ...(patch as Record<string, unknown>),
              adrNr: nextAdrNr,
              ...cleanCols,
              createdAt: now,
              updatedAt: now,
            } as never)
            .returning({ id: membersTable.id, memberNo: membersTable.memberNo });
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
            changes: diff(null, {
              ...patch,
              adrNr: nextAdrNr,
              ...cleanCols,
            }),
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
            memberNo: inserted.memberNo ?? memberNo,
            adrNr: nextAdrNr,
          };
        }),
      );

      await invalidateMemberCaches(context.tenant.key);
      return result;
    }),

  /**
   * Merge a duplicate member ("loser") into a surviving one ("winner"): every
   * child record (contracts, SEPA mandates, postings, relationships, Ehrungen,
   * Abteilungen, tasks, documents, consents, ...) is repointed from the loser
   * to the winner, then the loser is soft-deleted. The winner's own Stammdaten
   * are left untouched.
   *
   * The legacy mirror keys several tables on `adrNr` with a uniqueness
   * constraint (contracts, SEPA mandates, relationships, Ehrungen, Abteilungen,
   * source records). A loser row that would collide with one the winner already
   * has is LEFT on the loser instead of crashing the merge; it stays reachable
   * on the soft-deleted record and is counted in `skipped`. Nothing is
   * hard-deleted, so the soft-deleted loser row plus the audit entry keep the
   * merge reversible by hand.
   *
   * Postings (soll_stellungen, fee_run_items) follow their contract's new owner
   * so a skipped contract never leaves an orphaned posting on the winner.
   *
   * Destructive and admin-only; callers must pass `confirm: true`.
   */
  merge: adminProc
    .input(
      v.object({
        winnerId: v.string(),
        loserId: v.string(),
        confirm: v.literal(true),
      }),
    )
    .handler(async ({ context, input }) => {
      if (input.winnerId === input.loserId) {
        throw new ORPCError("VALIDATION_FAILED", {
          message: "Zielmitglied und Quellmitglied müssen unterschiedlich sein.",
        });
      }
      const result = await context.db.transaction(async (tx) => {
        const rows = await tx
          .select({
            id: membersTable.id,
            adrNr: membersTable.adrNr,
            memberNo: membersTable.memberNo,
            kontaktNo: membersTable.kontaktNo,
            mitgliedsnummer: membersTable.mitgliedsnummer,
            deletedAt: membersTable.deletedAt,
          })
          .from(membersTable)
          .where(inArray(membersTable.id, [input.winnerId, input.loserId]));
        const winner = rows.find((r) => r.id === input.winnerId);
        const loser = rows.find((r) => r.id === input.loserId);
        if (!winner || !loser) {
          throw new ORPCError("NOT_FOUND", { message: "Mitglied nicht gefunden." });
        }
        if (winner.deletedAt) {
          throw new ORPCError("CONFLICT", { message: "Das Zielmitglied ist gelöscht." });
        }
        if (loser.deletedAt) {
          throw new ORPCError("CONFLICT", { message: "Das Quellmitglied ist bereits gelöscht." });
        }

        const w = input.winnerId;
        const l = input.loserId;
        const wAdr = winner.adrNr;
        const lAdr = loser.adrNr;
        const moved: Record<string, number> = {};
        const skipped: Record<string, number> = {};

        const runCount = async (q: ReturnType<typeof sql>): Promise<number> =>
          ((await tx.execute(q)) as unknown as unknown[]).length;
        const leftover = async (table: string): Promise<number> => {
          const r = (await tx.execute(
            sql`select count(*)::int as c from ${sql.raw(table)} where member_id = ${l}`,
          )) as unknown as Array<{ c: number }>;
          return Number(r[0]?.c ?? 0);
        };

        // -- contracts: repoint member + adrNr; skip (adrNr, vertragNr, art) dups.
        moved.contracts = await runCount(sql`
          update contracts t set member_id = ${w}, adr_nr = ${wAdr}
          where t.member_id = ${l}
            and not exists (
              select 1 from contracts x
              where x.adr_nr = ${wAdr} and x.vertrag_nr = t.vertrag_nr and x.art = t.art
            )
          returning t.id`);
        skipped.contracts = await leftover("contracts");
        // Alternate-payer pointer (abweichende AdrNr) follows the merge too.
        await tx.execute(sql`update contracts set abw_adr_nr = ${wAdr} where abw_adr_nr = ${lAdr}`);

        // -- postings follow their contract's (possibly unchanged) owner.
        moved.sollStellungen = await runCount(sql`
          update soll_stellungen s set member_id = c.member_id
          from contracts c where s.contract_id = c.id and s.member_id = ${l} returning s.id`);
        moved.feeRunItems = await runCount(sql`
          update fee_run_items s set member_id = c.member_id
          from contracts c where s.contract_id = c.id and s.member_id = ${l} returning s.id`);

        // -- SEPA mandates: repoint member + adrNr; skip (adrNr, mandatsNr) dups.
        moved.sepaMandates = await runCount(sql`
          update sepa_mandates t set member_id = ${w}, adr_nr = ${wAdr}
          where t.member_id = ${l}
            and not exists (
              select 1 from sepa_mandates x where x.adr_nr = ${wAdr} and x.mandats_nr = t.mandats_nr
            )
          returning t.id`);
        skipped.sepaMandates = await leftover("sepa_mandates");

        // -- Ehrungen: skip on the partial unique (member_id, jubilaeum_jahre).
        moved.ehrungen = await runCount(sql`
          update ehrungen t set member_id = ${w}
          where t.member_id = ${l}
            and not exists (
              select 1 from ehrungen x
              where x.member_id = ${w} and x.jubilaeum_jahre = t.jubilaeum_jahre
                and x.jubilaeum_jahre is not null and x.deleted_at is null
            )
          returning t.id`);
        skipped.ehrungen = await leftover("ehrungen");

        // -- Abteilungen: skip on PK (member_id, abteilung_id, eintrittsdatum).
        moved.abteilungen = await runCount(sql`
          update member_abteilungen t set member_id = ${w}
          where t.member_id = ${l}
            and not exists (
              select 1 from member_abteilungen x
              where x.member_id = ${w} and x.abteilung_id = t.abteilung_id
                and x.eintrittsdatum = t.eintrittsdatum
            )
          returning t.member_id`);
        skipped.abteilungen = await leftover("member_abteilungen");

        // -- Source records: repoint member + adrNr; skip (member_id, source_table) dups.
        moved.sourceRecords = await runCount(sql`
          update member_source_records t set member_id = ${w}, adr_nr = ${wAdr}
          where t.member_id = ${l}
            and not exists (
              select 1 from member_source_records x
              where x.member_id = ${w} and x.source_table = t.source_table
            )
          returning t.id`);
        skipped.sourceRecords = await leftover("member_source_records");

        // -- Relationships: drop the loser<->winner edge (no self-links), then
        // repoint each side, skipping rows that would duplicate (from_adr_nr,
        // to_adr_nr); leftover loser edges are redundant and removed.
        await tx.execute(sql`
          delete from relationships
          where (from_member_id = ${l} and to_member_id = ${w})
             or (from_member_id = ${w} and to_member_id = ${l})`);
        const movedFrom = await runCount(sql`
          update relationships t set from_member_id = ${w}, from_adr_nr = ${wAdr}
          where t.from_member_id = ${l}
            and not exists (
              select 1 from relationships x where x.from_adr_nr = ${wAdr} and x.to_adr_nr = t.to_adr_nr
            )
          returning t.id`);
        const movedTo = await runCount(sql`
          update relationships t set to_member_id = ${w}, to_adr_nr = ${wAdr}
          where t.to_member_id = ${l}
            and not exists (
              select 1 from relationships x where x.from_adr_nr = t.from_adr_nr and x.to_adr_nr = ${wAdr}
            )
          returning t.id`);
        moved.relationships = movedFrom + movedTo;
        const relLeft = (await tx.execute(
          sql`select count(*)::int as c from relationships where from_member_id = ${l} or to_member_id = ${l}`,
        )) as unknown as Array<{ c: number }>;
        skipped.relationships = Number(relLeft[0]?.c ?? 0);
        await tx.execute(
          sql`delete from relationships where from_member_id = ${l} or to_member_id = ${l}`,
        );

        // -- Plain member_id tables: no member-scoped uniqueness, repoint all.
        const simpleTables = [
          "member_tasks",
          "attachments",
          "pending_uploads",
          "portal_tokens",
          "portal_sessions",
          "portal_change_requests",
          "dsgvo_requests",
          "dsgvo_consent_log",
          "cancellation_letters",
          "rundschreiben_recipients",
          "membership_applications",
          "sepa_returns",
          "dunning_items",
        ];
        for (const table of simpleTables) {
          moved[table] = await runCount(
            sql`update ${sql.raw(table)} set member_id = ${w} where member_id = ${l} returning member_id`,
          );
        }

        // -- Soft-delete the loser; its row and any skipped children remain.
        await tx.update(membersTable).set({ deletedAt: new Date() }).where(eq(membersTable.id, l));

        const winnerRef = memberRef(winner);
        const loserRef = memberRef(loser);
        const auditId = await appendAudit(tx, {
          entityType: "member",
          entityId: l,
          action: "delete",
          source: "ui",
          actorId: context.session!.user.id,
          actorEmail: context.session!.user.email,
          changes: {
            __mergedInto: { before: null, after: winnerRef },
            __moved: { before: null, after: JSON.stringify(moved) },
            __skipped: { before: null, after: JSON.stringify(skipped) },
          },
          requestId: context.requestId ?? null,
        });
        await takeMemberSnapshot(tx, w, {
          trigger: "mutation",
          actorId: context.session!.user.id,
          actorEmail: context.session!.user.email,
          auditId,
        });

        return { winnerId: w, loserId: l, winnerRef, loserRef, moved, skipped };
      });
      await invalidateMemberCaches(context.tenant.key);
      return result;
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

      await invalidateMemberCaches(context.tenant.key);
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

      await invalidateMemberCaches(context.tenant.key);
      return { ok: true };
    }),

  /**
   * Bulk-apply one action to many members in a single transaction. Each
   * affected member gets its own audit entry + snapshot so the change is
   * fully reversible and attributable, exactly like the single-record
   * mutations above. Members that already match the target state (or that
   * no longer exist / are soft-deleted) are counted as `skipped`, not
   * failed, so a partially-applicable selection still succeeds.
   */
  bulk: vorstandProc
    .input(
      v.object({
        memberIds: v.pipe(
          v.array(v.pipe(v.string(), v.uuid())),
          v.minLength(1, "Keine Mitglieder ausgewählt."),
          v.maxLength(500, "Zu viele Mitglieder auf einmal (max. 500)."),
        ),
        action: v.variant("type", [
          v.object({ type: v.literal("addAbteilung"), abteilungId: v.pipe(v.string(), v.uuid()) }),
          v.object({
            type: v.literal("removeAbteilung"),
            abteilungId: v.pipe(v.string(), v.uuid()),
          }),
          v.object({ type: v.literal("setDunningBlocked"), value: v.boolean() }),
          v.object({ type: v.literal("setDirectDebitBlocked"), value: v.boolean() }),
          v.object({ type: v.literal("softDelete") }),
        ]),
      }),
    )
    .handler(async ({ context, input }) => {
      const actorId = context.session!.user.id;
      const actorEmail = context.session!.user.email;
      const requestId = context.requestId ?? null;
      // Dedupe so a member selected twice (shouldn't happen from the UI,
      // but the input is user-controlled) is only touched once.
      const ids = [...new Set(input.memberIds)];
      const today = new Date().toISOString().slice(0, 10);

      const result = await context.db.transaction(async (tx) => {
        let abteilungName: string | null = null;
        if (input.action.type === "addAbteilung" || input.action.type === "removeAbteilung") {
          const [abt] = await tx
            .select({ id: abteilungenTable.id, name: abteilungenTable.name })
            .from(abteilungenTable)
            .where(eq(abteilungenTable.id, input.action.abteilungId))
            .limit(1);
          if (!abt) throw new ORPCError("NOT_FOUND", { message: "Abteilung nicht gefunden." });
          abteilungName = abt.name;
        }

        let changed = 0;
        let skipped = 0;

        for (const memberId of ids) {
          const [existing] = await tx
            .select()
            .from(membersTable)
            .where(and(eq(membersTable.id, memberId), isNull(membersTable.deletedAt)))
            .limit(1);
          if (!existing) {
            skipped += 1;
            continue;
          }

          if (input.action.type === "addAbteilung") {
            // Skip members that already hold an active membership in this
            // Abteilung (austrittsdatum is null) — re-adding would be a no-op.
            const [active] = await tx
              .select({ memberId: memberAbteilungenTable.memberId })
              .from(memberAbteilungenTable)
              .where(
                and(
                  eq(memberAbteilungenTable.memberId, memberId),
                  eq(memberAbteilungenTable.abteilungId, input.action.abteilungId),
                  isNull(memberAbteilungenTable.austrittsdatum),
                ),
              )
              .limit(1);
            if (active) {
              skipped += 1;
              continue;
            }
            await tx
              .insert(memberAbteilungenTable)
              .values({
                memberId,
                abteilungId: input.action.abteilungId,
                eintrittsdatum: today,
              })
              .onConflictDoNothing();
            const auditId = await appendAudit(tx, {
              entityType: "member",
              entityId: memberId,
              action: "update",
              source: "ui",
              actorId,
              actorEmail,
              changes: {
                [`abteilung:${abteilungName}`]: {
                  before: null,
                  after: { eintrittsdatum: today },
                },
              },
              requestId,
            });
            await takeMemberSnapshot(tx, memberId, {
              trigger: "mutation",
              actorId,
              actorEmail,
              auditId,
            });
            changed += 1;
          } else if (
            input.action.type === "setDunningBlocked" ||
            input.action.type === "setDirectDebitBlocked"
          ) {
            // Bulk toggle a member flag (Mahnsperre / Einzugsperre). Skip rows
            // already in the desired state so `changed` reflects real work.
            const column =
              input.action.type === "setDunningBlocked" ? "dunningBlocked" : "directDebitBlocked";
            const current =
              column === "dunningBlocked" ? existing.dunningBlocked : existing.directDebitBlocked;
            if (current === input.action.value) {
              skipped += 1;
              continue;
            }
            await tx
              .update(membersTable)
              .set({ [column]: input.action.value, updatedAt: new Date() } as never)
              .where(eq(membersTable.id, memberId));
            const auditId = await appendAudit(tx, {
              entityType: "member",
              entityId: memberId,
              action: "update",
              source: "ui",
              actorId,
              actorEmail,
              changes: { [column]: { before: current, after: input.action.value } },
              requestId,
            });
            await takeMemberSnapshot(tx, memberId, {
              trigger: "mutation",
              actorId,
              actorEmail,
              auditId,
            });
            changed += 1;
          } else if (input.action.type === "softDelete") {
            // Bulk move to the Papierkorb. Reversible via the per-member
            // restore; already-deleted rows are filtered out by the select
            // above, so reaching here always means a real transition.
            const now = new Date();
            await tx
              .update(membersTable)
              .set({ deletedAt: now, updatedAt: now } as never)
              .where(eq(membersTable.id, memberId));
            const auditId = await appendAudit(tx, {
              entityType: "member",
              entityId: memberId,
              action: "delete",
              source: "ui",
              actorId,
              actorEmail,
              changes: { deletedAt: { before: null, after: now.toISOString() } },
              requestId,
            });
            await takeMemberSnapshot(tx, memberId, {
              trigger: "mutation",
              actorId,
              actorEmail,
              auditId,
            });
            changed += 1;
          } else {
            // removeAbteilung: close out every active membership in this
            // Abteilung by stamping today's austrittsdatum. Non-destructive
            // (the row + its history stay) and reversible via snapshot.
            const closed = await tx
              .update(memberAbteilungenTable)
              .set({ austrittsdatum: today })
              .where(
                and(
                  eq(memberAbteilungenTable.memberId, memberId),
                  eq(memberAbteilungenTable.abteilungId, input.action.abteilungId),
                  isNull(memberAbteilungenTable.austrittsdatum),
                ),
              )
              .returning({ memberId: memberAbteilungenTable.memberId });
            if (closed.length === 0) {
              skipped += 1;
              continue;
            }
            const auditId = await appendAudit(tx, {
              entityType: "member",
              entityId: memberId,
              action: "update",
              source: "ui",
              actorId,
              actorEmail,
              changes: {
                [`abteilung:${abteilungName}`]: {
                  before: { austrittsdatum: null },
                  after: { austrittsdatum: today },
                },
              },
              requestId,
            });
            await takeMemberSnapshot(tx, memberId, {
              trigger: "mutation",
              actorId,
              actorEmail,
              auditId,
            });
            changed += 1;
          }
        }

        return { changed, skipped };
      });

      await invalidateMemberCaches(context.tenant.key);
      return { ok: true, ...result };
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
      const like = `%${escapeLike(input.q.trim())}%`;
      const rows = await context.db
        .select({
          id: membersTable.id,
          memberNo: membersTable.memberNo,
          kontaktNo: membersTable.kontaktNo,
          mitgliedsnummer: membersTable.mitgliedsnummer,
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
              ilike(membersTable.memberNo, like),
              ilike(membersTable.kontaktNo, like),
              ilike(membersTable.mitgliedsnummer, like),
              ilike(membersTable.email, like),
            ),
          ),
        )
        .orderBy(asc(membersTable.nachname), asc(membersTable.vorname))
        .limit(input.limit);
      return { rows };
    }),

  /**
   * Let a member leave the club in one action. Stamps the leave date on the
   * member and cascades it to every still-open department membership, open
   * contract and (optionally) active SEPA mandate, so the member's records
   * end up internally consistent instead of half-closed. Reversible via
   * `reactivate`. Pure decision logic lives in `~/server/lib/member-lifecycle`.
   */
  austritt: vorstandProc.input(AustrittInput).handler(async ({ context, input }) => {
    const austrittTs = new Date(`${input.austrittDatum}T00:00:00Z`);
    const today = new Date();

    const result = await context.db.transaction(async (tx) => {
      const [member] = await tx
        .select()
        .from(membersTable)
        .where(eq(membersTable.id, input.memberId))
        .limit(1);
      if (!member) throw new ORPCError("NOT_FOUND", { message: "Mitglied nicht gefunden." });

      // Kündigungsfrist applies to a voluntary Austritt, not to recording a
      // death (which is typically backdated).
      if (input.reason === "austritt") {
        const [settings] = await tx.select().from(organizationSettingsTable).limit(1);
        assertCancellationAllowed(settings, austrittTs);
      }

      const [abteilungen, contracts, sepa] = await Promise.all([
        tx
          .select({
            abteilungId: memberAbteilungenTable.abteilungId,
            eintrittsdatum: memberAbteilungenTable.eintrittsdatum,
            austrittsdatum: memberAbteilungenTable.austrittsdatum,
          })
          .from(memberAbteilungenTable)
          .where(eq(memberAbteilungenTable.memberId, input.memberId)),
        tx
          .select({ id: contractsTable.id, gekuendZum: contractsTable.gekuendZum })
          .from(contractsTable)
          .where(eq(contractsTable.memberId, input.memberId)),
        tx
          .select({
            id: sepaMandatesTable.id,
            isDeleted: sepaMandatesTable.isDeleted,
            widerrufenAm: sepaMandatesTable.widerrufenAm,
          })
          .from(sepaMandatesTable)
          .where(eq(sepaMandatesTable.memberId, input.memberId)),
      ]);

      const plan = planAustrittCascade({
        austrittDatum: input.austrittDatum,
        abteilungen,
        contracts,
        sepa,
        revokeSepa: input.revokeSepa,
        abteilungIds: input.abteilungIds,
      });

      // Member row: stamp the leave/death date.
      const memberSet: Record<string, unknown> = { updatedAt: today };
      if (input.reason === "verstorben") {
        memberSet.verstorbenAm = austrittTs;
      } else {
        memberSet.austritt = austrittTs;
      }
      // Normalized status as of today: a leave date that has arrived flips the
      // member to ausgetreten/verstorben, but a *future* leave date leaves them
      // live (notice given, still a member until then). The nightly reconcile
      // flips them once the date passes.
      memberSet.status = deriveStatus({
        austritt: (memberSet.austritt as Date | null) ?? member.austritt,
        verstorbenAm: (memberSet.verstorbenAm as Date | null) ?? member.verstorbenAm,
      });
      await tx
        .update(membersTable)
        .set(memberSet as never)
        .where(eq(membersTable.id, input.memberId));

      // Department memberships: close the open ones on the leave date.
      for (const a of plan.abteilungClose) {
        await tx
          .update(memberAbteilungenTable)
          .set({ austrittsdatum: input.austrittDatum })
          .where(
            and(
              eq(memberAbteilungenTable.memberId, input.memberId),
              eq(memberAbteilungenTable.abteilungId, a.abteilungId),
              eq(memberAbteilungenTable.eintrittsdatum, a.eintrittsdatum),
            ),
          );
      }

      // Contracts: terminate to the leave date; record the notice date only
      // when it is not already set.
      if (plan.contractClose.length > 0) {
        await tx
          .update(contractsTable)
          .set({
            gekuendZum: austrittTs,
            vertragEnde: austrittTs,
            gekuendAm: sql`coalesce(${contractsTable.gekuendAm}, ${austrittTs})`,
            updatedAt: today,
          } as never)
          .where(inArray(contractsTable.id, plan.contractClose));
      }

      // SEPA mandates: revoke as of the leave date so no further debits run.
      if (plan.sepaRevoke.length > 0) {
        await tx
          .update(sepaMandatesTable)
          .set({ widerrufenAm: austrittTs, gultigBis: austrittTs, updatedAt: today } as never)
          .where(inArray(sepaMandatesTable.id, plan.sepaRevoke));
      }

      const auditId = await appendAudit(tx, {
        entityType: "member",
        entityId: input.memberId,
        action: "update",
        source: "ui",
        actorId: context.session!.user.id,
        actorEmail: context.session!.user.email,
        changes: {
          [input.reason === "verstorben" ? "verstorbenAm" : "austritt"]: {
            before: input.reason === "verstorben" ? member.verstorbenAm : member.austritt,
            after: input.austrittDatum,
          },
          austrittKaskade: {
            before: null,
            after: {
              abteilungen: plan.abteilungClose.length,
              vertraege: plan.contractClose.length,
              sepaMandate: plan.sepaRevoke.length,
            },
          },
        },
        requestId: context.requestId ?? null,
      });
      await takeMemberSnapshot(tx, input.memberId, {
        trigger: "mutation",
        actorId: context.session!.user.id,
        actorEmail: context.session!.user.email,
        auditId,
      });

      return {
        mitgliedsnummer: member.mitgliedsnummer,
        abteilungen: plan.abteilungClose.length,
        vertraege: plan.contractClose.length,
        sepaMandate: plan.sepaRevoke.length,
      };
    });

    await invalidateMemberCaches(context.tenant.key);
    return { ok: true, ...result };
  }),

  /**
   * Reverse an Austritt: clear the leave date on the member and reopen exactly
   * the dependent rows that the matching cascade closed (identified by the
   * shared leave day). Rows closed on a different day stay closed.
   */
  reactivate: vorstandProc
    .input(v.object({ memberId: v.pipe(v.string(), v.uuid()) }))
    .handler(async ({ context, input }) => {
      const result = await context.db.transaction(async (tx) => {
        const [member] = await tx
          .select()
          .from(membersTable)
          .where(eq(membersTable.id, input.memberId))
          .limit(1);
        if (!member) throw new ORPCError("NOT_FOUND", { message: "Mitglied nicht gefunden." });
        const day = toIsoDay(member.austritt);
        if (!day) {
          throw new ORPCError("VALIDATION_FAILED", {
            message: "Mitglied ist nicht ausgetreten.",
          });
        }

        const [abteilungen, contracts, sepa] = await Promise.all([
          tx
            .select({
              abteilungId: memberAbteilungenTable.abteilungId,
              eintrittsdatum: memberAbteilungenTable.eintrittsdatum,
              austrittsdatum: memberAbteilungenTable.austrittsdatum,
            })
            .from(memberAbteilungenTable)
            .where(eq(memberAbteilungenTable.memberId, input.memberId)),
          tx
            .select({
              id: contractsTable.id,
              gekuendZum: contractsTable.gekuendZum,
              vertragEnde: contractsTable.vertragEnde,
            })
            .from(contractsTable)
            .where(eq(contractsTable.memberId, input.memberId)),
          tx
            .select({
              id: sepaMandatesTable.id,
              widerrufenAm: sepaMandatesTable.widerrufenAm,
              gultigBis: sepaMandatesTable.gultigBis,
            })
            .from(sepaMandatesTable)
            .where(eq(sepaMandatesTable.memberId, input.memberId)),
        ]);

        const plan = planReactivateCascade({
          austrittDatum: day,
          abteilungen,
          contracts,
          sepa,
        });

        const now = new Date();
        // Clearing the Austritt brings the member back to aktiv (or verstorben
        // if a death date is recorded).
        const reactivatedStatus = deriveStatus({
          austritt: null,
          verstorbenAm: member.verstorbenAm,
        });
        await tx
          .update(membersTable)
          .set({
            austritt: null,
            status: reactivatedStatus,
            updatedAt: now,
          } as never)
          .where(eq(membersTable.id, input.memberId));

        for (const a of plan.abteilungReopen) {
          await tx
            .update(memberAbteilungenTable)
            .set({ austrittsdatum: null })
            .where(
              and(
                eq(memberAbteilungenTable.memberId, input.memberId),
                eq(memberAbteilungenTable.abteilungId, a.abteilungId),
                eq(memberAbteilungenTable.eintrittsdatum, a.eintrittsdatum),
              ),
            );
        }
        for (const c of plan.contractReopen) {
          await tx
            .update(contractsTable)
            .set({
              gekuendZum: null,
              gekuendAm: null,
              ...(c.clearVertragEnde ? { vertragEnde: null } : {}),
              updatedAt: now,
            } as never)
            .where(eq(contractsTable.id, c.id));
        }
        for (const s of plan.sepaReopen) {
          await tx
            .update(sepaMandatesTable)
            .set({
              widerrufenAm: null,
              ...(s.clearGultigBis ? { gultigBis: null } : {}),
              updatedAt: now,
            } as never)
            .where(eq(sepaMandatesTable.id, s.id));
        }

        const auditId = await appendAudit(tx, {
          entityType: "member",
          entityId: input.memberId,
          action: "update",
          source: "ui",
          actorId: context.session!.user.id,
          actorEmail: context.session!.user.email,
          changes: {
            austritt: { before: day, after: null },
            reaktivierung: {
              before: null,
              after: {
                abteilungen: plan.abteilungReopen.length,
                vertraege: plan.contractReopen.length,
                sepaMandate: plan.sepaReopen.length,
              },
            },
          },
          requestId: context.requestId ?? null,
        });
        await takeMemberSnapshot(tx, input.memberId, {
          trigger: "mutation",
          actorId: context.session!.user.id,
          actorEmail: context.session!.user.email,
          auditId,
        });

        return { mitgliedsnummer: member.mitgliedsnummer };
      });

      await invalidateMemberCaches(context.tenant.key);
      return { ok: true, ...result };
    }),

  /**
   * Guided new-member entry: create the member and, in the same transaction,
   * assign departments and optionally a first contract and SEPA mandate. A
   * skipped step just leaves that part empty; the member is always valid.
   */
  onboard: vorstandProc
    .input(
      v.object({
        // A real member gets an M-number; a non-member contact/payer gets a
        // K-number. Member-specific fields are otherwise identical.
        kind: v.optional(v.picklist(["member", "kontakt"]), "member"),
        patch: StammdatenInput,
        abteilungen: v.optional(v.array(OnboardAbteilung), []),
        contract: v.optional(v.nullable(OnboardContract), null),
        sepa: v.optional(v.nullable(OnboardSepa), null),
      }),
    )
    .handler(async ({ context, input }) => {
      const patch = buildMemberPatch(input.patch);
      if (!patch.nachname && !patch.vorname) {
        throw new ORPCError("VALIDATION_FAILED", {
          message: "Vor- oder Nachname ist erforderlich.",
        });
      }
      if (patch.geschlecht == null) {
        patch.geschlecht = deriveGeschlecht(input.patch.anrede);
      }

      const actorId = context.session!.user.id;
      const actorEmail = context.session!.user.email;
      const eintrittIso = patch.eintritt instanceof Date ? toIsoDay(patch.eintritt) : null;
      const fallbackEintritt = eintrittIso ?? new Date().toISOString().slice(0, 10);
      const isKontakt = input.kind === "kontakt";
      const status = memberStatusFromForm(
        (patch.austritt as Date | null) ?? null,
        (patch.verstorbenAm as Date | null) ?? null,
      );

      // Validate Betrag and dates up front (before the transaction) so a bad
      // value fails fast and is not re-checked on each unique-collision retry.
      const contract = input.contract
        ? {
            art: input.contract.art,
            artName: input.contract.artName ?? null,
            vertragNr: input.contract.vertragNr ?? null,
            betrag: validateBetragString(input.contract.betrag, "Betrag"),
            sollstellung: input.contract.sollstellung ?? null,
            vertragBegin: toDateOrNull(
              input.contract.vertragBegin ?? eintrittIso,
              "Vertragsbeginn",
            ),
            // Direct debit when a SEPA mandate is set up or an IBAN is on file;
            // otherwise the member is an invoice (Rechnungs) payer.
            isDirectDebit: input.sepa != null || Boolean(input.patch.iban1),
          }
        : null;
      const sepa = input.sepa
        ? {
            mandatsNr: input.sepa.mandatsNr ?? null,
            unterschriftDatum: toDateOrNull(input.sepa.unterschriftDatum, "Unterschriftsdatum"),
            gueltigAb: toDateOrNull(input.sepa.gueltigAb ?? eintrittIso, "Gültig ab"),
          }
        : null;

      const result = await withUniqueRetry(() =>
        context.db.transaction((tx) =>
          onboardMember(tx, {
            patch,
            isKontakt,
            status,
            abteilungen: input.abteilungen,
            fallbackEintritt,
            contract,
            sepa,
            actorId,
            actorEmail,
            requestId: context.requestId ?? null,
          }),
        ),
      );

      await invalidateMemberCaches(context.tenant.key);
      return result;
    }),
};
