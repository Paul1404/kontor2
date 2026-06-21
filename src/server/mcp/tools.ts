import { call } from "@orpc/server";
import { toJsonSchema } from "@valibot/to-json-schema";
import * as v from "valibot";
import type { Role } from "~/server/db/schema/auth";
import { withIdempotency } from "~/server/mcp/idempotency";
import type { AppContext } from "~/server/orpc/context";
import { CATEGORY_IDS } from "~/server/orpc/procedures/data-quality";
import { appRouter } from "~/server/orpc/router";

/**
 * Curated MCP tool registry. Every tool delegates to an existing oRPC
 * procedure via `call(procedure, input, { context })`, so role checks
 * (`requireAuth`), audit entries, and the observability middleware all run
 * exactly as for browser requests. `minRole` mirrors the procedure's own
 * entrypoint (authedProc -> readonly, vorstandProc -> vorstand) and is used to
 * filter `tools/list`; the procedure middleware stays as the second line of
 * defense for `tools/call`.
 *
 * Inputs are deliberately curated subsets of the procedures' Valibot schemas
 * (the procedure re-validates anyway). One Valibot schema per tool is the
 * single source for both runtime validation and the JSON Schema advertised in
 * `tools/list`.
 *
 * Bank details (IBAN/BIC), SEPA mandates, contracts, legal-representative
 * fields, member merge (admin) AND the full Beitragslauf / SEPA-Einzug cycle
 * (fee-run preview/simulate/commit, pain.008 XML, Sollstellung-Storno,
 * Rücklastschrift erfassen, Wiedereinzug, Vorabankündigung) ARE exposed as
 * curated tools so the whole dues workflow can be driven and reconciled over
 * MCP; each delegates to its vorstand/admin procedure and is fully audited.
 * The pain.008 is text, so the XML download is exposed; only binary downloads
 * (PDF/CSV/XLSX) stay UI-only.
 *
 * The versioned Linear SQL archive (archive.*) IS exposed read-only for
 * reverse-engineering and analysis (list versions, describe tables, search,
 * value distributions, relationships, schema diff); uploading a new archive
 * version stays UI/admin-only, like import.*.
 *
 * Deliberately still NOT exposed: import.*, settings.*, and DSGVO erasure.
 */
export type McpTool = {
  /** snake_case, English. */
  name: string;
  description: string;
  minRole: Role;
  input: v.GenericSchema;
  execute: (context: AppContext, input: unknown) => Promise<unknown>;
};

/** Mirrors ROLE_RANK in src/server/orpc/base.ts. */
const ROLE_RANK: Record<Role, number> = { readonly: 1, vorstand: 2, admin: 3 };

/**
 * Type-safe tool builder: `execute` receives the schema's parsed output. The
 * cast to the unknown-typed `McpTool` is safe because the MCP server always
 * validates arguments against `input` before invoking `execute`.
 */
function defineTool<TSchema extends v.GenericSchema>(def: {
  name: string;
  description: string;
  minRole: Role;
  input: TSchema;
  execute: (context: AppContext, input: v.InferOutput<TSchema>) => Promise<unknown>;
}): McpTool {
  return def as unknown as McpTool;
}

const PageInput = v.optional(v.pipe(v.number(), v.integer(), v.minValue(1)));
const YearInput = v.pipe(v.number(), v.integer(), v.minValue(1900), v.maxValue(2200));
const DateInput = v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/));
/** Age in completed years for a Beitragsart range, or null to clear it. */
const AgeInput = v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(120)));

/**
 * Optional idempotency key for write tools (issue #83): a retried create with
 * the same key returns the first call's result instead of creating a duplicate.
 */
const IdempotencyKeyInput = v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(200)));

/**
 * Selects an archive version for the archive_* tools. Give a `version` number
 * (from archive_list_versions) or a `versionId`; omit both for the latest.
 */
const VersionSelector = {
  versionId: v.optional(v.string()),
  version: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
};

/**
 * Subset of the member Stammdaten allow-list (members.ts StammdatenInput)
 * exposed over MCP. Includes bank details (IBAN/BIC) and legal-representative
 * fields so the Datenqualitaet findings (missing IBAN, minors without a
 * representative) can be fixed over MCP; members.update encrypts the IBAN and
 * derives iban1Last4. Billing-exemption flags stay UI-only on purpose.
 */
const McpStammdatenInput = v.object({
  anrede: v.optional(v.nullable(v.string())),
  vorname: v.optional(v.nullable(v.string())),
  nachname: v.optional(v.nullable(v.string())),
  geburtsdatum: v.optional(v.nullable(DateInput)),
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
  eintritt: v.optional(v.nullable(DateInput)),
  austritt: v.optional(v.nullable(DateInput)),
  notes: v.optional(v.nullable(v.string())),
  iban1: v.optional(v.nullable(v.string())),
  bic1: v.optional(v.nullable(v.string())),
  vertreterAnrede: v.optional(v.nullable(v.string())),
  vertreterName: v.optional(v.nullable(v.string())),
  vertreterStrasse: v.optional(v.nullable(v.string())),
  vertreterHausnummer: v.optional(v.nullable(v.string())),
  vertreterPlz: v.optional(v.nullable(v.string())),
  vertreterOrt: v.optional(v.nullable(v.string())),
});

/**
 * Curated contract (Beitrag/Vertrag) input, mirroring contracts.ts
 * ContractInput. `art` is the Beitragsart id (resolve via list_fee_types);
 * `betrag`/`aufnahmegeb` are decimal strings, dates are YYYY-MM-DD. The
 * procedure re-validates and audits.
 */
