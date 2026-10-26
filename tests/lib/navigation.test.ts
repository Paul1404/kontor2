import { describe, expect, it } from "vitest";
import { NAV_SECTIONS, navVisible } from "~/lib/navigation";
import { normalizeTenantPolicy } from "~/lib/tenant-settings";

describe("shared navigation", () => {
  const items = NAV_SECTIONS.flatMap((s) => s.items);
  const policy = normalizeTenantPolicy(null);
  it("has one canonical entry per destination and groups data quality under administration", () => {
    expect(new Set(items.map((i) => i.to)).size).toBe(items.length);
    expect(NAV_SECTIONS.find((s) => s.label === "Verwaltung")!.items.map((i) => i.to)).toContain(
      "/app/datenqualitaet",
    );
  });
  it("allows Vorstand data quality without exposing administrator settings", () => {
    expect(navVisible(items.find((i) => i.to === "/app/datenqualitaet")!, "vorstand", policy)).toBe(
      true,
    );
    expect(
      navVisible(items.find((i) => i.to === "/app/einstellungen/verein")!, "vorstand", policy),
    ).toBe(false);
    expect(navVisible(items.find((i) => i.to === "/app/forderungen")!, "readonly", policy)).toBe(
      false,
    );
  });
});
