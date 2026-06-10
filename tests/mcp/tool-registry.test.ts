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
  create_task: "vorstand",
  set_task_status: "vorstand",
  dunning_mark_paid: "vorstand",
  create_contract: "vorstand",
  update_contract: "vorstand",
  create_sepa_mandate: "vorstand",
  merge_members: "admin",
};

const MUTATION_TOOLS = [
  "create_member",
  "update_member",
  "create_task",
  "set_task_status",
  "dunning_mark_paid",
  "create_contract",
  "update_contract",
  "create_sepa_mandate",
  "merge_members",
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