const McpContractInput = v.object({
  vertragNr: v.pipe(v.string(), v.minLength(1)),
  art: v.pipe(v.number(), v.integer()),
  artName: v.optional(v.nullable(v.string())),
  betrag: v.optional(v.nullable(v.string())),
  aufnahmegeb: v.optional(v.nullable(v.string())),
  sollstellung: v.optional(v.nullable(v.string())),
  vertragBegin: v.optional(v.nullable(DateInput)),
  vertragEnde: v.optional(v.nullable(DateInput)),
  gekuendAm: v.optional(v.nullable(DateInput)),
  gekuendZum: v.optional(v.nullable(DateInput)),
  /** true = per SEPA-Lastschrift einziehbar (sonst Rechnung). Beim Update weglassen lässt es unverändert. */
  isDirectDebit: v.optional(v.boolean()),
});

/** Curated SEPA mandate input, mirroring sepa.ts CreateInput. */
const McpSepaMandateInput = v.object({
  memberId: v.string(),
  mandatsNr: v.optional(v.nullable(v.string())),
  lastschriftart: v.optional(v.nullable(v.string())),
  typ: v.optional(v.nullable(v.string())),
  status: v.optional(v.nullable(v.string())),
  unterschriftDatum: v.optional(v.nullable(DateInput)),
  gueltigAb: v.optional(v.nullable(DateInput)),
  gultigBis: v.optional(v.nullable(DateInput)),
});

/** Decimal money string, e.g. "54.00". Mirrors sepa-returns.ts MoneyString. */
const MoneyInput = v.pipe(v.string(), v.regex(/^-?\d+(\.\d{1,2})?$/));

/** ISO 20022 SEPA return reason codes, mirroring sepa-returns.ts. */
const ReturnReasonCode = v.picklist([
  "AC04",
  "AC06",
  "AC13",
  "AG01",
  "AM04",
  "AM05",
  "BE05",
  "FF01",
  "MD01",
  "MD06",
  "MD07",
  "MS02",
  "MS03",
  "RC01",
  "RR01",
  "SL01",
] as const);

