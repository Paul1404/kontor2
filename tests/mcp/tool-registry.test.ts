import { describe, expect, it } from "vitest";
import { allTools, toolJsonSchema, toolsForRole } from "~/server/mcp/tools";

/**
 * Expected minimum role per tool. This duplication is deliberate: loosening a
 * gate (for example moving a mutation to readonly) must fail this test and
 * force a conscious update here.
 */
const EXPECTED_MIN_ROLES: Record<string, "readonly" | "vorstand" | "admin"> = {
  search_members: "readonly",
  get_member: "readonly",
  bulk_export_members: "readonly",
  member_stats: "readonly",
  list_departments: "readonly",
  list_fee_types: "readonly",
  member_timeline: "readonly",
  search_entities: "readonly",
  dashboard_stats: "readonly",
  dashboard_insights: "readonly",
  report_birthdays: "readonly",
  report_honors: "readonly",
  tasks_worklist: "readonly",
  list_fee_runs: "readonly",
  list_dunning: "readonly",
  get_dunning: "readonly",
  dunning_open_candidates: "vorstand",
  report_finance: "vorstand",
  report_department_stats: "vorstand",
  data_quality_summary: "vorstand",
  data_quality_members: "vorstand",
  create_member: "vorstand",
  update_member: "vorstand",
  onboard_member: "vorstand",
  set_member_abteilungen: "vorstand",
  create_task: "vorstand",
  set_task_status: "vorstand",
  set_fee_type_age_range: "vorstand",
  dunning_mark_paid: "vorstand",
  create_contract: "vorstand",
  update_contract: "vorstand",
  set_contract_zahler: "vorstand",
  reopen_sollstellung: "vorstand",
  generate_kulanz: "vorstand",
  create_relationship: "vorstand",
  create_sepa_mandate: "vorstand",
  update_sepa_mandate: "vorstand",
  merge_members: "admin",
  // Beitragslauf & SEPA-Einzug
  preview_fee_run: "vorstand",
  simulate_fee_run: "vorstand",
  commit_fee_run: "vorstand",
  submit_fee_run: "vorstand",
  get_fee_run: "readonly",
  get_fee_run_xml: "vorstand",
  cancel_fee_run: "vorstand",
  cancel_sollstellung: "vorstand",
  list_return_candidates: "vorstand",
  record_sepa_return: "vorstand",
  list_sepa_returns: "readonly",
  list_recollect_candidates: "vorstand",
  recollect_returns: "vorstand",
  preview_camt_returns: "vorstand",
  import_camt_returns: "vorstand",
  fee_run_prenotify_info: "vorstand",
  send_prenotifications: "vorstand",
  // Linear SQL archive (read)
  archive_list_versions: "vorstand",
  archive_overview: "vorstand",
  archive_relationships: "vorstand",
  archive_schema_diff: "vorstand",
  archive_describe_table: "admin",
  archive_table_rows: "admin",
  archive_search: "admin",
  archive_column_values: "admin",
  archive_collected_postings: "admin",
  archive_collection_audit: "admin",
  archive_set_posting_triage: "admin",
  archive_resolve_live_posting: "admin",
};

const MUTATION_TOOLS = [
  "create_member",
  "update_member",
  "onboard_member",
  "set_member_abteilungen",
  "create_task",
  "set_task_status",
  "set_fee_type_age_range",
  "dunning_mark_paid",
  "create_contract",
  "update_contract",
  "set_contract_zahler",
  "reopen_sollstellung",
  "generate_kulanz",
  "create_relationship",
  "create_sepa_mandate",
  "update_sepa_mandate",
  "merge_members",
  "commit_fee_run",
  "submit_fee_run",
  "cancel_fee_run",
  "cancel_sollstellung",
  "record_sepa_return",
  "recollect_returns",
  "import_camt_returns",
  "send_prenotifications",
  "archive_set_posting_triage",
];

describe("mcp tool registry", () => {
  it("has unique snake_case tool names", () => {
    const names = allTools().map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it("matches the expected minRole table exactly", () => {
    const actual = Object.fromEntries(allTools().map((t) => [t.name, t.minRole]));
    expect(actual).toEqual(EXPECTED_MIN_ROLES);
  });

  it("gives readonly keys no mutation tools", () => {
    const readonlyNames = toolsForRole("readonly").map((t) => t.name);
    for (const mutation of MUTATION_TOOLS) {
      expect(readonlyNames).not.toContain(mutation);
    }
  });

  it("nests role tool sets: readonly within vorstand within admin", () => {
    const readonly = new Set(toolsForRole("readonly").map((t) => t.name));
    const vorstand = new Set(toolsForRole("vorstand").map((t) => t.name));
    const admin = new Set(toolsForRole("admin").map((t) => t.name));
    for (const name of readonly) expect(vorstand.has(name)).toBe(true);
    for (const name of vorstand) expect(admin.has(name)).toBe(true);
    expect(vorstand.size).toBeGreaterThan(readonly.size);
  });

  it("converts every tool input to an object JSON Schema", () => {
    for (const tool of allTools()) {
      const schema = toolJsonSchema(tool);
      expect(schema.type, `${tool.name} input must be an object schema`).toBe("object");
    }
  });

  it("describes every tool", () => {
    for (const tool of allTools()) {
      expect(tool.description.length).toBeGreaterThan(20);
    }
  });
});
