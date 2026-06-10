import { call } from "@orpc/server";
import { toJsonSchema } from "@valibot/to-json-schema";
import * as v from "valibot";
import type { Role } from "~/server/db/schema/auth";
import type { AppContext } from "~/server/orpc/context";
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
 * Deliberately NOT exposed: dangerZone.*, import.*, settings.*, DSGVO
 * erasure, SEPA/feeRuns mutations (money movement), and all PDF/CSV/XML
 * download procedures (binary outputs do not fit MCP text results).
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

/**
 * Subset of the member Stammdaten allow-list (members.ts StammdatenInput)
 * exposed over MCP. Bank details (IBAN/BIC), legal-representative fields and
 * billing-exemption flags stay UI-only on purpose.
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
  aktivPasiv: v.optional(v.nullable(v.picklist(["A", "P"]))),
  notes: v.optional(v.nullable(v.string())),
});

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
      "Annual financial report (Finanzbericht): billed, paid and open totals, per Abteilung and per fee type. Amounts are integer cents.",
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
  // ---- Vorstand: mutations ----
  defineTool({
    name: "create_member",
    description:
      "Create a new member with the given Stammdaten (name, address, contact, Eintritt). The Mitgliedsnummer is assigned automatically. The change is audited.",
    minRole: "vorstand",
    input: v.object({ patch: McpStammdatenInput }),
    execute: (context, input) => call(appRouter.members.create, input, { context }),
  }),
  defineTool({
    name: "update_member",
    description:
      "Update a member's Stammdaten by internal member id (from search_members/get_member). Only the provided fields change; the change is audited. Bank details cannot be changed over MCP.",
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
    }),
    execute: (context, input) => call(appRouter.tasks.create, input, { context }),
  }),
  defineTool({
    name: "set_task_status",
    description: "Mark a member task (Aufgabe) as done or reopen it.",
    minRole: "vorstand",
    input: v.object({ id: v.string(), status: v.picklist(["open", "done"]) }),
    execute: (context, input) => call(appRouter.tasks.setStatus, input, { context }),
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