const TOOLS: McpTool[] = [
  // ---- Members (read) ----
  defineTool({
    name: "search_members",
    description:
      "Search and list club members (Mitglieder). Filter by free-text query, status (aktiv, passiv, gekuendigt, ausgetreten, verstorben, alle) and Abteilung id; paginated. Returns member rows with Mitgliedsnummer, name, status and Abteilungen.",
    minRole: "readonly",
    input: v.object({
      q: v.optional(v.string()),
      status: v.optional(
        v.picklist(["aktiv", "passiv", "gekuendigt", "ausgetreten", "verstorben", "alle"]),
      ),
      abteilungId: v.optional(v.nullable(v.string())),
      page: PageInput,
      pageSize: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(200))),
    }),
    execute: (context, input) => call(appRouter.members.list, input, { context }),
  }),
  defineTool({
    name: "get_member",
    description:
      "Get the full detail of one member by Mitgliedsnummer (or Kontaktnummer): Stammdaten, Abteilungen, contracts (Beitraege), SEPA mandate status, open postings and relationships.",
    minRole: "readonly",
    input: v.object({ mitgliedsnummer: v.string() }),
    execute: (context, input) => call(appRouter.members.get, input, { context }),
  }),
  defineTool({
    name: "bulk_export_members",
    description:
      "Export all members in pages, instead of many individual get_member calls. Returns compact member records (masked bank data: iban1Last4 only) plus a `nextCursor`; pass it back to fetch the next page, and stop when it is null. `limit` defaults to 200 (max 500).",
    minRole: "readonly",
    input: v.object({
      cursor: v.optional(v.nullable(v.string())),
      limit: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(500))),
      includeDeleted: v.optional(v.boolean()),
    }),
    execute: (context, input) => call(appRouter.members.bulkExport, input, { context }),
  }),
  defineTool({
    name: "member_stats",
    description:
      "Aggregate member counts by status (aktiv, passiv, gekuendigt, ausgetreten, verstorben) plus Kontakte.",
    minRole: "readonly",
    input: v.object({}),
    execute: (context) => call(appRouter.members.stats, undefined, { context }),
  }),
  defineTool({
    name: "list_departments",
    description:
      "List all Abteilungen (departments) with their ids. Use this to resolve Abteilung names to ids for other tools.",
    minRole: "readonly",
    input: v.object({}),
    execute: (context) => call(appRouter.abteilungen.list, undefined, { context }),
  }),
  defineTool({
    name: "list_fee_types",
    description:
      "List all Beitragsarten (fee types) with their ids and names. Use this to resolve the numeric Beitragsart id (the `art` field) required by create_contract.",
    minRole: "readonly",
    input: v.object({}),
    execute: (context) => call(appRouter.feeTypes.list, undefined, { context }),
  }),
  defineTool({
    name: "member_timeline",
    description:
      "Chronological timeline for one member (by internal member id from search_members/get_member): audit changes, Mahnungen, Kulanz, Rundschreiben, SEPA returns and Ehrungen.",
    minRole: "readonly",
    input: v.object({ memberId: v.string() }),
    execute: (context, input) => call(appRouter.timeline.forMember, input, { context }),
  }),
  defineTool({
    name: "search_entities",
    description:
      "Cross-entity search over contracts (Beitraege) and SEPA mandates by free text. Useful for finding which member a mandate reference or contract belongs to.",
    minRole: "readonly",
    input: v.object({
      q: v.pipe(v.string(), v.trim()),
      limit: v.optional(v.number()),
    }),
    execute: (context, input) => call(appRouter.search.entities, input, { context }),
  }),
  // ---- Dashboard / statistics (read) ----
  defineTool({
    name: "dashboard_stats",
    description:
      "Headline club KPIs: total and active members, new members this month, Austritte this month, members per Abteilung, age buckets, gender split, upcoming birthdays and membership tenure.",
    minRole: "readonly",
    input: v.object({}),
    execute: (context) => call(appRouter.dashboard.stats, undefined, { context }),
  }),
  defineTool({
    name: "dashboard_insights",
    description:
      "Trend analytics: member development over the years, revenue by year, dunning funnel by Mahnstufe, payment-method split and age pyramid.",
    minRole: "readonly",
    input: v.object({}),
    execute: (context) => call(appRouter.dashboard.insights, undefined, { context }),
  }),
  // ---- Reports (read) ----
  defineTool({
    name: "report_birthdays",
    description:
      "Birthday list (Geburtstagsliste) for a month, optionally restricted to one Abteilung. Month is 1-12; year defaults to the current year.",
    minRole: "readonly",
    input: v.object({
      month: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(12)),
      year: v.optional(YearInput),
      abteilungId: v.optional(v.nullable(v.string())),
    }),
    execute: (context, input) => call(appRouter.reports.geburtstage, input, { context }),
  }),
  defineTool({
    name: "report_honors",
    description:
      "Upcoming membership jubilees (Ehrungen) for a year. Optionally pass the jubilee years to check (default 25, 40, 50, 60, 70, 75).",
    minRole: "readonly",
    input: v.object({
      year: YearInput,
      jubilaeen: v.optional(
        v.array(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(150))),
      ),
    }),
    execute: (context, input) => call(appRouter.reports.ehrungen, input, { context }),
  }),
  // ---- Tasks (read) ----
  defineTool({
    name: "tasks_worklist",
    description: "All open member tasks (Aufgaben) across the club, ordered by due date.",
    minRole: "readonly",
    input: v.object({}),
    execute: (context) => call(appRouter.tasks.worklist, undefined, { context }),
  }),
  // ---- Finance (read) ----
  defineTool({
    name: "list_fee_runs",
    description:
      "List billing runs (Beitragslaeufe / Sollstellungslaeufe) with their totals and status, newest first.",
    minRole: "readonly",
    input: v.object({
      limit: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(200))),
      offset: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0))),
    }),
    execute: (context, input) => call(appRouter.feeRuns.list, input, { context }),
  }),
  defineTool({
    name: "list_dunning",
    description: "List past dunning runs (Mahnlaeufe) with totals, newest first; paginated.",
    minRole: "readonly",
    input: v.object({
      page: PageInput,
      pageSize: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(200))),
    }),
    execute: (context, input) => call(appRouter.dunning.list, input, { context }),
  }),
  defineTool({
    name: "get_dunning",
    description:
      "Detail of one dunning run (Mahnlauf) by id, including the dunned members and postings.",
    minRole: "readonly",
    input: v.object({ id: v.string() }),
    execute: (context, input) => call(appRouter.dunning.get, input, { context }),
  }),
  // ---- Vorstand: read ----
  defineTool({
    name: "dunning_open_candidates",
    description:
      "Open postings (offene Posten) grouped by member that are candidates for the next dunning run. Filter by current Mahnstufe and minimum days overdue.",
    minRole: "vorstand",
    input: v.object({
      mahnstufe: v.optional(v.nullable(v.pipe(v.number(), v.integer()))),
      minDaysOverdue: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0))),
    }),
    execute: (context, input) => call(appRouter.dunning.open, input, { context }),
  }),
  defineTool({
    name: "report_finance",
    description:
      'Annual financial report (Finanzbericht): billed, paid and open totals, per Abteilung and per fee type. Amounts are decimal EUR strings, e.g. "1234.56".',
    minRole: "vorstand",
    input: v.object({ year: YearInput }),
    execute: (context, input) => call(appRouter.reports.finanzbericht, input, { context }),
  }),
  defineTool({
    name: "report_department_stats",
    description:
      "Per-Abteilung statistics for a year: active members, joiners (Eintritte) and leavers (Austritte).",
    minRole: "vorstand",
    input: v.object({ year: YearInput }),
    execute: (context, input) => call(appRouter.reports.abteilungStats, input, { context }),
  }),
  defineTool({
    name: "data_quality_summary",
    description:
      "Data quality overview: counts of members with missing or inconsistent data (address, IBAN, birth date and so on).",
    minRole: "vorstand",
    input: v.object({}),
    execute: (context) => call(appRouter.dataQuality.summary, undefined, { context }),
  }),
  defineTool({
    name: "data_quality_members",
    description:
      "Drill into one data_quality_summary category and list the affected members (the rows behind a count). Pass a category id from data_quality_summary, e.g. 'aktiv_ohne_vertrag', 'lastschrift_ohne_mandat' or 'moegliche_dubletten'. Returns each member's reference, name, Ort, email, Geburtsdatum and Austritt, plus `cap` (page size) and `nextCursor`; pass the cursor back to fetch the next page (null = last page).",
    minRole: "vorstand",
    input: v.object({
      category: v.picklist(CATEGORY_IDS),
      cursor: v.optional(v.nullable(v.string())),
    }),
    execute: (context, input) => call(appRouter.dataQuality.list, input, { context }),
  }),
  // ---- Vorstand: mutations ----
  defineTool({
    name: "create_member",
    description:
      "Create a new member with the given Stammdaten (name, address, contact, Eintritt, optionally IBAN/BIC and legal-representative fields). The Mitgliedsnummer is assigned automatically. The change is audited.",
    minRole: "vorstand",
    input: v.object({ patch: McpStammdatenInput, idempotencyKey: IdempotencyKeyInput }),
    execute: (context, input) =>
      withIdempotency(context.db, "create_member", input.idempotencyKey, () =>
        call(appRouter.members.create, { patch: input.patch }, { context }),
      ),
  }),
  defineTool({
    name: "update_member",
    description:
      "Update a member's Stammdaten by internal member id (from search_members/get_member). Only the provided fields change; the change is audited. Supports IBAN/BIC (fixes 'Lastschrift ohne IBAN') and legal-representative fields (fixes 'Minderjaehrig ohne Vertretung').",
    minRole: "vorstand",
    input: v.object({
      memberId: v.string(),
      patch: McpStammdatenInput,
    }),
    execute: (context, input) => call(appRouter.members.update, input, { context }),
  }),
  defineTool({
    name: "create_task",
    description:
      "Create a task (Aufgabe) on a member, with optional notes and due date (YYYY-MM-DD).",
    minRole: "vorstand",
    input: v.object({
      memberId: v.string(),
      title: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(200)),
      notes: v.optional(v.nullable(v.pipe(v.string(), v.maxLength(2000)))),
      dueDate: v.optional(v.nullable(DateInput)),
      idempotencyKey: IdempotencyKeyInput,
    }),
    execute: (context, { idempotencyKey, ...rest }) =>
      withIdempotency(context.db, "create_task", idempotencyKey, () =>
        call(appRouter.tasks.create, rest, { context }),
      ),
  }),
  defineTool({
    name: "set_task_status",
    description: "Mark a member task (Aufgabe) as done or reopen it.",
    minRole: "vorstand",
    input: v.object({ id: v.string(), status: v.picklist(["open", "done"]) }),
    execute: (context, input) => call(appRouter.tasks.setStatus, input, { context }),
  }),
  defineTool({
    name: "set_fee_type_age_range",
    description:
      "Set the expected age range (in completed years) of a Beitragsart, which arms the data-quality check 'tarif_passt_nicht_zum_alter'. Resolve `art` via list_fee_types (its minAge/maxAge show the current range). Pass minAge/maxAge as integers, or null to clear a bound. This only affects the data-quality display, never billing. The change is audited.",
    minRole: "vorstand",
    input: v.object({
      art: v.pipe(v.number(), v.integer()),
      minAge: AgeInput,
      maxAge: AgeInput,
    }),
    execute: (context, input) => call(appRouter.feeTypes.setAgeRange, input, { context }),
  }),
  defineTool({
    name: "dunning_mark_paid",
    description:
      "Mark open postings (Sollstellungen, by their ids) as paid, with an optional note. Used after a manual payment arrived. The change is audited.",
    minRole: "vorstand",
    input: v.object({
      sollStellungIds: v.pipe(v.array(v.string()), v.minLength(1)),
      notes: v.optional(v.nullable(v.string())),
    }),
    execute: (context, input) => call(appRouter.dunning.markPaid, input, { context }),
  }),
  defineTool({
    name: "create_contract",
    description:
      "Create a membership contract (Beitrag/Vertrag) for a member (by internal member id), fixing 'Mitglied ohne Vertrag'. Needs a Vertragsnummer and the Beitragsart id (`art`, resolve via list_fee_types). Money relevant: this creates a billable obligation. The change is audited.",
    minRole: "vorstand",
    input: v.object({
      memberId: v.string(),
      patch: McpContractInput,
      idempotencyKey: IdempotencyKeyInput,
    }),
    execute: (context, input) =>
      withIdempotency(context.db, "create_contract", input.idempotencyKey, () =>
        call(
          appRouter.contracts.create,
          { memberId: input.memberId, patch: input.patch },
          { context },
        ),
      ),
  }),
  defineTool({
    name: "update_contract",
    description:
      "Update a contract by its id (from get_member). Use to set a missing Beitragsart name ('Vertrag ohne Beitragsart') or adjust amounts and dates. Same fields as create_contract. The change is audited.",
    minRole: "vorstand",
    input: v.object({ id: v.string(), patch: McpContractInput }),
    execute: (context, input) => call(appRouter.contracts.update, input, { context }),
  }),
  defineTool({
    name: "set_contract_zahler",
    description:
      "Set or clear the explicit payer (Zahler) of a contract. Pass the contract id (from get_member) and zahlerMemberId = the internal member id whose account is debited, or null to clear the override (then the automatic resolution Familie -> Vertreter -> self applies again). Use to route a member's beitrag onto a partner/parent account, e.g. a spouse without an own mandate. The debit follows the Zahler. The change is audited.",
    minRole: "vorstand",
    input: v.object({ contractId: v.string(), zahlerMemberId: v.nullable(v.string()) }),
    execute: (context, input) => call(appRouter.contracts.setZahler, input, { context }),
  }),
  defineTool({
    name: "create_relationship",
    description:
      "Create a relationship (Beziehung) between two members by internal member id (fromMemberId -> toMemberId). Optional beziehung label (e.g. 'Ehepartner', 'Zahler'), notiz and datVon/datBis (YYYY-MM-DD). Set reciprocal: true to also create the mirror link. Use to connect a household (e.g. spouses) so the structure is correct. The change is audited.",
    minRole: "vorstand",
    input: v.object({
      fromMemberId: v.string(),
      toMemberId: v.string(),
      beziehung: v.optional(v.nullable(v.string())),
      notiz: v.optional(v.nullable(v.string())),
      datVon: v.optional(v.nullable(DateInput)),
      datBis: v.optional(v.nullable(DateInput)),
      reciprocal: v.optional(v.boolean()),
      idempotencyKey: IdempotencyKeyInput,
    }),
    execute: (context, { idempotencyKey, ...rest }) =>
      withIdempotency(context.db, "create_relationship", idempotencyKey, () =>
        call(appRouter.relationships.create, rest, { context }),
      ),
  }),
  defineTool({
    name: "create_sepa_mandate",
    description:
      "Create a SEPA direct-debit mandate for a member (by internal member id), fixing 'Lastschrift ohne SEPA-Mandat'. The mandate reference is assigned automatically if omitted. Set the member's IBAN first via update_member. Bank and money relevant. The change is audited.",
    minRole: "vorstand",
    input: v.object({ ...McpSepaMandateInput.entries, idempotencyKey: IdempotencyKeyInput }),
    execute: (context, { idempotencyKey, ...rest }) =>
      withIdempotency(context.db, "create_sepa_mandate", idempotencyKey, () =>
        call(appRouter.sepa.create, rest, { context }),
      ),
  }),
  defineTool({
    name: "update_sepa_mandate",
    description:
      "Update an existing SEPA mandate by its id (from get_member's sepa[].id). Set unterschriftDatum (the mandate signature date, YYYY-MM-DD, must be a real past date, it ends up as DtOfSgntr in the pain.008), status, gueltigAb, gultigBis, widerrufenAm, lastschriftart or typ. Only the provided fields change; the rest stay as they are. Bank and money relevant. The change is audited.",
    minRole: "vorstand",
    input: v.object({
      id: v.string(),
      patch: v.object({
        status: v.optional(v.nullable(v.string())),
        lastschriftart: v.optional(v.nullable(v.string())),
        typ: v.optional(v.nullable(v.string())),
        unterschriftDatum: v.optional(v.nullable(DateInput)),
        gueltigAb: v.optional(v.nullable(DateInput)),
        gultigBis: v.optional(v.nullable(DateInput)),
        widerrufenAm: v.optional(v.nullable(DateInput)),
      }),
    }),
    execute: (context, input) => call(appRouter.sepa.update, input, { context }),
  }),
  defineTool({
    name: "merge_members",
    description:
      "Merge two duplicate member records (use after confirming a pair from data_quality_members 'moegliche_dubletten'). Moves all contracts, SEPA mandates, postings, relationships, Ehrungen, Abteilungen, tasks and documents from the loser onto the winner, then soft-deletes the loser. Pass winnerId (kept) and loserId (removed) as internal member ids, and confirm: true. Destructive and ADMIN ONLY. Rows that would break a uniqueness constraint stay on the soft-deleted loser and are reported as 'skipped'; nothing is hard-deleted. The change is audited.",
    minRole: "admin",
    input: v.object({ winnerId: v.string(), loserId: v.string(), confirm: v.literal(true) }),
    execute: (context, input) => call(appRouter.members.merge, input, { context }),
  }),
  // ---- Vorstand: Beitragslauf & SEPA-Einzug (money movement) ----
  defineTool({
    name: "preview_fee_run",
    description:
      "Vorschau eines Beitragslaufs für ein Jahr ohne zu schreiben: welche Lastschrift-Posten (mit Mandat/IBAN) und welche Rechnungs-Posten entstünden, Summen und Konflikte (fehlendes Mandat, gesperrt). `falligkeitsdatum` ist YYYY-MM-DD. Optional `memberIds`: nur diese (abgerechneten) Mitglieder berücksichtigen, für einen gezielten (Wieder-)Einzug. Nutze dies vor commit_fee_run, um Anzahl und Summe zu bestätigen.",
    minRole: "vorstand",
    input: v.object({
      billingYear: v.pipe(v.number(), v.integer(), v.minValue(2000), v.maxValue(2100)),
      falligkeitsdatum: DateInput,
      mandateOverrides: v.optional(v.record(v.string(), v.string())),
      memberIds: v.optional(v.array(v.string())),
    }),
    execute: (context, input) => call(appRouter.feeRuns.preview, input, { context }),
  }),
  defineTool({
    name: "simulate_fee_run",
    description:
      "Vergleicht den Beitragslauf eines Jahres mit den Posten des Vorjahres: wer ist neu, wer fällt weg, wessen Betrag ändert sich. Reine Vorschau (kein Schreiben), zur Plausibilitätsprüfung vor commit_fee_run.",
    minRole: "vorstand",
    input: v.object({
      billingYear: v.pipe(v.number(), v.integer(), v.minValue(2000), v.maxValue(2100)),
      falligkeitsdatum: DateInput,
      mandateOverrides: v.optional(v.record(v.string(), v.string())),
      memberIds: v.optional(v.array(v.string())),
    }),
    execute: (context, input) => call(appRouter.feeRuns.simulate, input, { context }),
  }),
  defineTool({
    name: "commit_fee_run",
    description:
      'Führt den Beitragslauf aus: legt fehlende Sollstellungen für das Jahr an, erzeugt die pain.008-Lastschriftdatei und schreibt die fee_run_items. Bereits offen gestellte Verträge werden nicht doppelt gestellt (inkrementell). Optional `memberIds`: nur diese (abgerechneten) Mitglieder einziehen, für einen gezielten (Wieder-)Einzug ohne den Rest des Vereins. Sicherheits-Check: `expectedTotalAmount` (z. B. "510.00") und `expectedItemCount` müssen exakt zur Vorschau passen, sonst bricht der Lauf ab. Geld- und bankrelevant, vollständig auditiert. Die XML danach mit get_fee_run_xml abrufen.',
    minRole: "vorstand",
    input: v.object({
      billingYear: v.pipe(v.number(), v.integer(), v.minValue(2000), v.maxValue(2100)),
      falligkeitsdatum: DateInput,
      mandateOverrides: v.optional(v.record(v.string(), v.string())),
      memberIds: v.optional(v.array(v.string())),
      expectedTotalAmount: v.pipe(v.string(), v.minLength(1)),
      expectedItemCount: v.pipe(v.number(), v.integer(), v.minValue(0)),
      notes: v.optional(v.nullable(v.string())),
      idempotencyKey: IdempotencyKeyInput,
    }),
    execute: (context, { idempotencyKey, ...rest }) =>
      withIdempotency(context.db, "commit_fee_run", idempotencyKey, () =>
        call(appRouter.feeRuns.commit, rest, { context }),
      ),
  }),
  defineTool({
    name: "get_fee_run",
    description:
      "Detail eines Beitrags-/Wiedereinzugslaufs (id aus list_fee_runs): Kopf (Jahr, Fälligkeit, Status, Art, Summe, Anzahl) und die einzelnen Posten (Mitglied, Betrag, Mandat, EndToEndId, ob zurückgegangen). Die XML ist hier nicht enthalten (siehe get_fee_run_xml).",
    minRole: "readonly",
    input: v.object({ id: v.string() }),
    execute: (context, input) => call(appRouter.feeRuns.get, input, { context }),
  }),
  defineTool({
    name: "get_fee_run_xml",
    description:
      "Liefert die pain.008-Lastschriftdatei eines committeten Laufs als Text (Dateiname + XML-Inhalt) zum Bankupload. id aus list_fee_runs/commit_fee_run.",
    minRole: "vorstand",
    input: v.object({ id: v.string() }),
    execute: (context, input) => call(appRouter.feeRuns.downloadXml, input, { context }),
  }),
  defineTool({
    name: "cancel_fee_run",
    description:
      "Storniert einen Beitragslauf (id aus list_fee_runs) und macht seine Sollstellungen/XML rückgängig. Nutzen, wenn ein Lauf falsch erzeugt wurde. Auditiert.",
    minRole: "vorstand",
    input: v.object({ id: v.string(), reason: v.optional(v.nullable(v.string())) }),
    execute: (context, input) => call(appRouter.feeRuns.cancel, input, { context }),
  }),
  defineTool({
    name: "cancel_sollstellung",
    description:
      "Storniert eine einzelne Sollstellung (sollStellungId, z. B. aus get_fee_run/get_member), Status -> cancelled. Für versehentlich oder doppelt gestellte Posten. Auditiert. Eine bereits eingezogene, zurückgegangene Lastschrift wird NICHT hierüber, sondern mit record_sepa_return behandelt.",
    minRole: "vorstand",
    input: v.object({
      sollStellungId: v.string(),
      notes: v.optional(v.nullable(v.string())),
    }),
    execute: (context, input) => call(appRouter.feeRuns.stornoSollstellung, input, { context }),
  }),
  defineTool({
    name: "reopen_sollstellung",
    description:
      "Öffnet eine fälschlich stornierte Sollstellung (sollStellungId aus get_member/get_fee_run) wieder als offene Forderung: status -> open, bezahlt 0, offen = voller Betrag, Mahnstufe 0. Für Posten, die in manueller Lauf-Bearbeitung storniert wurden, aber tatsächlich noch geschuldet sind (z. B. geplatzte Lastschrift, die per Brief angefordert wird). Eine eingezogene/zurückgegangene Lastschrift NICHT hierüber, sondern mit record_sepa_return. Optional falligkeitsdatum (YYYY-MM-DD), um das Fälligkeitsdatum zu korrigieren (Mahn-/Kulanz-Stichtag); wird auch auf bereits offene Posten angewandt. Ohne falligkeitsdatum bleiben offene/zurückgegangene Posten unverändert. Auditiert.",
    minRole: "vorstand",
    input: v.object({
      sollStellungId: v.string(),
      falligkeitsdatum: v.optional(v.nullable(DateInput)),
      notes: v.optional(v.nullable(v.string())),
    }),
    execute: (context, input) => call(appRouter.feeRuns.reopenSollstellung, input, { context }),
  }),
  defineTool({
    name: "generate_kulanz",
    description:
      "Erzeugt den Kulanz-/Zahlungserinnerungsbrief als PDF (ein Schreiben je Empfänger) für die angegebenen Mitglieder mit OFFENEN Beiträgen. memberIds = interne IDs aus search_members/get_member. Listet die offenen Posten, Bankverbindung und ein Sonderkündigungs-Angebot; setzt KEINE Mahnstufe und keine Sollstellung. Empfänger ohne offene Forderung (status open/returned) werden abgewiesen -- ggf. vorher reopen_sollstellung. Optional: runDate, deadlineDate (YYYY-MM-DD), waiveReturnFee (SEPA-Gebühr aus Kulanz erlassen), mitUnterschrift (hinterlegte Vorstand-Unterschrift einbetten, Standard true). Gibt docRef, recipientCount, filename und das PDF als base64 zurück.",
    minRole: "vorstand",
    input: v.object({
      memberIds: v.pipe(v.array(v.string()), v.minLength(1)),
      runDate: v.optional(v.nullable(DateInput)),
      deadlineDate: v.optional(v.nullable(DateInput)),
      waiveReturnFee: v.optional(v.boolean()),
      mitUnterschrift: v.optional(v.boolean()),
    }),
    execute: (context, input) => call(appRouter.kulanz.generate, input, { context }),
  }),
  defineTool({
    name: "list_return_candidates",
    description:
      "Committete Lastschrift-Posten (fee_run_items), die noch NICHT als Rückläufer erfasst sind. Quelle für record_sepa_return. Optional per Freitext (Name, Mitgliedsnummer, EndToEndId) filtern.",
    minRole: "vorstand",
    input: v.object({
      query: v.optional(v.nullable(v.string())),
      limit: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(200))),
    }),
    execute: (context, input) => call(appRouter.sepaReturns.candidates, input, { context }),
  }),
  defineTool({
    name: "record_sepa_return",
    description:
      "Erfasst eine Rücklastschrift zu einem fee_run_item (aus list_return_candidates): öffnet die zugehörige Sollstellung wieder (status=returned, Mahnstufe 0) und bucht die Rücklastgebühr. `returnedOn` ist YYYY-MM-DD; `reasonCode` ist ein ISO-Grund (z. B. AM04 = nicht gedeckt, AC04 = Konto erloschen, MS03 = ohne Angabe); `rueckgebuhr` Dezimalstring, sonst Vereins-Standard. Geldrelevant, auditiert. Danach mit recollect_returns wieder einziehbar.",
    minRole: "vorstand",
    input: v.object({
      feeRunItemId: v.string(),
      returnedOn: DateInput,
      reasonCode: v.optional(v.nullable(ReturnReasonCode)),
      reasonText: v.optional(v.nullable(v.string())),
      rueckgebuhr: v.optional(MoneyInput),
      notes: v.optional(v.nullable(v.string())),
      idempotencyKey: IdempotencyKeyInput,
    }),
    execute: (context, { idempotencyKey, ...rest }) =>
      withIdempotency(context.db, "record_sepa_return", idempotencyKey, () =>
        call(appRouter.sepaReturns.create, rest, { context }),
      ),
  }),
  defineTool({
    name: "list_sepa_returns",
    description:
      "Erfasste Rücklastschriften, neueste zuerst; paginiert. Optional auf ein Mitglied (memberId) eingrenzen.",
    minRole: "readonly",
    input: v.object({
      page: PageInput,
      pageSize: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(200))),
      memberId: v.optional(v.nullable(v.string())),
    }),
    execute: (context, input) => call(appRouter.sepaReturns.list, input, { context }),
  }),
  defineTool({
    name: "list_recollect_candidates",
    description:
      "Zurückgegangene Sollstellungen (status=returned), die für einen Wiedereinzug in Frage kommen, mit Mandat, IBAN-Endung, Betrag und ob einziehbar (blockReason erklärt Sperren wie fehlendes Mandat). Quelle für recollect_returns.",
    minRole: "vorstand",
    input: v.object({
      query: v.optional(v.nullable(v.string())),
      limit: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(200))),
    }),
    execute: (context, input) => call(appRouter.feeRuns.recollectCandidates, input, { context }),
  }),
  defineTool({
    name: "recollect_returns",
    description:
      "Wiedereinzug: erzeugt eine neue pain.008-Datei für ausgewählte zurückgegangene Sollstellungen (sollStellungIds aus list_recollect_candidates), ohne die Original-Sollstellung zu löschen. Jeder Posten wechselt von returned zurück auf eingezogen und bekommt ein neues fee_run_item. `falligkeitsdatum` YYYY-MM-DD. Geld- und bankrelevant, auditiert. XML danach mit get_fee_run_xml.",
    minRole: "vorstand",
    input: v.object({
      sollStellungIds: v.pipe(v.array(v.string()), v.minLength(1)),
      falligkeitsdatum: DateInput,
      idempotencyKey: IdempotencyKeyInput,
    }),
    execute: (context, { idempotencyKey, ...rest }) =>
      withIdempotency(context.db, "recollect_returns", idempotencyKey, () =>
        call(appRouter.feeRuns.recollect, rest, { context }),
      ),
  }),
  defineTool({
    name: "preview_camt_returns",
    description:
      "Liest eine camt.054-Datei der Bank (Rücklastschriften) und ordnet jeden Rückläufer per EndToEndId einem committeten fee_run_item zu. Reine Vorschau (kein Schreiben): zeigt matched/already_returned/unmatched. Danach mit import_camt_returns bestätigen.",
    minRole: "vorstand",
    input: v.object({ xml: v.pipe(v.string(), v.minLength(1)) }),
    execute: (context, input) => call(appRouter.sepaReturns.previewCamt, input, { context }),
  }),
  defineTool({
    name: "import_camt_returns",
    description:
      "Übernimmt bestätigte camt.054-Treffer (items aus preview_camt_returns): erfasst je fee_run_item eine Rücklastschrift und öffnet die Sollstellung wieder. Bereits erfasste werden übersprungen. Geldrelevant, auditiert.",
    minRole: "vorstand",
    input: v.object({
      items: v.pipe(
        v.array(
          v.object({
            feeRunItemId: v.string(),
            returnedOn: DateInput,
            reasonCode: v.optional(v.nullable(v.pipe(v.string(), v.maxLength(35)))),
            reasonText: v.optional(v.nullable(v.string())),
            rueckgebuhr: v.optional(v.nullable(MoneyInput)),
          }),
        ),
        v.minLength(1),
      ),
    }),
    execute: (context, input) => call(appRouter.sepaReturns.importCamt, input, { context }),
  }),
  defineTool({
    name: "fee_run_prenotify_info",
    description:
      "Vorabankündigungs-Status eines Laufs (id): wie viele Mitglieder eine Pre-Notification-E-Mail erhalten würden, Fälligkeit und ob E-Mail-Adressen fehlen. Reine Info.",
    minRole: "vorstand",
    input: v.object({ id: v.string() }),
    execute: (context, input) => call(appRouter.feeRuns.prenotifyInfo, input, { context }),
  }),
  defineTool({
    name: "send_prenotifications",
    description:
      "Versendet die SEPA-Vorabankündigung (Pre-Notification) per E-Mail an die Zahler eines Laufs (id). Versendet echte E-Mails an Mitglieder, auditiert. Vorher mit fee_run_prenotify_info prüfen.",
    minRole: "vorstand",
    input: v.object({ id: v.string() }),
    execute: (context, input) => call(appRouter.feeRuns.sendPrenotifications, input, { context }),
  }),
  // ---- Linear SQL archive (read / reverse-engineering) ----
  defineTool({
    name: "archive_list_versions",
    description:
      "List versions of the isolated Linear Webverein SQL archive, newest first. Each upload of a Linear .sql dump becomes a version; the highest version number is the latest. Returns filename, table count, row count, status and upload metadata. Use this first, then pass a `version` (or omit it for latest) to the other archive_* tools.",
    minRole: "vorstand",
    input: v.object({}),
    execute: (context) => call(appRouter.archive.listVersions, undefined, { context }),
  }),
  defineTool({
    name: "archive_overview",
    description:
      "List the tables of one archived dump version with their row and column counts and primary key. Pass `version` (number) or `versionId`, or omit both for the latest version. The entry point for reverse-engineering the legacy database.",
    minRole: "vorstand",
    input: v.object(VersionSelector),
    execute: (context, input) => call(appRouter.archive.overview, input, { context }),
  }),
  defineTool({
    name: "archive_relationships",
    description:
      "Inferred relationships in an archived dump version: columns whose name appears in more than one table (e.g. AdrNr, MITGLNR), ordered by how many tables share them, plus each table's primary key. Use to reconstruct how the legacy tables join. Pass `version`/`versionId` or omit for latest.",
    minRole: "vorstand",
    input: v.object(VersionSelector),
    execute: (context, input) => call(appRouter.archive.relationships, input, { context }),
  }),
  defineTool({
    name: "archive_schema_diff",
    description:
      "Compare the schema of two archived dump versions: tables and columns added or removed, and columns whose declared type changed. Pass fromVersion and toVersion (version numbers from archive_list_versions).",
    minRole: "vorstand",
    input: v.object({
      fromVersion: v.pipe(v.number(), v.integer(), v.minValue(1)),
      toVersion: v.pipe(v.number(), v.integer(), v.minValue(1)),
    }),
    execute: (context, input) => call(appRouter.archive.schemaDiff, input, { context }),
  }),
  defineTool({
    name: "archive_describe_table",
    description:
      "Reverse-engineer one table in an archived dump version: the verbatim CREATE TABLE, every column with its declared MySQL type, nullability, default and key flags, plus per-column statistics (null count, distinct count, min/max and sample values). Pass tableName and `version`/`versionId` (omit for latest). Contains legacy personal data, so admin only.",
    minRole: "admin",
    input: v.object({ ...VersionSelector, tableName: v.pipe(v.string(), v.minLength(1)) }),
    execute: (context, input) => call(appRouter.archive.describeTable, input, { context }),
  }),
  defineTool({
    name: "archive_table_rows",
    description:
      "Read paginated rows of one table in an archived dump version, optionally filtered by a free-text query that matches any value in the row. Pass tableName, optional q, page (1-based) and pageSize (max 200), and `version`/`versionId` (omit for latest). Contains legacy personal data, so admin only.",
    minRole: "admin",
    input: v.object({
      ...VersionSelector,
      tableName: v.pipe(v.string(), v.minLength(1)),
      q: v.optional(v.nullable(v.string())),
      page: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
      pageSize: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(200))),
    }),
    execute: (context, input) => call(appRouter.archive.tableRows, input, { context }),
  }),
  defineTool({
    name: "archive_search",
    description:
      "Free-text search across every table of an archived dump version; matches any value in any row. Optionally restrict to one tableName. Returns the matching rows with their table and row index. Pass q, optional tableName, limit (max 200), and `version`/`versionId` (omit for latest). Contains legacy personal data, so admin only.",
    minRole: "admin",
    input: v.object({
      ...VersionSelector,
      q: v.pipe(v.string(), v.trim(), v.minLength(1)),
      tableName: v.optional(v.nullable(v.string())),
      limit: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(200))),
    }),
    execute: (context, input) => call(appRouter.archive.search, input, { context }),
  }),
  defineTool({
    name: "archive_column_values",
    description:
      "Value frequency (group-by count) of one column in an archived table, ordered by count. Reveals codes, flags and enum-like fields when reverse-engineering. Pass tableName, column, limit (max 200), and `version`/`versionId` (omit for latest). Contains legacy personal data, so admin only.",
    minRole: "admin",
    input: v.object({
      ...VersionSelector,
      tableName: v.pipe(v.string(), v.minLength(1)),
      column: v.pipe(v.string(), v.minLength(1)),
      limit: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(200))),
    }),
    execute: (context, input) => call(appRouter.archive.columnValues, input, { context }),
  }),
  defineTool({
    name: "archive_collected_postings",
    description:
      "Extrahiert aus dem Linear-SQL-Archiv die tatsächlich EINGEZOGENEN Beitragsposten (join lastprots -> mgsolln -> adresse). Belastbare Quelle dafür, wer im Alt-System wirklich abgebucht wurde -- die Live-'eingezogen'-Markierung ist importabgeleitet und unzuverlässig. Jeder Posten hat ein returned-Flag (Rücklastschrift); netto bezahlt = nicht returned. Optional nach `year` und `mitgliedsnummer` filtern (leeres Ergebnis für eine Mitgliedsnummer => dieser Posten wurde NICHT eingezogen). Gibt eine Zusammenfassung (debited/returned/netPaid/netPaidSum) + die Liste zurück. `version`/`versionId` weglassen = neueste. Legacy-Personendaten, daher admin only.",
    minRole: "admin",
    input: v.object({
      ...VersionSelector,
      year: v.optional(v.nullable(v.pipe(v.number(), v.integer()))),
      mitgliedsnummer: v.optional(v.nullable(v.string())),
      limit: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(2000))),
    }),
    execute: (context, input) => call(appRouter.archive.collectedPostings, input, { context }),
  }),
  defineTool({
    name: "archive_collection_audit",
    description:
      "Beitrags-Einzugs-Audit pro Jahr aus dem Linear-Archiv: vergleicht, welche Posten tatsächlich in einen SEPA-Lauf/eine XML kamen vs. NIE eingezogen wurden. Verlässliches Signal ist 'war je in einem Lauf' (mgsolln.SepaGUID gesetzt oder GUID in lastprots/lastprotsh) -- NICHT mgsolln.Offen (das setzt Linear nie zurück). Pflichtfeld `year`. Gibt summary (debited vs uncollected, jeweils count+sum) + die Liste der wirklich nicht eingezogenen Posten (Name, Mitgliedsnummer, Beitragsart, Betrag) zurück. Rechnungszahler ausgeschlossen, außer includeInvoice. Legacy-Personendaten, admin only.",
    minRole: "admin",
    input: v.object({
      ...VersionSelector,
      year: v.pipe(v.number(), v.integer(), v.minValue(2000), v.maxValue(2100)),
      includeInvoice: v.optional(v.boolean()),
    }),
    execute: (context, input) => call(appRouter.archive.collectionAudit, input, { context }),
  }),
];

export function allTools(): readonly McpTool[] {
  return TOOLS;
}

export function toolsForRole(role: Role): McpTool[] {
  return TOOLS.filter((tool) => ROLE_RANK[role] >= ROLE_RANK[tool.minRole]);
}

/** JSON Schema for tools/list; non-convertible refinements are dropped. */
export function toolJsonSchema(tool: McpTool): Record<string, unknown> {
  return toJsonSchema(tool.input, { errorMode: "ignore" }) as Record<string, unknown>;
}
